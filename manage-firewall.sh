#!/usr/bin/env bash
# ==============================================================================
# Phone Control - Firewall Security Manager
# Restringe el acceso exclusivamente a la subred local (LAN) o gestiona UFW/Firewalld
# ==============================================================================

ACTION="${1:-status}"
PORT="${2:-5252}"

# Detect primary LAN subnet (e.g., 192.168.1.0/24)
DETECTED_SUBNET="$(ip -4 route show | grep -E "link src 192\.168\.|link src 10\.|link src 172\." | awk '{print $1}' | head -n 1)"
if [ -z "$DETECTED_SUBNET" ]; then
    DETECTED_SUBNET="192.168.0.0/16"
fi

if command -v ufw &>/dev/null; then
    IS_UFW_ACTIVE="$(sudo -n ufw status 2>/dev/null | grep -c "Status: active" || true)"
else
    IS_UFW_ACTIVE=0
fi

case "$ACTION" in
    allow-lan)
        if [ "$IS_UFW_ACTIVE" -eq 1 ]; then
            echo "[Firewall] Configurando regla segura en UFW (solo subred local: $DETECTED_SUBNET)..."
            # Eliminar regla genérica si existe
            sudo -n ufw delete allow "$PORT/tcp" 2>/dev/null || true
            # Agregar regla restringida por subred
            sudo -n ufw allow from "$DETECTED_SUBNET" to any port "$PORT" proto tcp comment 'Phone Control Local Only' 2>/dev/null || true
            echo "✅ UFW: Puerto $PORT permitido únicamente desde $DETECTED_SUBNET."
        fi
        ;;

    allow-any)
        if [ "$IS_UFW_ACTIVE" -eq 1 ]; then
            sudo -n ufw allow "$PORT/tcp" comment 'Phone Control' 2>/dev/null || true
            echo "✅ UFW: Puerto $PORT permitido temporalmente."
        fi
        ;;

    remove|deny)
        if [ "$IS_UFW_ACTIVE" -eq 1 ]; then
            echo "[Firewall] Eliminando reglas de Phone Control en UFW..."
            sudo -n ufw delete allow "$PORT/tcp" 2>/dev/null || true
            sudo -n ufw delete allow from "$DETECTED_SUBNET" to any port "$PORT" proto tcp 2>/dev/null || true
            echo "✅ Reglas eliminadas. Puerto $PORT cerrado."
        fi
        ;;

    status)
        if [ "$IS_UFW_ACTIVE" -eq 1 ]; then
            echo "--- Estado de UFW para Phone Control ---"
            sudo -n ufw status | grep -E "$PORT|Status" || echo "No hay reglas activas para el puerto $PORT."
        else
            echo "UFW no está activo o no está instalado."
        fi
        ;;

    *)
        echo "Uso: $0 {allow-lan|allow-any|remove|status} [puerto]"
        exit 1
        ;;
esac
