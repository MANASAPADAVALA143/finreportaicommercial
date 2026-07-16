#!/usr/bin/env bash
# SCRIPT 6 — Install Gnanova AP cron jobs + log dirs + logrotate
#
# Run once on EC2:
#   sudo bash /home/ubuntu/finreportaicommercial/scripts/setup_crons.sh
#
# Prefer docker exec into finreportai-backend (has supabase/httpx in /opt/venv).
# Falls back to host python3 if the container is not used.

set -euo pipefail

REPO="${REPO_ROOT:-/home/ubuntu/finreportaicommercial}"
SCRIPTS="$REPO/scripts"
LOG_DIR="/var/log/gnanova"
CONTAINER="${DOCKER_CONTAINER:-finreportai-backend}"
CRON_USER="${CRON_USER:-ubuntu}"
MARKER_BEGIN="# BEGIN gnanova-ap-crons"
MARKER_END="# END gnanova-ap-crons"

# Runner: docker exec into image (scripts live at /app/scripts after rebuild)
# Host env_file already injects secrets into the container.
RUNNER="docker exec -e CFO_EMAIL=\\\"\\\$CFO_EMAIL\\\" $CONTAINER python3 /app/scripts"

if [[ ! -d "$SCRIPTS" ]]; then
  echo "ERROR: scripts dir not found: $SCRIPTS"
  exit 1
fi

echo "==> Creating $LOG_DIR"
mkdir -p "$LOG_DIR"
chown "$CRON_USER:$CRON_USER" "$LOG_DIR" || true
chmod 755 "$LOG_DIR"

echo "==> Ensuring host scripts are executable (source of truth for image builds)"
chmod +x "$SCRIPTS"/cfo_email_uae.py \
         "$SCRIPTS"/cfo_email_india.py \
         "$SCRIPTS"/duplicate_scan.py \
         "$SCRIPTS"/vendor_whatsapp.py \
         "$SCRIPTS"/anomaly_scan.py \
         "$SCRIPTS"/setup_crons.sh 2>/dev/null || true

LOGROTATE_DST="/etc/logrotate.d/gnanova"
LOGROTATE_SRC="$SCRIPTS/logrotate-gnanova.conf"
if [[ -f "$LOGROTATE_SRC" ]]; then
  echo "==> Installing logrotate → $LOGROTATE_DST"
  cp "$LOGROTATE_SRC" "$LOGROTATE_DST"
  chmod 644 "$LOGROTATE_DST"
else
  echo "==> Writing default logrotate config"
  cat > "$LOGROTATE_DST" <<'EOF'
/var/log/gnanova/*.log {
    weekly
    rotate 8
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    create 0644 ubuntu ubuntu
}
EOF
fi

CRON_BLOCK=$(cat <<EOF
$MARKER_BEGIN
# Gnanova AP InvoiceFlow — run inside $CONTAINER (image includes /app/scripts + venv)
# UAE daily CFO email — 08:00 Asia/Dubai
0 4 * * * docker exec $CONTAINER python3 /app/scripts/cfo_email_uae.py >> $LOG_DIR/cfo_email_uae.cron.log 2>&1
# India daily CFO email — 08:00 Asia/Kolkata
30 2 * * * docker exec $CONTAINER python3 /app/scripts/cfo_email_india.py >> $LOG_DIR/cfo_email_india.cron.log 2>&1
# Weekly duplicate scan — Friday 08:00 Dubai
0 3 * * 5 docker exec $CONTAINER python3 /app/scripts/duplicate_scan.py >> $LOG_DIR/duplicate_scan.cron.log 2>&1
# Weekly anomaly scan — Monday 08:00 Dubai
0 5 * * 1 docker exec $CONTAINER python3 /app/scripts/anomaly_scan.py >> $LOG_DIR/anomaly_scan.cron.log 2>&1
$MARKER_END
EOF
)

# Must run as root: logrotate + /var/log + crontab -u all need privileges.
# Do NOT use `sudo -u $CRON_USER crontab $TMP` — mktemp creates a 0600 file
# owned by root, so ubuntu cannot read it (Permission denied).
if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root: sudo bash $0"
  exit 1
fi

echo "==> Installing crontab for user $CRON_USER"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if crontab -u "$CRON_USER" -l 2>/dev/null | grep -q "$MARKER_BEGIN"; then
  crontab -u "$CRON_USER" -l 2>/dev/null \
    | sed "/$MARKER_BEGIN/,/$MARKER_END/d" > "$TMP" || true
else
  crontab -u "$CRON_USER" -l 2>/dev/null > "$TMP" || true
fi
[[ -s "$TMP" ]] && echo >> "$TMP" || true
printf '%s\n' "$CRON_BLOCK" >> "$TMP"
crontab -u "$CRON_USER" "$TMP"
rm -f "$TMP"
trap - EXIT

echo ""
echo "Installed crontab for $CRON_USER:"
crontab -u "$CRON_USER" -l | sed -n "/$MARKER_BEGIN/,/$MARKER_END/p"
echo ""
echo "IMPORTANT: rebuild the backend image so /app/scripts exists:"
echo "  cd $REPO && git pull"
echo "  cd backend && docker compose build --no-cache && docker compose up -d"
echo ""
echo "Smoke tests:"
echo "  docker exec -e CFO_EMAIL=you@example.com $CONTAINER python3 /app/scripts/cfo_email_uae.py --test --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
echo "  docker exec $CONTAINER ls -la /app/scripts/cfo_email_*.py"
echo ""
echo "vendor_whatsapp.py is not on cron — call POST /api/ap/vendor-whatsapp"
