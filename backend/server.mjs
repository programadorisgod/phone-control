import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const DRIVER_BIN = path.join(__dirname, 'uinput_driver');

const DEFAULT_PORT = parseInt(process.env.PORT || '5252', 10);
// Cryptographically secure token generated per session
const TOKEN = process.env.TOKEN || crypto.randomBytes(3).toString('hex').toLowerCase();

// Rate limiting & failed auth tracking
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const failedAuthMap = new Map(); // ip -> { count, blockedUntil }

function isIpBlocked(ip) {
  const record = failedAuthMap.get(ip);
  if (!record) return false;
  if (record.blockedUntil && Date.now() < record.blockedUntil) return true;
  if (record.blockedUntil && Date.now() >= record.blockedUntil) {
    failedAuthMap.delete(ip);
    return false;
  }
  return false;
}

function recordFailedAuth(ip) {
  const record = failedAuthMap.get(ip) || { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    console.warn(`🚨 [Security] IP ${ip} bloqueada por ${BLOCK_DURATION_MS / 60000} minutos tras múltiples intentos fallidos.`);
  }
  failedAuthMap.set(ip, record);
}

function recordSuccessfulAuth(ip) {
  failedAuthMap.delete(ip);
}

// Timing-safe token comparison to prevent side-channel timing attacks
function safeTokenCheck(providedToken) {
  if (typeof providedToken !== 'string') return false;
  const a = Buffer.from(providedToken.trim().toLowerCase());
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Scan all network interfaces (Wi-Fi, Ethernet, Hotspot, Tailscale)
function getAllNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) {
        let type = 'LAN';
        if (name.startsWith('wl')) type = 'Wi-Fi';
        else if (name.startsWith('en') || name.startsWith('eth')) type = 'Ethernet';
        else if (name.startsWith('tailscale')) type = 'Tailscale';
        else if (name.startsWith('docker') || name.startsWith('br-')) continue;

        list.push({ name, address: net.address, type });
      }
    }
  }
  // Sort: Wi-Fi first, then Ethernet, then others
  list.sort((a, b) => {
    if (a.type === 'Wi-Fi') return -1;
    if (b.type === 'Wi-Fi') return 1;
    return 0;
  });
  return list;
}

// Find available port dynamically
async function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.listen(startPort, '0.0.0.0', () => {
      testServer.once('close', () => resolve(startPort));
      testServer.close();
    });
    testServer.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

// Linux input keycode mapping
const KEY_MAP = {
  'Enter': 28, 'Escape': 1, 'Backspace': 14, 'Tab': 15, 'Space': 57,
  'ArrowUp': 103, 'ArrowDown': 108, 'ArrowLeft': 105, 'ArrowRight': 106,
  'Delete': 111, 'Home': 102, 'End': 107, 'PageUp': 104, 'PageDown': 109,
  'ControlLeft': 29, 'ControlRight': 97, 'ShiftLeft': 42, 'ShiftRight': 54,
  'AltLeft': 56, 'AltRight': 100, 'MetaLeft': 125,
  'VolumeUp': 115, 'VolumeDown': 114, 'Mute': 113,
  'PlayPause': 164, 'NextTrack': 163, 'PrevTrack': 165,
  'KeyA': 30, 'KeyB': 48, 'KeyC': 46, 'KeyD': 32, 'KeyE': 18, 'KeyF': 33,
  'KeyG': 34, 'KeyH': 35, 'KeyI': 23, 'KeyJ': 36, 'KeyK': 37, 'KeyL': 38,
  'KeyM': 50, 'KeyN': 49, 'KeyO': 24, 'KeyP': 25, 'KeyQ': 16, 'KeyR': 19,
  'KeyS': 31, 'KeyT': 20, 'KeyU': 22, 'KeyV': 47, 'KeyW': 17, 'KeyX': 45,
  'KeyY': 21, 'KeyZ': 44
};

// Driver management
let driverProcess = null;
let driverReady = false;

