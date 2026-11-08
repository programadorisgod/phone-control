import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const IS_WINDOWS = process.platform === 'win32';
const DRIVER_BIN = IS_WINDOWS
  ? path.join(__dirname, 'windows_driver.exe')
  : path.join(__dirname, 'uinput_driver');

const DEFAULT_PORT = parseInt(process.env.PORT || '5252', 10);

// Get or persist PIN across restarts so mobile clients reconnect seamlessly
function getOrCreateToken() {
  if (process.env.TOKEN) return process.env.TOKEN.trim().toLowerCase();
  const tokenFile = path.join(__dirname, '.pin');
  try {
    if (fs.existsSync(tokenFile)) {
      const saved = fs.readFileSync(tokenFile, 'utf8').trim().toLowerCase();
      if (saved.length >= 4) return saved;
    }
  } catch (_) {}

  const newToken = crypto.randomBytes(3).toString('hex').toLowerCase();
  try {
    fs.writeFileSync(tokenFile, newToken, 'utf8');
  } catch (_) {}
  return newToken;
}

const TOKEN = getOrCreateToken();

// Rate limiting & failed auth tracking
const MAX_FAILED_ATTEMPTS = 15;
const BLOCK_DURATION_MS = 30 * 1000; // 30 seconds cooldown
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
    console.warn(`🚨 [Security] IP ${ip} en enfriamiento por ${BLOCK_DURATION_MS / 1000} segundos tras intentos fallidos.`);
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
    const lowerName = name.toLowerCase();

    // Filter out virtual/container adapters
    if (
      lowerName.startsWith('docker') ||
      lowerName.startsWith('br-') ||
      lowerName.includes('vethernet') ||
      lowerName.includes('virtual') ||
      lowerName.includes('vmware') ||
      lowerName.includes('vbox') ||
      lowerName.includes('pseudo')
    ) {
      continue;
    }

    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) {
        let type = 'LAN';
        if (lowerName.includes('wi-fi') || lowerName.includes('wireless') || lowerName.startsWith('wl')) {
          type = 'Wi-Fi';
        } else if (lowerName.includes('ethernet') || lowerName.startsWith('en') || lowerName.startsWith('eth')) {
          type = 'Ethernet';
        } else if (lowerName.includes('tailscale')) {
          type = 'Tailscale';
        }

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

// Linux evdev input keycode mapping
const KEY_MAP_LINUX = {
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
  'KeyY': 21, 'KeyZ': 44,
  'F1': 59, 'F2': 60, 'F3': 61, 'F4': 62, 'F5': 63, 'F6': 64,
  'F7': 65, 'F8': 66, 'F9': 67, 'F10': 68, 'F11': 87, 'F12': 88
};

// Windows Virtual-Key code mapping
const KEY_MAP_WINDOWS = {
  'Enter': 0x0D, 'Escape': 0x1B, 'Backspace': 0x08, 'Tab': 0x09, 'Space': 0x20,
  'ArrowUp': 0x26, 'ArrowDown': 0x28, 'ArrowLeft': 0x25, 'ArrowRight': 0x27,
  'Delete': 0x2E, 'Home': 0x24, 'End': 0x23, 'PageUp': 0x21, 'PageDown': 0x22,
  'ControlLeft': 0xA2, 'ControlRight': 0xA3, 'ShiftLeft': 0xA0, 'ShiftRight': 0xA1,
  'AltLeft': 0xA4, 'AltRight': 0xA5, 'MetaLeft': 0x5B,
  'VolumeUp': 0xAF, 'VolumeDown': 0xAE, 'Mute': 0xAD,
  'PlayPause': 0xB3, 'NextTrack': 0xB0, 'PrevTrack': 0xB1,
  'KeyA': 0x41, 'KeyB': 0x42, 'KeyC': 0x43, 'KeyD': 0x44, 'KeyE': 0x45, 'KeyF': 0x46,
  'KeyG': 0x47, 'KeyH': 0x48, 'KeyI': 0x49, 'KeyJ': 0x4A, 'KeyK': 0x4B, 'KeyL': 0x4C,
  'KeyM': 0x4D, 'KeyN': 0x4E, 'KeyO': 0x4F, 'KeyP': 0x50, 'KeyQ': 0x51, 'KeyR': 0x52,
  'KeyS': 0x53, 'KeyT': 0x54, 'KeyU': 0x55, 'KeyV': 0x56, 'KeyW': 0x57, 'KeyX': 0x58,
  'KeyY': 0x59, 'KeyZ': 0x5A,
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73, 'F5': 0x74, 'F6': 0x75,
  'F7': 0x76, 'F8': 0x77, 'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B
};

const KEY_MAP = IS_WINDOWS ? KEY_MAP_WINDOWS : KEY_MAP_LINUX;
const MAX_KEY_CODE = IS_WINDOWS ? 0xFFFF : 767;

// Driver management
let driverProcess = null;
let driverReady = false;

function autoCompileWindowsDriver() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(sysRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(sysRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  const cscPath = candidates.find(p => fs.existsSync(p));
  const csFile = path.join(__dirname, 'windows_driver.cs');

  if (cscPath && fs.existsSync(csFile)) {
    console.log('⚙️ [Windows] Compilando windows_driver.exe automáticamente con C# nativo...');
    try {
      execFileSync(cscPath, [
        '/nologo',
        '/optimize+',
        '/platform:anycpu',
        `/out:${DRIVER_BIN}`,
        csFile
      ], { stdio: 'inherit' });
      return fs.existsSync(DRIVER_BIN);
    } catch (err) {
      console.error('❌ Error compilando con csc.exe:', err.message);
    }
  }
  return false;
}

function startDriver() {
  if (!fs.existsSync(DRIVER_BIN)) {
    if (IS_WINDOWS) {
      const ok = autoCompileWindowsDriver();
      if (!ok) {
        console.error(`[Driver] Binario no encontrado en ${DRIVER_BIN}. Ejecuta 'build-windows.bat' en backend.`);
        return;
      }
    } else {
      console.error(`[Driver] Binario no encontrado en ${DRIVER_BIN}. Ejecuta 'make' en backend.`);
      return;
    }
  }

  driverProcess = spawn(DRIVER_BIN, [], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  driverProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('READY')) {
      driverReady = true;
      const driverDesc = IS_WINDOWS ? 'Win32 SendInput' : 'Kernel uinput';
      console.log(`⚡ [${driverDesc}] Dispositivo de entrada virtual listo (<1ms latencia).`);
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

// Media execution
function handleMediaCommand(action) {
  if (IS_WINDOWS) {
    switch (action) {
      case 'volume_up':
        sendToDriver(`TAPKEY ${KEY_MAP['VolumeUp']}`);
        break;
      case 'volume_down':
        sendToDriver(`TAPKEY ${KEY_MAP['VolumeDown']}`);
        break;
      case 'mute':
        sendToDriver(`TAPKEY ${KEY_MAP['Mute']}`);
        break;
      case 'play_pause':
        sendToDriver(`TAPKEY ${KEY_MAP['PlayPause']}`);
        break;
      case 'next':
        sendToDriver(`TAPKEY ${KEY_MAP['NextTrack']}`);
        break;
      case 'prev':
        sendToDriver(`TAPKEY ${KEY_MAP['PrevTrack']}`);
        break;
      case 'seek_backward_5':
        // Universal Left Arrow (-5s in YouTube, Netflix, media players)
        sendToDriver(`TAPKEY ${KEY_MAP['ArrowLeft']}`);
        break;
      case 'seek_forward_5':
        // Universal Right Arrow (+5s in YouTube, Netflix, media players)
        sendToDriver(`TAPKEY ${KEY_MAP['ArrowRight']}`);
        break;
      case 'seek_backward_10':
        // Key J (-10s in YouTube / web video) or double Left Arrow
        sendToDriver(`TAPKEY ${KEY_MAP['KeyJ']}`);
        break;
      case 'seek_forward_10':
        // Key L (+10s in YouTube / web video) or double Right Arrow
        sendToDriver(`TAPKEY ${KEY_MAP['KeyL']}`);
        break;
    }
  } else {
    // Linux execFile without shell interpretation
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
      case 'seek_backward_5':
        execFile('playerctl', ['position', '5-'], () => {});
        sendToDriver(`TAPKEY ${KEY_MAP['ArrowLeft']}`);
        break;
      case 'seek_forward_5':
        execFile('playerctl', ['position', '5+'], () => {});
        sendToDriver(`TAPKEY ${KEY_MAP['ArrowRight']}`);
        break;
      case 'seek_backward_10':
        execFile('playerctl', ['position', '10-'], () => {});
        sendToDriver(`TAPKEY ${KEY_MAP['KeyJ']}`);
        break;
      case 'seek_forward_10':
        execFile('playerctl', ['position', '10+'], () => {});
        sendToDriver(`TAPKEY ${KEY_MAP['KeyL']}`);
        break;
    }
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
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
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
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const reqToken = url.searchParams.get('token');

  // If the client supplies the valid token, instantly unblock and allow!
  if (reqToken && safeTokenCheck(reqToken)) {
    recordSuccessfulAuth(clientIp);
  } else if (isIpBlocked(clientIp)) {
    console.warn(`🚨 [Security] Rechazando conexión temporalmente bloqueada: ${clientIp}`);
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

        case 'key': {
          let keycode = typeof msg.code === 'number' ? msg.code : KEY_MAP[msg.key];
          if (typeof keycode === 'number' && keycode > 0 && keycode <= MAX_KEY_CODE) {
            sendToDriver(`KEY ${keycode} ${msg.state ? 1 : 0}`);
          }
          break;
        }

        case 'tapkey': {
          let tapCode = typeof msg.code === 'number' ? msg.code : KEY_MAP[msg.key];
          if (typeof tapCode === 'number' && tapCode > 0 && tapCode <= MAX_KEY_CODE) {
            sendToDriver(`TAPKEY ${tapCode}`);
          }
          break;
        }

        case 'shortcut': {
          if (Array.isArray(msg.keys) && msg.keys.length <= 4) {
            let rawKeys = msg.keys;
            // On Windows, translate Super+Q (Cerrar App in mobile UI) to Alt+F4
            if (IS_WINDOWS && rawKeys.length === 2 && rawKeys[0] === 'MetaLeft' && rawKeys[1] === 'KeyQ') {
              rawKeys = ['AltLeft', 'F4'];
            }

            const codes = rawKeys
              .map(k => typeof k === 'number' ? k : KEY_MAP[k])
              .filter(c => typeof c === 'number' && c > 0 && c <= MAX_KEY_CODE);

            for (const code of codes) sendToDriver(`KEY ${code} 1`);
            setTimeout(() => {
              for (const code of codes.slice().reverse()) sendToDriver(`KEY ${code} 0`);
            }, 30);
          }
          break;
        }

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
    try {
      driverProcess.kill(IS_WINDOWS ? undefined : 'SIGTERM');
    } catch (_) {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

init();
