#!/bin/bash
# Claude Code on the web: install npm deps once per cloud session (no-op on local machines).
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 1
hashes=node_modules/.cloud-install.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  if npm ci; then
    sha256sum scripts/cloud-install.sh package.json package-lock.json > "$hashes" || rm -f "$hashes"
  fi
fi
exit 0
