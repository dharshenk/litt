#!/usr/bin/env bash
# Start/stop the Litt production server in the background.
# Usage: scripts/litt.sh {start|stop|restart|status|logs|build}
#   start [--build]  rebuild the web client first with --build (always built if dist is missing)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/litt"
PID_FILE="$STATE/litt.pid"
LOG_FILE="$STATE/litt.log"
mkdir -p "$STATE"

port() {
  if [[ -n "${PORT:-}" ]]; then echo "$PORT"; return; fi
  local value
  value="$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true)"
  echo "${value:-8787}"
}

running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

build() {
  (cd "$ROOT" && npm run build)
}

start() {
  if running; then echo "Already running (pid $(cat "$PID_FILE"))"; return 0; fi
  if [[ ! -f "$ROOT/.env" ]]; then echo "Missing $ROOT/.env (see .env.example)" >&2; exit 1; fi
  if ss -ltn | grep -qE ":$(port)\b"; then
    echo "Port $(port) is already in use by another process" >&2; exit 1
  fi
  if [[ "${1:-}" == "--build" || ! -f "$ROOT/packages/web/dist/index.html" ]]; then build; fi
  cd "$ROOT"
  # setsid gives the server its own process group so stop can kill it cleanly.
  NODE_ENV=production setsid nohup node --import dotenv/config --import tsx packages/server/src/node/main.ts \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
  sleep 2
  if running; then
    echo "Started (pid $(cat "$PID_FILE")). Logs: $LOG_FILE"
  else
    echo "Failed to start; last log lines:" >&2
    tail -n 15 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop() {
  if ! running; then echo "Not running"; rm -f "$PID_FILE"; return 0; fi
  local pid; pid="$(cat "$PID_FILE")"
  kill -- "-$pid" 2>/dev/null || kill "$pid"
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid"; fi
  rm -f "$PID_FILE"
  echo "Stopped"
}

status() {
  if running; then
    echo "Running (pid $(cat "$PID_FILE")) on port $(port)"
    grep -E '^PUBLIC_BASE_URL=' "$ROOT/.env" 2>/dev/null || true
  else
    echo "Stopped"
  fi
}

case "${1:-}" in
  start) start "${2:-}" ;;
  stop) stop ;;
  restart) stop; start "${2:-}" ;;
  status) status ;;
  logs) tail -n 50 -f "$LOG_FILE" ;;
  build) build ;;
  *) echo "Usage: $0 {start [--build]|stop|restart [--build]|status|logs|build}" >&2; exit 1 ;;
esac
