# Source this in every WSL terminal before running anything here:  source .antigravity-env.sh
# Separate ports and database so Antigravity never touches Hermes (5173/55480/55481/55482, router_test) or Claude (router_test_claude).
export WEB_PORT=5183
export WEB_PREVIEW_PORT=4183
export ROUTER_API_TARGET=http://127.0.0.1:55490
export VERIFY_API_PORT=55491
export VERIFY_WEB_PORT=5185
export VERIFY_DIST_PORT=55492
export TEST_DATABASE_URL=postgres://postgres:spike_local_only@127.0.0.1:55432/router_test_antigravity
export CI=1
