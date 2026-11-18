#!/bin/sh
# Read-only public health, HTML shell, security-header, and unauthenticated 401 smoke check.
# Sends ONLY GET requests with no cookies or credentials.
# Usage: sh deploy/smoke-public.sh <base-url>
# Example (local dist test): REQUIRE_HSTS=1 sh deploy/smoke-public.sh "http://127.0.0.1:${VERIFY_DIST_PORT:-55492}"
set -eu

RAW_BASE="${1:?usage: smoke-public.sh <base-url>}"
BASE="${RAW_BASE%/}"

case "$BASE" in
  http://*|https://*) ;;
  *)
    echo "smoke-public: base-url must start with http:// or https:// (got: $RAW_BASE)" >&2
    exit 1
    ;;
esac

HSTS_REQUIRED="${REQUIRE_HSTS:-0}"
case "$BASE" in
  https://*) HSTS_REQUIRED=1 ;;
esac

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT HUP INT TERM

HDR="$TMP_DIR/headers.txt"
BODY="$TMP_DIR/body.txt"

assert_header_contains() {
  PATH_LABEL="$1"
  HEADER_NAME="$2"
  EXPECTED="$3"
  LINE=$(tr -d '\r' < "$HDR" | grep -i -E "^${HEADER_NAME}:" | head -n 1 || true)
  if [ -z "$LINE" ]; then
    echo "smoke-public: FAIL [$PATH_LABEL] missing header: $HEADER_NAME" >&2
    exit 1
  fi
  if ! printf '%s' "$LINE" | grep -i -F -q -- "$EXPECTED"; then
    echo "smoke-public: FAIL [$PATH_LABEL] header '$LINE' does not contain '$EXPECTED'" >&2
    exit 1
  fi
}

check_get() {
  REL_PATH="$1"
  EXPECTED_STATUS="$2"
  URL="${BASE}${REL_PATH}"
  CODE=$(curl -sS -X GET --max-time 15 -D "$HDR" -o "$BODY" -w '%{http_code}' "$URL")
  if [ "$CODE" != "$EXPECTED_STATUS" ]; then
    echo "smoke-public: FAIL [$REL_PATH] expected HTTP $EXPECTED_STATUS, got HTTP $CODE" >&2
    head -c 300 "$BODY" >&2 || true
    echo "" >&2
    exit 1
  fi
  assert_header_contains "$REL_PATH" "x-content-type-options" "nosniff"
  if [ "$HSTS_REQUIRED" = "1" ]; then
    assert_header_contains "$REL_PATH" "strict-transport-security" "max-age="
  fi
}

# 1. /readyz -> 200 JSON + no-store
check_get "/readyz" "200"
assert_header_contains "/readyz" "content-type" "application/json"
assert_header_contains "/readyz" "cache-control" "no-store"
if ! grep -F -q '"ok":true' "$BODY"; then
  echo "smoke-public: FAIL [/readyz] response missing \"ok\":true" >&2
  exit 1
fi
echo "smoke-public: OK GET /readyz -> 200 (ok:true)"

# 2. Public SPA HTML pages -> 200 HTML + SECURITY.md/static headers (CSP, X-Frame-Options, Referrer-Policy)
for PAGE_PATH in "/" "/masuk" "/admin/masuk"; do
  check_get "$PAGE_PATH" "200"
  assert_header_contains "$PAGE_PATH" "content-type" "text/html"
  assert_header_contains "$PAGE_PATH" "cache-control" "no-cache"
  assert_header_contains "$PAGE_PATH" "x-frame-options" "DENY"
  assert_header_contains "$PAGE_PATH" "referrer-policy" "no-referrer"
  assert_header_contains "$PAGE_PATH" "content-security-policy" "default-src 'self'"
  assert_header_contains "$PAGE_PATH" "content-security-policy" "frame-ancestors 'none'"
  if ! grep -F -q 'id="root"' "$BODY" || ! grep -F -q '<script' "$BODY"; then
    echo "smoke-public: FAIL [$PAGE_PATH] HTML shell missing app root or script tag" >&2
    exit 1
  fi
  echo "smoke-public: OK GET $PAGE_PATH -> 200 (app HTML + security headers)"
done

# 3. Protected API & /v1/models without credentials -> 401 JSON + no-store
for AUTH_PATH in "/api/me" "/admin/api/overview" "/v1/models"; do
  check_get "$AUTH_PATH" "401"
  assert_header_contains "$AUTH_PATH" "content-type" "application/json"
  assert_header_contains "$AUTH_PATH" "cache-control" "no-store"
  if grep -i -F -q '<html' "$BODY"; then
    echo "smoke-public: FAIL [$AUTH_PATH] returned HTML instead of API 401 JSON" >&2
    exit 1
  fi
  echo "smoke-public: OK GET $AUTH_PATH -> 401"
done

echo "smoke-public: PASS ($BASE)"