function startDriver() {
  if (!fs.existsSync(DRIVER_BIN)) {
    console.error(`[Driver] Binario no encontrado en ${DRIVER_BIN}. Ejecuta 'make' en backend.`);
    return;
  }

  driverProcess = spawn(DRIVER_BIN, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  driverProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('READY')) {
      driverReady = true;
      console.log('⚡ [Kernel uinput] Dispositivo de entrada virtual listo (<1ms latencia).');
    }
  });

  driverProcess.stderr.on('data', (data) => {
    const err = data.toString().trim();
    console.error(`⚠️ [Driver Warning]: ${err}`);
    if (err.includes('Permission denied')) {
      console.error('\n❌ PERMISOS REQUERIDOS: Ejecuta `./setup.sh` para configurar los permisos de /dev/uinput.\n');
    }
  });

  driverProcess.on('close', () => {
    driverReady = false;
  });
}

function sendToDriver(command) {
  if (driverProcess && driverProcess.stdin.writable) {
    driverProcess.stdin.write(command + '\n');
  }
}

// Media execution using safe execFile without shell interpretation
function handleMediaCommand(action) {
  switch (action) {
    case 'volume_up':
      execFile('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%+'], () => {});
      sendToDriver('TAPKEY 115');
      break;
    case 'volume_down':
      execFile('wpctl', ['set-volume', '@DEFAULT_AUDIO_SINK@', '5%-'], () => {});
      sendToDriver('TAPKEY 114');
      break;
    case 'mute':
      execFile('wpctl', ['set-mute', '@DEFAULT_AUDIO_SINK@', 'toggle'], () => {});
      sendToDriver('TAPKEY 113');
      break;
    case 'play_pause':
      execFile('playerctl', ['play-pause'], () => {});
      sendToDriver('TAPKEY 164');
      break;
    case 'next':
      execFile('playerctl', ['next'], () => {});
      sendToDriver('TAPKEY 163');
      break;
    case 'prev':
      execFile('playerctl', ['previous'], () => {});
      sendToDriver('TAPKEY 165');
      break;
  }
}

// HTTP Server with hardened Security Headers
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const clientIp = req.socket.remoteAddress || 'unknown';

  // Apply Hardened Security Headers
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none';");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';

  // Secure path normalization
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Content-Length': stats.size
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(safePath).pipe(res);
  });
});

// WebSocket Server with Origin Validation & Max Payload Protection
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 2048 // 2KB max to prevent memory flood DoS
});

