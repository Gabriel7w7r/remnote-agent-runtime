#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/node-check.sh" || exit 1

WAIT_TIMEOUT_SECONDS="${REMNOTE_AGENT_WAIT_TIMEOUT:-45}"
POLL_INTERVAL_SECONDS="${REMNOTE_AGENT_POLL_INTERVAL:-2}"
LOG_FILE="${REMNOTE_AGENT_SERVER_LOG:-${TMPDIR:-/tmp}/remnote-mcp-server-agent.log}"
HTTP_HOST="${REMNOTE_HTTP_HOST:-127.0.0.1}"
HTTP_PORT="${REMNOTE_HTTP_PORT:-3001}"

suite="all"
preflight_only=0
forwarded_args=()
started_server=0
server_pid=""
deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
built_server=0
test_exit_code=0
cleanup_ran=0

usage() {
  cat <<'EOF'
Usage: ./run-agent-integration-test.sh [--yes] [--preflight-only] [--suite all|mcp|mcpb|cli]

Agent-safe live integration wrapper. Refuses to run if the MCP HTTP port is
already occupied, then builds once, starts its own repo-local server, waits for
a connected RemNote bridge, and runs the selected suite. Default suite is "all".

Options:
  --yes                 Accepted for compatibility; agent wrapper is always non-interactive
  --preflight-only      Check whether the MCP HTTP port is free, then exit without build/start/test work
  --suite all|mcp|mcpb|cli
                        Run all suites, only direct MCP, only MCPB stdio proxy, or only bundled CLI
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      shift
      ;;
    --preflight-only)
      preflight_only=1
      shift
      ;;
    --suite)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --suite" >&2
        exit 1
      fi
      suite="$2"
      shift 2
      ;;
    --suite=*)
      suite="${1#--suite=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      forwarded_args+=("$1")
      shift
      ;;
  esac
done

case "${suite}" in
  all|mcp|mcpb|cli) ;;
  *)
    echo "Invalid --suite value: ${suite}. Expected all, mcp, mcpb, or cli." >&2
    exit 1
    ;;
esac

ensure_built_server() {
  if (( built_server == 1 )); then
    return
  fi

  echo "Building MCP server and bundled CLI before startup..."
  npm run build
  built_server=1
}

status_output() {
  "${SCRIPT_DIR}/run-status-check.sh" 2>&1
}

assert_http_port_free() {
  local check_output
  local status_code

  set +e
  check_output="$(
    REMNOTE_AGENT_HTTP_HOST="${HTTP_HOST}" REMNOTE_AGENT_HTTP_PORT="${HTTP_PORT}" node -e "
const net = require('node:net');
const host = process.env.REMNOTE_AGENT_HTTP_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.REMNOTE_AGENT_HTTP_PORT || '3001', 10);
const server = net.createServer();
server.once('error', (error) => {
  console.log(error && error.code ? error.code : String(error));
  process.exit(error && error.code === 'EADDRINUSE' ? 2 : 1);
});
server.listen({ host, port, exclusive: true }, () => {
  server.close(() => process.exit(0));
});
"
  )"
  status_code=$?
  set -e

  if (( status_code == 0 )); then
    return
  fi

  if (( status_code == 2 )); then
    cat >&2 <<EOF
Refusing to run agent-assisted integration tests because ${HTTP_HOST}:${HTTP_PORT} is already in use.
Stop the running remnote-mcp-server process or macOS launchd service yourself, then rerun this wrapper.
This wrapper only stops the repo-local server process that it starts for the current test run.
EOF
  else
    echo "Unable to verify that ${HTTP_HOST}:${HTTP_PORT} is free: ${check_output}" >&2
  fi
  exit 1
}

start_server() {
  ensure_built_server
  echo "Starting repo-local MCP server for integration tests..."
  nohup npm run start -- --log-level warn --log-file "${LOG_FILE}" >"${LOG_FILE}" 2>&1 &
  server_pid="$!"
  started_server=1
  echo "Background MCP server started. Log: ${LOG_FILE}"
}

cleanup() {
  if (( cleanup_ran == 1 )); then
    return
  fi
  cleanup_ran=1

  if (( started_server == 1 )) && [[ -n "${server_pid}" ]]; then
    if kill -0 "${server_pid}" 2>/dev/null; then
      echo "Stopping MCP server started by agent wrapper..."
      kill "${server_pid}" 2>/dev/null || true
      wait "${server_pid}" 2>/dev/null || true
    fi
  fi
}

trap cleanup EXIT INT TERM

assert_http_port_free

if (( preflight_only == 1 )); then
  echo "MCP HTTP port ${HTTP_HOST}:${HTTP_PORT} is free for agent-assisted integration tests."
  exit 0
fi

ensure_built_server
start_server

while (( SECONDS < deadline )); do
  if output="$(status_output)"; then
    if grep -q '"connected": true' <<<"${output}"; then
      echo "Bridge connected. Running integration test suite: ${suite}"
      set +e
      integration_args=(--yes --suite "${suite}")
      if (( ${#forwarded_args[@]} > 0 )); then
        integration_args+=("${forwarded_args[@]}")
      fi
      REMNOTE_SKIP_BUILD=1 "${SCRIPT_DIR}/run-integration-test.sh" "${integration_args[@]}"
      test_exit_code=$?
      set -e
      exit "${test_exit_code}"
    fi

    echo "MCP server is up, but the RemNote bridge is not connected yet. Waiting..."
  else
    echo "Waiting for MCP server to become reachable..."
  fi

  sleep "${POLL_INTERVAL_SECONDS}"
done

echo "Timed out after ${WAIT_TIMEOUT_SECONDS}s waiting for a connected RemNote bridge."
echo "Ensure RemNote is open and the Automation Bridge plugin is connected to ws://127.0.0.1:3002, then rerun."
if [[ -f "${LOG_FILE}" ]]; then
  echo "Background MCP server log: ${LOG_FILE}"
fi
exit 1
