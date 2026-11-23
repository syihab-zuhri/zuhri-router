#!/usr/bin/env bash
# Launches Chromium inside an isolated Linux network namespace (`unshare -n`) with only `lo` up,
# forwarding required loopback ports to the host namespace over Unix domain sockets so host interface
# churn (e.g. WSL2 mirrored Wi-Fi `eth8`) never triggers Chromium's net::ERR_NETWORK_CHANGED.
# Playwright's --remote-debugging-pipe (FDs 3 & 4) is preserved directly for Chromium and closed in helpers.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_JS="$SCRIPT_DIR/chromium-netns-bridge.mjs"
REAL_CHROME="${PLAYWRIGHT_CHROMIUM_REAL:-/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome}"

if [[ ! -x "$REAL_CHROME" ]]; then
  echo "[chromium-netns] Chromium binary tidak ditemukan atau tidak executable: $REAL_CHROME" >&2
  exit 127
fi

if ! command -v unshare >/dev/null 2>&1 || ! command -v ip >/dev/null 2>&1 || ! unshare -n ip link set lo up 2>/dev/null; then
  echo "[chromium-netns] peringatan: unshare -n tidak tersedia; menjalankan Chromium tanpa isolasi network namespace." >&2
  exec "$REAL_CHROME" "$@"
fi

# Collect all loopback ports needed by Playwright, Vite dev/preview, and *-local-verify scripts.
add_port() {
  local p="${1:-}"
  if [[ "$p" =~ ^[0-9]+$ ]] && (( p >= 1 && p <= 65535 )); then
    PORTS_LIST+=("$p")
  fi
}

PORTS_LIST=()
add_port "${WEB_PORT:-5173}"
add_port "${WEB_PREVIEW_PORT:-4173}"
add_port "${VERIFY_WEB_PORT:-5185}"
add_port "${VERIFY_API_PORT:-55491}"
add_port "${VERIFY_DIST_PORT:-55492}"
# Include default ports used when scripts run without .antigravity-env.sh
add_port 5173
add_port 4173
add_port 5175
add_port 5185
add_port 55480
add_port 55481
add_port 55482
add_port 55491
add_port 55492

if [[ -n "${ROUTER_API_TARGET:-}" ]]; then
  if [[ "$ROUTER_API_TARGET" =~ :([0-9]+)(/|$) ]]; then
    add_port "${BASH_REMATCH[1]}"
  fi
fi

if [[ -n "${CHROMIUM_NETNS_PORTS:-}" ]]; then
  IFS=',' read -ra EXTRA_PORTS <<< "$CHROMIUM_NETNS_PORTS"
  for ep in "${EXTRA_PORTS[@]}"; do
    add_port "$ep"
  done
fi

PORTS_CSV="$(printf '%s\n' "${PORTS_LIST[@]}" | sort -un | paste -sd, -)"

SOCK_DIR="$(mktemp -d /tmp/chromium-netns.XXXXXX)"
HOST_READY="$SOCK_DIR/host.ready"
NS_READY="$SOCK_DIR/ns.ready"
HOST_BRIDGE_PID=""
UNSHARE_PID=""

cleanup() {
  local rc=$?
  if [[ -n "$UNSHARE_PID" ]] && kill -0 "$UNSHARE_PID" 2>/dev/null; then
    kill -TERM "$UNSHARE_PID" 2>/dev/null || true
    wait "$UNSHARE_PID" 2>/dev/null || true
  fi
  if [[ -n "$HOST_BRIDGE_PID" ]] && kill -0 "$HOST_BRIDGE_PID" 2>/dev/null; then
    kill -TERM "$HOST_BRIDGE_PID" 2>/dev/null || true
    wait "$HOST_BRIDGE_PID" 2>/dev/null || true
  fi
  rm -rf "$SOCK_DIR" 2>/dev/null || true
  return "$rc"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Start host-side Unix->loopback bridge (close FDs 3 & 4 so only Chromium holds Playwright's pipe).
node "$BRIDGE_JS" host "$SOCK_DIR" "$PORTS_CSV" "$$" "$HOST_READY" </dev/null 3>&- 4>&- &
HOST_BRIDGE_PID=$!

for _ in $(seq 1 200); do
  if [[ -f "$HOST_READY" ]]; then break; fi
  if ! kill -0 "$HOST_BRIDGE_PID" 2>/dev/null; then
    echo "[chromium-netns] host bridge berhenti sebelum siap." >&2
    exit 1
  fi
  sleep 0.02
done
if [[ ! -f "$HOST_READY" ]]; then
  echo "[chromium-netns] host bridge timeout menunggu kesiapan." >&2
  exit 1
fi

UNSHARE_FLAGS=(-n)
if unshare -n --kill-child true 2>/dev/null; then
  UNSHARE_FLAGS=(-n --kill-child)
fi

unshare "${UNSHARE_FLAGS[@]}" -- bash -c '
  set -euo pipefail
  BRIDGE_JS="$1"; SOCK_DIR="$2"; PORTS_CSV="$3"; NS_READY="$4"; REAL_CHROME="$5"
  shift 5
  ip link set lo up
  NS_BRIDGE_PID=""
  CHROME_PID=""
  ns_cleanup() {
    local rc=$?
    if [[ -n "$CHROME_PID" ]] && kill -0 "$CHROME_PID" 2>/dev/null; then
      kill -TERM "$CHROME_PID" 2>/dev/null || true
      wait "$CHROME_PID" 2>/dev/null || true
    fi
    if [[ -n "$NS_BRIDGE_PID" ]] && kill -0 "$NS_BRIDGE_PID" 2>/dev/null; then
      kill -TERM "$NS_BRIDGE_PID" 2>/dev/null || true
      wait "$NS_BRIDGE_PID" 2>/dev/null || true
    fi
    return "$rc"
  }
  trap ns_cleanup EXIT
  trap "exit 143" TERM
  trap "exit 130" INT

  node "$BRIDGE_JS" ns "$SOCK_DIR" "$PORTS_CSV" "$$" "$NS_READY" </dev/null 3>&- 4>&- &
  NS_BRIDGE_PID=$!
  for _ in $(seq 1 200); do
    if [[ -f "$NS_READY" ]]; then break; fi
    if ! kill -0 "$NS_BRIDGE_PID" 2>/dev/null; then
      echo "[chromium-netns] ns bridge berhenti sebelum siap." >&2
      exit 1
    fi
    sleep 0.02
  done
  if [[ ! -f "$NS_READY" ]]; then
    echo "[chromium-netns] ns bridge timeout menunggu kesiapan." >&2
    exit 1
  fi

  "$REAL_CHROME" "$@" &
  CHROME_PID=$!
  set +e
  wait "$CHROME_PID"
  CHROME_RC=$?
  set -e
  CHROME_PID=""
  exit "$CHROME_RC"
' _ "$BRIDGE_JS" "$SOCK_DIR" "$PORTS_CSV" "$NS_READY" "$REAL_CHROME" "$@" &
UNSHARE_PID=$!

set +e
wait "$UNSHARE_PID"
RC=$?
set -e
UNSHARE_PID=""
exit "$RC"
