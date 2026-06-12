#!/usr/bin/env bash
#
# Pallisade OS launcher.
# Starts the production server and opens the app in its own window.
# No need to run `npm run dev` — just double-click "Pallisade OS.command".
#
set -u

# Resolve project root (this script lives in <root>/scripts)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

# Make sure `node`/`npm` are on PATH even when launched from Finder
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/*/bin:$PATH"

open_window() {
  # Prefer a clean app-style Chrome window; fall back to the default browser.
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL" --new-window >/dev/null 2>&1 || open "$URL"
  else
    open "$URL" >/dev/null 2>&1 || true
  fi
}

echo ""
echo "  ▌▌▐▌▌  PALLISADE OS"
echo "  ───────────────────────────────"

# If a server is already up on this port, just open the window.
if curl -s -o /dev/null "$URL" 2>/dev/null; then
  echo "  Already running. Opening window…"
  open_window
  echo "  Open at: $URL"
  exit 0
fi

# First-run setup
if [ ! -d node_modules ]; then
  echo "  Installing dependencies (first run only)…"
  npm install || { echo "  ✗ npm install failed"; read -r -p "Press enter to close."; exit 1; }
fi

# Rebuild when there's no valid production build (.next/BUILD_ID), or when any
# source file is newer than the last build — so code changes (new pages, the
# logo, the advisor, etc.) always show up instead of serving a stale build.
NEEDS_BUILD=0
if [ ! -f .next/BUILD_ID ]; then
  NEEDS_BUILD=1
elif [ -n "$(find src public package.json next.config.ts postcss.config.mjs -newer .next/BUILD_ID 2>/dev/null | head -1)" ]; then
  NEEDS_BUILD=1
  echo "  Code changed since last run — rebuilding…"
fi
if [ "$NEEDS_BUILD" = "1" ]; then
  echo "  Building the app (this can take ~30s)…"
  npm run build || { echo "  ✗ build failed"; read -r -p "Press enter to close."; exit 1; }
fi

echo "  Starting server…"
npm run start -- -p "$PORT" > /tmp/pallisade-os.log 2>&1 &
SERVER_PID=$!

# Stop the server when this window is closed.
trap 'echo "  Shutting down…"; kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

# Wait for the server to accept connections (max ~30s).
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "$URL" 2>/dev/null; then break; fi
  sleep 0.5
done

if ! curl -s -o /dev/null "$URL" 2>/dev/null; then
  echo "  ✗ Server didn't start. See /tmp/pallisade-os.log"
  read -r -p "  Press enter to close."
  exit 1
fi

open_window
echo ""
echo "  ✓ Pallisade OS is running at $URL"
echo "  ───────────────────────────────"
echo "  Keep this window open while you work."
echo "  Close it (or press Ctrl-C) to quit the app."
echo ""

# Keep running until the server stops or the window is closed.
wait "$SERVER_PID"
