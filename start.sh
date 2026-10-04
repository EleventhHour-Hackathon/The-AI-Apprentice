#!/usr/bin/env bash
# Start Tacit: the backend (core/backend, :8000), the UI (pixel-perfect-capture, :8080)
# and the Electron app. Ctrl-C stops everything.
#
#   ./start.sh               backend + desktop app
#   ./start.sh --web         backend + UI in the browser (http://localhost:8080)
#   ./start.sh --sync-agents push the ElevenLabs agents first (after editing apprentice_agent.py)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/core/backend"
UI="$ROOT/pixel-perfect-capture"
MODE=desktop
SYNC=0
for arg in "$@"; do
  case "$arg" in
    --web) MODE=web ;;
    --sync-agents) SYNC=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. $2" >&2; exit 1; }; }
up() { curl -s -o /dev/null "$1"; }

need uv "Install it: curl -LsSf https://astral.sh/uv/install.sh | sh"
need node "Install Node 20+ (e.g. nvm install 24)."
if command -v bun >/dev/null; then PM=bun; else PM=npm; fi

if [ ! -f "$BACKEND/.env.development" ] && [ ! -f "$BACKEND/.env" ]; then
  echo "Missing core/backend/.env.development with OPENAI_API_KEY, ELEVENLABS_API_KEY and SUPABASE_DB_URL." >&2
  exit 1
fi

say "Installing dependencies"
(cd "$BACKEND" && uv sync --quiet)
[ -d "$UI/node_modules" ] || (cd "$UI" && $PM install)

if [ "$SYNC" = 1 ]; then
  say "Syncing ElevenLabs agents"
  (cd "$BACKEND" && uv run python -m src.services.apprentice_agent)
fi

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if up http://localhost:8000/health; then
  say "Backend already running on :8000"
else
  say "Starting backend on :8000 (log: core/backend/app.log)"
  (cd "$BACKEND" && exec uv run main.py) >>"$BACKEND/app.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 60); do up http://localhost:8000/health && break; sleep 0.5; done
  up http://localhost:8000/health || { echo "Backend did not start, see core/backend/app.log" >&2; exit 1; }
fi

if up http://localhost:8080; then
  say "UI already running on :8080"
else
  say "Starting UI on :8080"
  (cd "$UI" && exec $PM run dev) &
  PIDS+=($!)
  for _ in $(seq 60); do up http://localhost:8080 && break; sleep 0.5; done
fi

if [ "$MODE" = desktop ]; then
  say "Opening Tacit"
  (cd "$UI" && npx electron .)
else
  say "Open http://localhost:8080 (Ctrl-C to stop)"
  wait
fi
