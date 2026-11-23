#!/usr/bin/env bash
# CHAYSA preview audit — read-only. Run with: sudo bash
# Does not create, modify, delete, reload, restart, or install anything.
set -u

PASS=0
FAIL=0
WARN=0

ok()   { printf '[OK]   %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '[FAIL] %s\n' "$1"; FAIL=$((FAIL + 1)); }
warn() { printf '[INFO] %s\n' "$1"; WARN=$((WARN + 1)); }

check_absent() {
  local path="$1" label="$2"
  if [[ -e "$path" ]]; then bad "$label: EXISTS ($path)"; else ok "$label: ABSENT"; fi
}

check_active() {
  local unit="$1"
  if systemctl is-active --quiet "$unit"; then ok "$unit: active"; else bad "$unit: not active"; fi
}

check_hash() {
  local path="$1" expected="$2" label="$3" actual
  if [[ ! -f "$path" ]]; then bad "$label: FILE MISSING"; return; fi
  actual="$(sha256sum "$path" 2>/dev/null | awk '{print $1}')"
  if [[ "$actual" == "$expected" ]]; then
    ok "$label: MATCH"
  else
    bad "$label: HASH MISMATCH"
  fi
}

printf '%s\n' '=== CHAYSA PREVIEW READ-ONLY AUDIT ==='
printf '%s\n' 'No changes will be made.'

check_absent /var/www/html/preview 'Preview directory'
check_absent /var/www/html/preview/wp-config.php 'WordPress config'
check_absent /etc/nginx/.htpasswd-chaysa-preview 'Preview Basic Auth file'
check_absent /etc/nginx/snippets/chaysa-preview.conf 'Preview Nginx snippet'
check_absent /root/chaysa-preview-credentials.txt 'Preview credentials file'

if mariadb -Nse "SELECT IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME='chaysa_preview'),'EXISTS','ABSENT');" 2>/dev/null | grep -qx ABSENT; then
  ok 'Preview database: ABSENT'
else
  bad 'Preview database: EXISTS or query failed'
fi

if mariadb -Nse "SELECT IF(EXISTS(SELECT 1 FROM mysql.user WHERE User='chaysa_preview'),'EXISTS','ABSENT');" 2>/dev/null | grep -qx ABSENT; then
  ok 'Preview database user: ABSENT'
else
  bad 'Preview database user: EXISTS or query failed'
fi

check_active nginx
check_active php8.3-fpm
check_active mariadb

if nginx -t >/dev/null 2>&1; then ok 'Nginx configuration test'; else bad 'Nginx configuration test'; fi

check_hash /var/www/html/index.html 412c64853c21110868181b89c9a9b54fa9d0756d708dfbf4d2d2f1e6301732a7 'Main page'
check_hash /var/www/html/chaysa-logo-option4.svg 095e3463ed072236f1bd25b5ec82c17898e8b7b14758ef755c302fbef48d80c 'Main logo'

printf '\n%s\n' '=== SUMMARY ==='
printf 'OK: %s | FAIL: %s | INFO: %s\n' "$PASS" "$FAIL" "$WARN"
if (( FAIL > 0 )); then
  exit 1
fi
exit 0
