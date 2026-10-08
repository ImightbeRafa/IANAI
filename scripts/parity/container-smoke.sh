#!/bin/bash
# HTTP smoke for the Advance AI container (local docker run) or, after cutover,
# the live Worker. Read-only: only unauthenticated requests, nothing that writes.
# Usage: bash scripts/parity/container-smoke.sh http://127.0.0.1:8080
# Behind Cloudflare Access (preview) every request 403s without an Access
# session, so run it against preview only from a browser-authenticated proxy or
# against the local image; against production it runs as-is.
B="${1:?usage: container-smoke.sh <base-url>}"
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "GET / (SPA index)" 200 "$(code "$B/")"
curl -s "$B/" | grep -q '<div id="root"' && check "index has #root" yes yes || check "index has #root" yes no
ASSET=$(curl -s "$B/" | grep -oE '/assets/[^"]+\.js' | head -1)
check "hashed asset $ASSET" 200 "$(code "$B$ASSET")"
CT=$(curl -s -o /dev/null -w '%{content_type}' "$B$ASSET")
case "$CT" in *javascript*) check "asset MIME" js js ;; *) check "asset MIME" js "$CT" ;; esac
CSS=$(curl -s "$B/" | grep -oE '/assets/[^"]+\.css' | head -1)
CCT=$(curl -s -o /dev/null -w '%{content_type}' "$B$CSS")
case "$CCT" in text/css*) check "css MIME $CSS" css css ;; *) check "css MIME" css "$CCT" ;; esac
check "missing /assets/x.js -> 404" 404 "$(code "$B/assets/does-not-exist-123.js")"
check "SPA fallback /chat/abc" 200 "$(code "$B/chat/abc")"
curl -s "$B/chat/abc" | grep -q '<div id="root"' && check "fallback serves index" yes yes || check "fallback serves index" yes no
check "OPTIONS /api/ad-pack" 200 "$(code -X OPTIONS "$B/api/ad-pack")"
check "POST /api/ad-pack no auth" 401 "$(code -X POST -H 'content-type: application/json' -d '{"action":"angles"}' "$B/api/ad-pack")"
check "POST /api/ad-pack bad bearer" 401 "$(code -X POST -H 'authorization: Bearer junk' -H 'content-type: application/json' -d '{"action":"angles"}' "$B/api/ad-pack")"
check "POST /api/chat no auth" 401 "$(code -X POST -H 'content-type: application/json' -d '{}' "$B/api/chat")"
check "POST /api/x unknown" 404 "$(code -X POST "$B/api/x")"
check "GET /api/lib/auth not routable" 404 "$(code "$B/api/lib/auth")"
check "GET /api/_route-deadlines not routable" 404 "$(code "$B/api/_route-deadlines")"
check "GET /.well-known/oauth-protected-resource" 200 "$(code "$B/.well-known/oauth-protected-resource")"
curl -s "$B/.well-known/oauth-protected-resource" | grep -q '"resource"' && check "oauth metadata JSON" yes yes || check "oauth metadata JSON" yes no
check "GET /.well-known/oauth-protected-resource/api/mcp" 200 "$(code "$B/.well-known/oauth-protected-resource/api/mcp")"
check "GET /api/mcp-guide-analysis no bearer -> 503 (crons off) or 401 (crons on)" 5xx-or-401 "$(code "$B/api/mcp-guide-analysis" | sed -E "s/^(503|401)$/5xx-or-401/")"
check "POST /api/tilopay/webhook no secret 403" 403 "$(code -X POST "$B/api/tilopay/webhook")"
# Body limits: default 4.5 MiB cap.
head -c 5000000 /dev/zero | tr '\0' 'a' > "${TMPDIR:-/tmp}/advance-smoke-5m.txt"
check "POST /api/chat 5MB body -> 413" 413 "$(code -X POST -H 'content-type: application/json' --data-binary @"${TMPDIR:-/tmp}/advance-smoke-5m.txt" "$B/api/chat")"
check "POST /api/ad-pack 5MB body -> 413" 413 "$(code -X POST -H 'content-type: application/json' --data-binary @"${TMPDIR:-/tmp}/advance-smoke-5m.txt" "$B/api/ad-pack")"
head -c 11000000 /dev/zero | tr '\0' 'a' > "${TMPDIR:-/tmp}/advance-smoke-11m.bin"
check "POST /api/parse-pdf 11MB no auth -> 401/413" 4xx "$(code -X POST -H 'content-type: application/pdf' --data-binary @"${TMPDIR:-/tmp}/advance-smoke-11m.bin" "$B/api/parse-pdf" | sed -E 's/^(401|413)$/4xx/')"
check "security header nosniff on /" nosniff "$(curl -s -D - -o /dev/null "$B/" | tr -d '\r' | grep -i '^x-content-type-options' | awk '{print $2}')"
rm -f "${TMPDIR:-/tmp}/advance-smoke-5m.txt" "${TMPDIR:-/tmp}/advance-smoke-11m.bin"
echo "== $pass passed, $fail failed"
[ "$fail" -eq 0 ]
