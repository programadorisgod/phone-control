// =============================================================================
// Phone Control - Client Application Logic
// =============================================================================

(function () {
  // --- DOM Elements ---
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const latencyBadge = document.getElementById('latency-badge');
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  // Main touchpad elements
  const touchpadSurface = document.getElementById('touchpad-surface');
  const touchRipple = document.getElementById('touch-pointer-ripple');
  const fastScrollTouchpad = document.getElementById('fast-scroll-touchpad');

  // Mini touchpad elements (inside keyboard screen)
  const miniTouchpadSurface = document.getElementById('mini-touchpad-surface');
  const miniTouchRipple = document.getElementById('mini-touch-ripple');
  const fastScrollKeyboard = document.getElementById('fast-scroll-keyboard');
  const btnMiniMouseLeft = document.getElementById('btn-mini-mouse-left');
  const btnMiniMouseRight = document.getElementById('btn-mini-mouse-right');

  const hiddenInput = document.getElementById('hidden-keyboard-input');
  const btnOpenKeyboard = document.getElementById('btn-open-keyboard');
  const authModal = document.getElementById('auth-modal');
  const authInput = document.getElementById('auth-input-token');
  const btnSubmitToken = document.getElementById('btn-submit-token');
  const btnReconnect = document.getElementById('btn-reconnect');

  // Mouse buttons
  const btnMouseLeft = document.getElementById('btn-mouse-left');
  const btnMouseMiddle = document.getElementById('btn-mouse-middle');
  const btnMouseRight = document.getElementById('btn-mouse-right');

  // Settings elements
  const settingSpeed = document.getElementById('setting-speed');
  const speedVal = document.getElementById('speed-val');
  const settingScrollSpeed = document.getElementById('setting-scroll-speed');
  const scrollVal = document.getElementById('scroll-val');
  const settingAccel = document.getElementById('setting-accel');
  const settingNaturalScroll = document.getElementById('setting-natural-scroll');
  const settingVibration = document.getElementById('setting-vibration');
  const settingWakelock = document.getElementById('setting-wakelock');

  // --- State Configuration ---
  const state = {
    ws: null,
    token: null,
    connected: false,
    pingInterval: null,
    sensitivity: 1.2,
    scrollSensitivity: 1.0,
    acceleration: true,
    naturalScroll: false,
    vibration: true,
    wakeLockActive: true,
    wakeLockSentinel: null,
    activeModifiers: new Set(),
    activePointers: new Map(),
    isDragging: false,
    dragTimer: null,
    multiTouchStart: null
  };

  // Load Saved Settings
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('pc_remote_settings') || '{}');
      if (typeof saved.sensitivity === 'number') state.sensitivity = saved.sensitivity;
      if (typeof saved.scrollSensitivity === 'number') state.scrollSensitivity = saved.scrollSensitivity;
      if (typeof saved.acceleration === 'boolean') state.acceleration = saved.acceleration;
      if (typeof saved.naturalScroll === 'boolean') state.naturalScroll = saved.naturalScroll;
      if (typeof saved.vibration === 'boolean') state.vibration = saved.vibration;
      if (typeof saved.wakeLockActive === 'boolean') state.wakeLockActive = saved.wakeLockActive;

      // Update UI controls
      settingSpeed.value = state.sensitivity;
      speedVal.textContent = `${state.sensitivity.toFixed(1)}x`;
      settingScrollSpeed.value = state.scrollSensitivity;
      scrollVal.textContent = `${state.scrollSensitivity.toFixed(1)}x`;
      settingAccel.checked = state.acceleration;
      settingNaturalScroll.checked = state.naturalScroll;
      settingVibration.checked = state.vibration;
      settingWakelock.checked = state.wakeLockActive;
    } catch (_) {}
  }

  function saveSettings() {
    localStorage.setItem('pc_remote_settings', JSON.stringify({
      sensitivity: state.sensitivity,
      scrollSensitivity: state.scrollSensitivity,
      acceleration: state.acceleration,
      naturalScroll: state.naturalScroll,
      vibration: state.vibration,
      wakeLockActive: state.wakeLockActive
    }));
  }

  // Haptic feedback helper
  function vibrate(ms = 12) {
    if (state.vibration && 'vibrate' in navigator) {
      try { navigator.vibrate(ms); } catch (_) {}
    }
  }

  // WakeLock helper (keep screen on)
  async function requestWakeLock() {
    if (!state.wakeLockActive || !('wakeLock' in navigator)) return;
    try {
      if (state.wakeLockSentinel) return;
      state.wakeLockSentinel = await navigator.wakeLock.request('screen');
      state.wakeLockSentinel.addEventListener('release', () => {
        state.wakeLockSentinel = null;
      });
    } catch (_) {}
  }

  // --- WebSocket Connection ---
  function getAuthToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('pc_remote_token', tokenFromUrl);
      return tokenFromUrl;
    }
    return localStorage.getItem('pc_remote_token') || '';
  }

  function connectWebSocket() {
    state.token = getAuthToken();
    if (!state.token) {
      showAuthModal();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(state.token)}`;

    statusText.textContent = 'Conectando...';
    statusIndicator.className = 'status-dot disconnected';

    state.ws = new WebSocket(wsUrl);

    let isAuthRejected = false;

    state.ws.onopen = () => {
      statusText.textContent = 'Conectado';
      statusIndicator.className = 'status-dot connected';
      state.connected = true;
      isAuthRejected = false;
      hideAuthModal();
      requestWakeLock();
      startPing();
    };

    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_status') {
          if (!msg.authenticated) {
            isAuthRejected = true;
            statusText.textContent = 'PIN inválido o expirado';
            showAuthModal();
          } else {
            isAuthRejected = false;
            hideAuthModal();
          }
        } else if (msg.type === 'pong') {
          const rtt = Math.max(1, Date.now() - msg.clientTime);
          latencyBadge.textContent = `${rtt} ms`;
        }
      } catch (_) {}
    };

    state.ws.onclose = () => {
      state.connected = false;
      statusIndicator.className = 'status-dot disconnected';
      latencyBadge.textContent = '-- ms';
      stopPing();

      if (isAuthRejected) {
        statusText.textContent = 'PIN incorrecto. Ingresa el nuevo PIN';
        showAuthModal();
        return; // Detener bucle de reintentos continuos para evitar bloqueos por rate-limit
      }

      statusText.textContent = 'Desconectado (reintentando...)';
      setTimeout(connectWebSocket, 2500);
    };

    state.ws.onerror = () => {
      state.ws.close();
    };
  }

  function sendWS(data) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(data));
    }
  }

  function startPing() {
    stopPing();
    state.pingInterval = setInterval(() => {
      sendWS({ type: 'ping', clientTime: Date.now() });
    }, 2500);
  }

  function stopPing() {
    if (state.pingInterval) {
      clearInterval(state.pingInterval);
      state.pingInterval = null;
    }
  }

  // --- Auth Modal ---
  function showAuthModal() {
    authModal.classList.remove('hidden');
    authInput.value = state.token || '';
    authInput.focus();
  }

  function hideAuthModal() {
    authModal.classList.add('hidden');
  }

  btnSubmitToken.addEventListener('click', () => {
    const val = authInput.value.trim().toLowerCase();
    if (val) {
      localStorage.setItem('pc_remote_token', val);
      state.token = val;

      try {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('token', val);
        window.history.replaceState({}, '', currentUrl.toString());
      } catch (_) {}

      hideAuthModal();
      if (state.ws) state.ws.close();
      connectWebSocket();
    }
  });

  btnReconnect.addEventListener('click', () => {
    showAuthModal();
  });

  // --- Navigation Tabs ---
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(10);
      const tabId = btn.getAttribute('data-tab');
      navButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(`panel-tab-${tabId}`) || document.getElementById(`panel-${tabId}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // --- Modular Touchpad Gesture Engine ---
  function attachTouchpad(surfaceEl, rippleEl) {
    if (!surfaceEl) return;
    const pointers = new Map();
    let isDragging = false;
    let dragTimer = null;

    surfaceEl.addEventListener('pointerdown', (e) => {
      surfaceEl.setPointerCapture(e.pointerId);
      const rect = surfaceEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      pointers.set(e.pointerId, {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        startTime: Date.now(),
        totalDist: 0
      });

      if (rippleEl) {
        rippleEl.style.left = `${x}px`;
        rippleEl.style.top = `${y}px`;
        rippleEl.classList.add('active');
      }

      // Long press (>350ms) triggers Drag & Drop (mouse button 0 held down)
      if (pointers.size === 1) {
        clearTimeout(dragTimer);
        dragTimer = setTimeout(() => {
          const ptr = pointers.get(e.pointerId);
          if (ptr && ptr.totalDist < 12) {
            isDragging = true;
            vibrate(30);
            sendWS({ type: 'btn', button: 0, state: 1 }); // Mouse Down
          }
        }, 350);
      } else {
        clearTimeout(dragTimer);
      }
    });

    surfaceEl.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const ptr = pointers.get(e.pointerId);

      const deltaX = e.clientX - ptr.lastX;
      const deltaY = e.clientY - ptr.lastY;
      ptr.lastX = e.clientX;
      ptr.lastY = e.clientY;
      ptr.totalDist += Math.hypot(deltaX, deltaY);

      // 1 Finger: Mouse Movement
      if (pointers.size === 1) {
        let speedFactor = 1.0;
        if (state.acceleration) {
          const dist = Math.hypot(deltaX, deltaY);
          speedFactor = 1.0 + Math.min(dist / 14, 2.0);
        }

        const moveX = deltaX * state.sensitivity * speedFactor;
        const moveY = deltaY * state.sensitivity * speedFactor;

        if (Math.abs(moveX) >= 0.5 || Math.abs(moveY) >= 0.5) {
          sendWS({ type: 'move', dx: moveX, dy: moveY });
        }

        if (rippleEl) {
          const rect = surfaceEl.getBoundingClientRect();
          rippleEl.style.left = `${e.clientX - rect.left}px`;
          rippleEl.style.top = `${e.clientY - rect.top}px`;
        }
      }
      // 2 Fingers: Scroll Wheel
      else if (pointers.size === 2) {
        clearTimeout(dragTimer);
        const scrollDir = state.naturalScroll ? 1 : -1;
        const scrollStep = (deltaY * scrollDir * state.scrollSensitivity) / 6;

        if (Math.abs(scrollStep) >= 0.5) {
          sendWS({ type: 'scroll', dy: scrollStep, dx: 0 });
        }
      }
    });

    const handleEnd = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const ptr = pointers.get(e.pointerId);
      const duration = Date.now() - ptr.startTime;
      clearTimeout(dragTimer);

      if (rippleEl) rippleEl.classList.remove('active');

      if (isDragging) {
        isDragging = false;
        sendWS({ type: 'btn', button: 0, state: 0 }); // Mouse Up
        vibrate(15);
      } else if (pointers.size === 1 && duration < 240 && ptr.totalDist < 10) {
        vibrate(12);
        sendWS({ type: 'click', button: 0 }); // Left Click
      } else if (pointers.size === 2 && duration < 240 && ptr.totalDist < 14) {
        vibrate([15, 30, 15]);
        sendWS({ type: 'click', button: 1 }); // Right Click
      }

      pointers.delete(e.pointerId);
    };

    surfaceEl.addEventListener('pointerup', handleEnd);
    surfaceEl.addEventListener('pointercancel', handleEnd);
  }

  // --- Fast Touch Scroll Rail Engine ---
  function attachFastScrollRail(railEl) {
    if (!railEl) return;
    let isDown = false;
    let lastY = 0;
    let accumulatedDist = 0;

    railEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      railEl.setPointerCapture(e.pointerId);
      isDown = true;
      lastY = e.clientY;
      accumulatedDist = 0;
      railEl.classList.add('active');
      vibrate(12);
    });

    railEl.addEventListener('pointermove', (e) => {
      if (!isDown) return;
      const deltaY = e.clientY - lastY;
      lastY = e.clientY;

      const scrollDir = state.naturalScroll ? 1 : -1;
      const step = (deltaY * scrollDir * state.scrollSensitivity) * 0.45;
      accumulatedDist += Math.abs(deltaY);

      if (Math.abs(step) >= 0.4) {
        sendWS({ type: 'scroll', dy: step, dx: 0 });
      }

      // Haptic tick sensation every 18px of travel
      if (accumulatedDist > 18) {
        vibrate(8);
        accumulatedDist = 0;
      }
    });

    const endScroll = (e) => {
      if (!isDown) return;
      isDown = false;
      railEl.classList.remove('active');
    };

    railEl.addEventListener('pointerup', endScroll);
    railEl.addEventListener('pointercancel', endScroll);
  }

  // Attach touchpads
  attachTouchpad(touchpadSurface, touchRipple);
  attachTouchpad(miniTouchpadSurface, miniTouchRipple);

  // Attach fast scroll rails
  attachFastScrollRail(fastScrollTouchpad);
  attachFastScrollRail(fastScrollKeyboard);

  // --- Physical Mouse Buttons ---
  function setupButton(el, buttonIndex) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      vibrate(15);
      el.classList.add('active');
      sendWS({ type: 'btn', button: buttonIndex, state: 1 });
    });
    const release = (e) => {
      e.preventDefault();
      el.classList.remove('active');
      sendWS({ type: 'btn', button: buttonIndex, state: 0 });
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  // Main buttons
  setupButton(btnMouseLeft, 0);   // Left
  setupButton(btnMouseMiddle, 2); // Middle
  setupButton(btnMouseRight, 1);  // Right

  // Mini buttons (keyboard screen)
  setupButton(btnMiniMouseLeft, 0);  // Left
  setupButton(btnMiniMouseRight, 1); // Right

  // --- Native Smartphone Keyboard Integration ---
  btnOpenKeyboard.addEventListener('click', () => {
    vibrate(15);
    hiddenInput.value = '';
    hiddenInput.focus();
  });

  hiddenInput.addEventListener('input', (e) => {
    const val = hiddenInput.value;
    if (val && val.length > 0) {
      if (val === ' ') {
        sendWS({ type: 'tapkey', key: 'Space' });
        vibrate(10);
      } else {
        sendWS({ type: 'text', text: val });
      }
      hiddenInput.value = '';
    }
  });

  hiddenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      sendWS({ type: 'tapkey', key: 'Backspace' });
      vibrate(10);
    } else if (e.key === 'Enter') {
      sendWS({ type: 'tapkey', key: 'Enter' });
      vibrate(12);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      sendWS({ type: 'tapkey', key: 'Tab' });
      vibrate(10);
    } else if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space' || e.keyCode === 32) {
      e.preventDefault();
      sendWS({ type: 'tapkey', key: 'Space' });
      vibrate(10);
      hiddenInput.value = '';
    }
  });

  // --- Modifiers & Special Key Buttons ---
  document.querySelectorAll('.mod-key').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(12);
      const keyName = btn.getAttribute('data-key');
      if (state.activeModifiers.has(keyName)) {
        state.activeModifiers.delete(keyName);
        btn.classList.remove('active');
        sendWS({ type: 'key', key: keyName, state: 0 });
      } else {
        state.activeModifiers.add(keyName);
        btn.classList.add('active');
        sendWS({ type: 'key', key: keyName, state: 1 });
      }
    });
  });

  // Tap Keys (Esc, Tab, Backspace, Enter, Space, Arrows, etc.)
  document.querySelectorAll('[data-tap]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(12);
      const keyName = btn.getAttribute('data-tap');
      sendWS({ type: 'tapkey', key: keyName });
    });
  });

  // Composite Shortcuts (Ctrl+C, Ctrl+V, Alt+Tab, etc.)
  document.querySelectorAll('[data-shortcut]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(15);
      const sc = btn.getAttribute('data-shortcut');
      switch (sc) {
        case 'ctrl+c':
          sendWS({ type: 'shortcut', keys: ['ControlLeft', 'KeyC'] });
          break;
        case 'ctrl+v':
          sendWS({ type: 'shortcut', keys: ['ControlLeft', 'KeyV'] });
          break;
        case 'ctrl+z':
          sendWS({ type: 'shortcut', keys: ['ControlLeft', 'KeyZ'] });
          break;
        case 'ctrl+a':
          sendWS({ type: 'shortcut', keys: ['ControlLeft', 'KeyA'] });
          break;
        case 'alt+tab':
          sendWS({ type: 'shortcut', keys: ['AltLeft', 'Tab'] });
          break;
        case 'super+q':
          sendWS({ type: 'shortcut', keys: ['MetaLeft', 'KeyQ'] });
          break;
      }
    });
  });

  // --- Media & Presentation ---
  document.querySelectorAll('[data-media]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(15);
      const action = btn.getAttribute('data-media');
      sendWS({ type: 'media', action: action });
    });
  });

  // --- Settings Listeners ---
  settingSpeed.addEventListener('input', (e) => {
    state.sensitivity = parseFloat(e.target.value);
    speedVal.textContent = `${state.sensitivity.toFixed(1)}x`;
    saveSettings();
  });

  settingScrollSpeed.addEventListener('input', (e) => {
    state.scrollSensitivity = parseFloat(e.target.value);
    scrollVal.textContent = `${state.scrollSensitivity.toFixed(1)}x`;
    saveSettings();
  });

  settingAccel.addEventListener('change', (e) => {
    state.acceleration = e.target.checked;
    saveSettings();
  });

  settingNaturalScroll.addEventListener('change', (e) => {
    state.naturalScroll = e.target.checked;
    saveSettings();
  });

  settingVibration.addEventListener('change', (e) => {
    state.vibration = e.target.checked;
    saveSettings();
  });

  settingWakelock.addEventListener('change', (e) => {
    state.wakeLockActive = e.target.checked;
    if (state.wakeLockActive) requestWakeLock();
    else if (state.wakeLockSentinel) {
      state.wakeLockSentinel.release();
      state.wakeLockSentinel = null;
    }
    saveSettings();
  });

  // Visibility change to re-acquire wake lock if tab comes back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // --- Force Refresh Button ---
  const btnForceRefresh = document.getElementById('btn-force-refresh');
  if (btnForceRefresh) {
    btnForceRefresh.addEventListener('click', () => {
      vibrate(25);
      const u = new URL(window.location.href);
      u.searchParams.set('_v', Date.now());
      window.location.href = u.toString();
    });
  }

  // Initial load
  loadSettings();
  connectWebSocket();

  const urlTab = new URLSearchParams(window.location.search).get('tab');
  if (urlTab) {
    const targetBtn = document.querySelector(`.nav-btn[data-tab="${urlTab}"]`);
    if (targetBtn) targetBtn.click();
  }
})();
