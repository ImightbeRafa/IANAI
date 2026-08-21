#!/usr/bin/env bash
# Apply AIIAN chat-shell production pack via psql.
# Requires: AIIAN_DATABASE_URL (or DATABASE_URL) pointing at lstzfxsdmggkoaxfawny.
# Does NOT enable chat_shell or invite users.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACK="$ROOT/supabase/production/aiian/chat-shell"
URL="${AIIAN_DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$URL" ]]; then
  echo "Set AIIAN_DATABASE_URL to the AIIAN Postgres URI (Session mode / direct)." >&2
  echo "Host must be db.lstzfxsdmggkoaxfawny.supabase.co (or pooler for that ref)." >&2
  exit 1
fi

if [[ "$URL" != *lstzfxsdmggkoaxfawny* ]]; then
  echo "Refuse: connection string does not contain lstzfxsdmggkoaxfawny" >&2
  exit 1
fi
if [[ "$URL" == *adrwkzibhfdpwuycnzaa* ]]; then
  echo "Refuse: connection string points at IANAI-preview" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL client tools." >&2
  exit 1
fi

OUT_DIR="${PACK_APPLY_OUT:-/tmp/aiian-chat-shell-apply}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

echo "== Identity probe =="
psql "$URL" -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version') AS server_version, current_database();" \
  | tee "$OUT_DIR/${STAMP}_identity.txt"

echo "== 01 preflight =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$PACK/01_preflight_read_only.sql" \
  | tee "$OUT_DIR/${STAMP}_01_preflight.txt"

echo "== 02 foundation (transactional file) =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$PACK/02_foundation_and_rollout.sql" \
  | tee "$OUT_DIR/${STAMP}_02_foundation.txt"

echo "== 03 security overlay =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$PACK/03_security_overlay.sql" \
  | tee "$OUT_DIR/${STAMP}_03_security.txt"

echo "== 04 postflight =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$PACK/04_postflight_read_only.sql" \
  | tee "$OUT_DIR/${STAMP}_04_postflight.txt"

echo "== 05 security/performance audit =="
psql "$URL" -v ON_ERROR_STOP=1 -f "$PACK/05_security_performance_audit.sql" \
  | tee "$OUT_DIR/${STAMP}_05_audit.txt"

echo "Done. Outputs in $OUT_DIR"
echo "Next: run Supabase Dashboard Advisors (Security + Performance) on AIIAN."
echo "Do NOT enable chat_shell or invite canary without explicit Phase B/C approval."
