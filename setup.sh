#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=========================================================="
echo "      🛡️  Phone Control - Instalación & Hardening         "
echo "=========================================================="

echo "[1/4] Compilando el driver de entrada en C (uinput_driver)..."
cd "$DIR/backend"
make clean
make

echo ""
echo "[2/4] Instalando dependencias de Node.js..."
if command -v pnpm &>/dev/null; then
    pnpm install
elif command -v npm &>/dev/null; then
    npm install
else
    echo "ERROR: Se requiere pnpm o npm para instalar dependencias."
    exit 1
fi

echo ""
echo "[3/4] Verificando permisos de /dev/uinput..."
if [ -w /dev/uinput ]; then
    echo "✅ Permisos de /dev/uinput correctos."
else
    echo "⚠️ Configurando regla udev permanente para /dev/uinput (se solicitará sudo)..."
    echo 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/99-uinput.rules
    sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=uinput 2>/dev/null || true
    sudo chmod 660 /dev/uinput
    echo "✅ Permisos aplicados con éxito."
fi

echo ""
echo "[4/4] Configurando firewall de forma segura (LAN Only)..."
if [ -x "$DIR/manage-firewall.sh" ]; then
    "$DIR/manage-firewall.sh" allow-lan 5252
fi

echo ""
echo "=========================================================="
echo "  🎉 ¡Instalación completa y asegurada! Inicia con:       "
echo "        ./start.sh                                        "
echo "=========================================================="
