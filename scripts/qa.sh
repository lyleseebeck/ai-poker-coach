#!/usr/bin/env bash
# Token-light QA: run the checks below and print only a short verdict.
# On failure, prints the last 20 lines of the failing step and exits non-zero.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
log="$(mktemp)"
step() {
  local name="$1"; shift
  if "$@" >"$log" 2>&1; then
    echo "ok: $name $(grep -E "^(Ran |OK|FAILED)" "$log" | tr "
" " ")"
  else
    echo "FAIL: $name"; tail -20 "$log"; exit 1
  fi
}

step unittest npm test
step build npm run build
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
npx vite preview --port "$port" --strictPort >"$log.preview" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
  [ "$code" = "200" ] && break
  sleep 0.5
done
if [ "$code" = "200" ]; then echo "ok: preview 200 on :$port"; else echo "FAIL: preview returned ${code:-none}"; tail -20 "$log.preview"; exit 1; fi
