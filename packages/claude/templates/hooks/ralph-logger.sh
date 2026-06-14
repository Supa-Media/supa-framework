#!/usr/bin/env bash
#
# Ralph loop logger — a Claude Code `Stop` hook.
#
# Records each Stop event so unattended runs (e.g. /auto-worker driven by a
# Ralph loop) leave an audit trail of how many iterations occurred and when.
# It is intentionally defensive: any failure is swallowed so the hook can never
# block Claude from stopping.

set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
log_dir="${project_dir}/.claude/logs"
log_file="${log_dir}/ralph.log"

mkdir -p "${log_dir}" 2>/dev/null || exit 0

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
echo "[${timestamp}] stop" >>"${log_file}" 2>/dev/null || true

exit 0
