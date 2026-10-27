#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detener instancias anteriores si existen
pkill -f "node server.mjs" 2>/dev/null || true

# Verificar que el binario de uinput exista o compilarlo
if [ ! -f "$DIR/backend/uinput_driver" ]; then
    echo "Compilando driver de entrada en C..."
    cd "$DIR/backend" && make
fi

# Ajustar firewall UFW para permitir la subred LAN de forma segura
if [ -x "$DIR/manage-firewall.sh" ]; then
    "$DIR/manage-firewall.sh" allow-lan 5252 >/dev/null 2>&1 || true
fi

# Notificación en Hyprland / escritorio
if command -v hyprctl &>/dev/null; then
    hyprctl notify 1 4000 "rgb(3b82f6)" "Phone Control Activo. Escanea el QR en consola" 2>/dev/null || true
elif command -v notify-send &>/dev/null; then
    notify-send "Phone Control" "Servidor iniciado de forma segura" -i input-mouse 2>/dev/null || true
fi

# Iniciar servidor
cd "$DIR/backend"
exec node server.mjs