server.on('upgrade', (req, socket, head) => {
  const clientIp = req.socket.remoteAddress || 'unknown';

  // 1. Check IP rate-limiting
  if (isIpBlocked(clientIp)) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }

  // 2. Cross-Site WebSocket Hijacking (CSWSH) Origin Validation
  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const hostHeader = (req.headers.host || '').split(':')[0];
      // Origin hostname must match host header or be localhost/private network
      if (originUrl.hostname !== hostHeader && originUrl.hostname !== 'localhost' && originUrl.hostname !== '127.0.0.1') {
        console.warn(`🚨 [Security] Rechazando conexión WebSocket con Origin no autorizado: ${origin}`);
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch (_) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqToken = url.searchParams.get('token');

  let isAuthenticated = false;
  if (reqToken) {
    if (safeTokenCheck(reqToken)) {
      isAuthenticated = true;
      recordSuccessfulAuth(clientIp);
    } else {
      recordFailedAuth(clientIp);
    }
  }

  ws.send(JSON.stringify({
    type: 'auth_status',
    authenticated: isAuthenticated,
    message: isAuthenticated ? 'Emparejado exitosamente' : 'Token requerido'
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'auth') {
        if (safeTokenCheck(msg.token)) {
          isAuthenticated = true;
          recordSuccessfulAuth(clientIp);
          ws.send(JSON.stringify({ type: 'auth_status', authenticated: true }));
        } else {
          recordFailedAuth(clientIp);
          ws.send(JSON.stringify({ type: 'auth_status', authenticated: false, error: 'Token inválido' }));
        }
        return;
      }

      // Reject all unauthorized event dispatches
      if (!isAuthenticated) return;

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime }));
          break;

        case 'move':
          if (typeof msg.dx === 'number' && typeof msg.dy === 'number' && Number.isFinite(msg.dx) && Number.isFinite(msg.dy)) {
            const dx = Math.max(-2000, Math.min(2000, Math.round(msg.dx)));
            const dy = Math.max(-2000, Math.min(2000, Math.round(msg.dy)));
            sendToDriver(`MOVE ${dx} ${dy}`);
          }
          break;

        case 'btn':
          if (typeof msg.button === 'number' && typeof msg.state === 'number') {
            const btn = Math.max(0, Math.min(4, Math.round(msg.button)));
            const state = msg.state ? 1 : 0;
            sendToDriver(`BTN ${btn} ${state}`);
          }
          break;

        case 'click':
          if (typeof msg.button === 'number') {
            const btn = Math.max(0, Math.min(4, Math.round(msg.button)));
            sendToDriver(`CLICK ${btn}`);
          }
          break;

        case 'scroll':
          if (typeof msg.dy === 'number' && Number.isFinite(msg.dy) && msg.dy !== 0) {
            const dy = Math.max(-500, Math.min(500, Math.round(msg.dy)));
            sendToDriver(`SCROLL ${dy}`);
          }
          if (typeof msg.dx === 'number' && Number.isFinite(msg.dx) && msg.dx !== 0) {
            const dx = Math.max(-500, Math.min(500, Math.round(msg.dx)));
            sendToDriver(`HSCROLL ${dx}`);
          }
          break;

        case 'key':
          let keycode = typeof msg.code === 'number' ? msg.code : KEY_MAP[msg.key];
          if (typeof keycode === 'number' && keycode > 0 && keycode <= 767) {
            sendToDriver(`KEY ${keycode} ${msg.state ? 1 : 0}`);
          }
          break;

        case 'tapkey':
          let tapCode = typeof msg.code === 'number' ? msg.code : KEY_MAP[msg.key];
          if (typeof tapCode === 'number' && tapCode > 0 && tapCode <= 767) {
            sendToDriver(`TAPKEY ${tapCode}`);
          }
          break;

        case 'shortcut':
          if (Array.isArray(msg.keys) && msg.keys.length <= 4) {
            const codes = msg.keys
              .map(k => typeof k === 'number' ? k : KEY_MAP[k])
              .filter(c => typeof c === 'number' && c > 0 && c <= 767);

            for (const code of codes) sendToDriver(`KEY ${code} 1`);
            setTimeout(() => {
              for (const code of codes.reverse()) sendToDriver(`KEY ${code} 0`);
            }, 30);
          }
          break;

        case 'text':
          if (typeof msg.text === 'string' && msg.text.length > 0 && msg.text.length <= 256) {
            sendToDriver(`TEXT ${msg.text}`);
          }
          break;

        case 'media':
          if (typeof msg.action === 'string') {
            handleMediaCommand(msg.action);
          }
          break;
      }
    } catch (_) {
      // Discard malformed packets safely
    }
  });

  ws.on('close', () => {
    // Release any held buttons safely
    sendToDriver('BTN 0 0');
    sendToDriver('BTN 1 0');
    sendToDriver('BTN 2 0');
  });
});

// Initialization
async function init() {
  startDriver();

  const activePort = await findAvailablePort(DEFAULT_PORT);
  const netInterfaces = getAllNetworkInterfaces();

  server.listen(activePort, '0.0.0.0', () => {
    const primaryIp = netInterfaces[0]?.address || '127.0.0.1';
    const primaryUrl = `http://${primaryIp}:${activePort}/?token=${TOKEN}`;

    console.clear();
    console.log('===============================================================');
    console.log('         🛡️  PHONE CONTROL - SECURE PC REMOTE DESKTOP          ');
    console.log('===============================================================');
    console.log(`\n🔗 URL Principal: \x1b[36m\x1b[1m${primaryUrl}\x1b[0m`);
    console.log(`🔑 PIN de Seguridad: \x1b[33m\x1b[1m${TOKEN}\x1b[0m\n`);

    if (netInterfaces.length > 1) {
      console.log('📡 Interfaces de red disponibles:');
      for (const iface of netInterfaces) {
        console.log(`   • [${iface.type}] http://${iface.address}:${activePort}/?token=${TOKEN}`);
      }
      console.log('');
    }

    console.log('📲 Escanea el código QR con la cámara de tu smartphone:\n');
    qrcode.generate(primaryUrl, { small: true });

    console.log('---------------------------------------------------------------');
    console.log('🔒 Protección activa: Token timing-safe, Origin check y Rate-limit.');
    console.log('Presiona Ctrl+C para detener el servidor.\n');
  });
}

function shutdown() {
  console.log('\nCerrando Phone Control de forma segura...');
  if (driverProcess) {
    sendToDriver('QUIT');
    driverProcess.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

init();
