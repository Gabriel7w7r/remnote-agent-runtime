#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/node-check.sh" || exit 1

usage() {
  cat <<'EOF'
Usage: ./run-integration-test.sh [--yes] [--suite all|mcp|mcpb|cli]

Runs live integration tests against a running remnote-mcp-server with a connected
RemNote Automation Bridge plugin. Default suite is "all".

Options:
  --yes                 Skip the confirmation prompt
  --suite all|mcp|mcpb|cli
                        Run all suites, only direct MCP, only MCPB stdio proxy, or only bundled CLI
  -h, --help            Show this help
EOF
}

suite="all"
skip_confirm=0
forwarded_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      skip_confirm=1
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

if (( skip_confirm == 0 )); then
  cat <<'EOF'
WARNING: This runs live integration tests and creates real RemNote content.
Artifacts use [MCP-TEST] and [CLI-TEST] prefixes for manual cleanup.
EOF
  read -r -p "Continue? (y/N) " answer
  case "${answer}" in
    y|Y) ;;
    *)
      echo "Aborted."
      exit 0
      ;;
  esac
fi

runner_args=(--yes)
if (( ${#forwarded_args[@]} > 0 )); then
  runner_args+=("${forwarded_args[@]}")
fi

if [[ "${REMNOTE_SKIP_BUILD:-0}" != "1" ]]; then
  echo "Building project..."
  npm run build
  echo ""
fi

run_mcp_suite() {
  echo "Running direct MCP integration suite..."
  npm run test:integration:mcp -- "${runner_args[@]}"
}

run_cli_suite() {
  echo "Running bundled CLI integration suite..."
  npm run test:integration:cli -- "${runner_args[@]}"
}

run_mcpb_suite() {
  echo "Running MCPB stdio proxy integration suite..."
  npm run test:integration:mcpb -- "${runner_args[@]}"
}

run_all_suites() {
  local aggregate_exit_code=0
  local suite_exit_code

  set +e
  run_mcp_suite
  suite_exit_code=$?
  if (( suite_exit_code != 0 )); then
    aggregate_exit_code=1
  fi
  echo ""

  run_mcpb_suite
  suite_exit_code=$?
  if (( suite_exit_code != 0 )); then
    aggregate_exit_code=1
  fi
  echo ""

  run_cli_suite
  suite_exit_code=$?
  if (( suite_exit_code != 0 )); then
    aggregate_exit_code=1
  fi
  set -e

  if (( aggregate_exit_code != 0 )); then
    echo "One or more integration suites failed or were incomplete." >&2
  fi
  return "${aggregate_exit_code}"
}

case "${suite}" in
  all)
    run_all_suites
    ;;
  mcp)
    run_mcp_suite
    ;;
  mcpb)
    run_mcpb_suite
    ;;
  cli)
    run_cli_suite
    ;;
esac
