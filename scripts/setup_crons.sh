#!/usr/bin/env bash
# SCRIPT 6 — Install Gnanova AP cron jobs + log dirs + logrotate
#
# Run once on EC2:
#   sudo bash /home/ubuntu/finreportaicommercial/scripts/setup_crons.sh
#
# Crons (UTC):
#   0 4 * * *     cfo_email_uae.py      → 08:00 Dubai
#   30 2 * * *    cfo_email_india.py    → 08:00 IST
#   0 3 * * 5     duplicate_scan.py     → Friday 08:00 Dubai
#   0 5 * * 1     anomaly_scan.py       → Monday 08:00 Dubai
# vendor_whatsapp.py is API-triggered (no cron)

set -euo pipefail

REPO="${REPO_ROOT:-/home/ubuntu/finreportaicommercial}"
SCRIPTS="$REPO/scripts"
LOG_DIR="/var/log/gnanova"
PYTHON="${PYTHON_BIN:-python3}"
CRON_USER="${CRON_USER:-ubuntu}"
MARKER_BEGIN="# BEGIN gnanova-ap-crons"
MARKER_END="# END gnanova-ap-crons"

if [[ ! -d "$SCRIPTS" ]]; then
  echo "ERROR: scripts dir not found: $SCRIPTS"
  exit 1
fi

echo "==> Creating $LOG_DIR"
mkdir -p "$LOG_DIR"
chown "$CRON_USER:$CRON_USER" "$LOG_DIR" || true
chmod 755 "$LOG_DIR"

echo "==> Ensuring scripts are executable"
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
# Gnanova AP InvoiceFlow — EC2 Python (replaces n8n)
# UAE daily CFO email — 08:00 Asia/Dubai
0 4 * * * cd $REPO && $PYTHON scripts/cfo_email_uae.py >> $LOG_DIR/cfo_email_uae.cron.log 2>&1
# India daily CFO email — 08:00 Asia/Kolkata
30 2 * * * cd $REPO && $PYTHON scripts/cfo_email_india.py >> $LOG_DIR/cfo_email_india.cron.log 2>&1
# Weekly duplicate scan — Friday 08:00 Dubai
0 3 * * 5 cd $REPO && $PYTHON scripts/duplicate_scan.py >> $LOG_DIR/duplicate_scan.cron.log 2>&1
# Weekly anomaly scan — Monday 08:00 Dubai
0 5 * * 1 cd $REPO && $PYTHON scripts/anomaly_scan.py >> $LOG_DIR/anomaly_scan.cron.log 2>&1
$MARKER_END
EOF
)

echo "==> Installing crontab for user $CRON_USER"
TMP="$(mktemp)"
# Keep existing crontab minus previous gnanova block
if sudo -u "$CRON_USER" crontab -l 2>/dev/null | grep -q "$MARKER_BEGIN"; then
  sudo -u "$CRON_USER" crontab -l 2>/dev/null \
    | sed "/$MARKER_BEGIN/,/$MARKER_END/d" > "$TMP" || true
else
  sudo -u "$CRON_USER" crontab -l 2>/dev/null > "$TMP" || true
fi
# Ensure trailing newline
[[ -s "$TMP" ]] && echo >> "$TMP" || true
printf '%s\n' "$CRON_BLOCK" >> "$TMP"
sudo -u "$CRON_USER" crontab "$TMP"
rm -f "$TMP"

echo ""
echo "Installed crontab for $CRON_USER:"
sudo -u "$CRON_USER" crontab -l | sed -n "/$MARKER_BEGIN/,/$MARKER_END/p"
echo ""
echo "Done. Smoke tests (as $CRON_USER):"
echo "  cd $REPO"
echo "  $PYTHON scripts/cfo_email_uae.py --test --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
echo "  CFO_EMAIL=you@example.com $PYTHON scripts/cfo_email_india.py --test --send --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
echo "  $PYTHON scripts/duplicate_scan.py --test --no-write --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
echo "  $PYTHON scripts/anomaly_scan.py --test --no-write --company-id 0deaa402-f6a1-4c38-90e8-711f4fd0aa09"
echo ""
echo "vendor_whatsapp.py is not on cron — call POST /api/ap/vendor-whatsapp"
