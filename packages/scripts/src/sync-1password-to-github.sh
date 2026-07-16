#!/usr/bin/env bash
# Sync secrets from 1Password to GitHub environment-scoped secrets.
#
# Canonical version of the near-duplicate sync-1password-to-github.sh scripts
# that used to live in each consumer app (Togather's ee/scripts, Fount's
# scripts). Same 1Password -> GitHub Environment secrets flow, but the vault
# name and secret allowlist are now parameters instead of hardcoded per app.
# See docs/SECRETS.md for the full "1Password is the source of truth" model
# this implements.
#
# Usage:
#   supa-sync-1password-to-github --vault Togather --allowlist ./ee/scripts/secrets-allowlist.json --environment staging
#   supa-sync-1password-to-github --vault Studios --allowlist ./scripts/secrets-allowlist.json --all
#   supa-sync-1password-to-github --vault Studios --allowlist ./scripts/secrets-allowlist.json --all --dry-run
#
# Prerequisites:
#   - 1Password CLI (`op`) authenticated (or OP_SERVICE_ACCOUNT_TOKEN set)
#   - GitHub CLI (`gh`) authenticated with repo admin access (GH_TOKEN works too)
#   - node (used to parse the allowlist JSON file — no jq dependency)
#
# Environment:
#   OP_VAULT                 - (optional) 1Password vault name. Overridden by --vault flag.
#   SUPA_SECRETS_ALLOWLIST   - (optional) Path to the allowlist JSON file. Overridden by --allowlist flag.
#
# Allowlist file (JSON):
#   {
#     "required": ["CONVEX_DEPLOY_KEY", "RESEND_API_KEY"],
#     "optional": ["STRIPE_SECRET_KEY", "GOOGLE_CLIENT_ID"],
#     "alwaysSet": { "AUTO_MERGE_ENABLED": "false" },
#     "aliases": { "IMAGE_CDN_URL": "R2_PUBLIC_URL" }
#   }
#
#   - required:  synced from 1Password; a missing value fails the sync (the
#                deploy would be broken without it).
#   - optional:  synced when present in 1Password; PRUNED (deleted) from the
#                GitHub environment when absent, so a deploy can never read a
#                stale value left over from a removed 1Password item.
#   - alwaysSet: always written, every sync — the 1Password value if present,
#                else the given default. Used for on/off switches where
#                "missing" must mean the safe default, not "leave whatever
#                GitHub already has."
#   - aliases:   copies another key's already-resolved value under a second
#                GitHub secret name (e.g. two env vars that should carry the
#                same underlying secret). Pruned when the source is absent.

set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
VAULT="${OP_VAULT:-}"
ALLOWLIST="${SUPA_SECRETS_ALLOWLIST:-}"
ENVIRONMENT=""
DRY_RUN=false
SYNC_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      VAULT="$2"
      shift 2
      ;;
    --vault=*)
      VAULT="${1#--vault=}"
      shift
      ;;
    --allowlist)
      ALLOWLIST="$2"
      shift 2
      ;;
    --allowlist=*)
      ALLOWLIST="${1#--allowlist=}"
      shift
      ;;
    --environment|-e)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --environment=*)
      ENVIRONMENT="${1#--environment=}"
      shift
      ;;
    --all)
      SYNC_ALL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      sed -n '2,42p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

if [ -z "$VAULT" ]; then
  echo "Error: specify --vault <name> or set OP_VAULT" >&2
  exit 1
fi

if [ -z "$ALLOWLIST" ]; then
  echo "Error: specify --allowlist <path> or set SUPA_SECRETS_ALLOWLIST" >&2
  exit 1
fi

if [ ! -f "$ALLOWLIST" ]; then
  echo "Error: allowlist file not found: $ALLOWLIST" >&2
  exit 1
fi

if [ "$SYNC_ALL" = true ]; then
  ENVIRONMENTS=("staging" "production")
elif [ -n "$ENVIRONMENT" ]; then
  if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    echo "Error: --environment must be 'staging' or 'production' (got '$ENVIRONMENT')" >&2
    exit 1
  fi
  ENVIRONMENTS=("$ENVIRONMENT")
else
  echo "Error: specify --environment <staging|production> or --all" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify prerequisites
# ---------------------------------------------------------------------------
for cmd in op gh node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is not installed." >&2
    exit 1
  fi
done

# A service-account token is how CI authenticates (no interactive `op`
# session), so `op account list` failing is not itself an error when the
# token env var is set.
if ! op account list >/dev/null 2>&1 && [ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: 1Password CLI is not authenticated. Run 'op signin' or set OP_SERVICE_ACCOUNT_TOKEN." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: GitHub CLI is not authenticated. Run 'gh auth login' or set GH_TOKEN." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect repo from git remote
# ---------------------------------------------------------------------------
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
if [ -z "$REPO" ]; then
  echo "Error: could not detect GitHub repo. Run from inside the repo with gh authenticated." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Load the allowlist (no jq dependency — parse with node, same trick used by
# supa-sync-secrets and supa-setup-secrets in this package).
# ---------------------------------------------------------------------------
json_list() {
  # $1: top-level array field name (required | optional)
  node -e "
    const cfg = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    (cfg[process.argv[2]] || []).forEach((k) => console.log(k));
  " "$ALLOWLIST" "$1"
}

json_map() {
  # $1: top-level object field name (alwaysSet | aliases) -> prints "key<TAB>value" lines
  node -e "
    const cfg = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    const obj = cfg[process.argv[2]] || {};
    Object.keys(obj).forEach((k) => console.log(k + '\t' + obj[k]));
  " "$ALLOWLIST" "$1"
}

if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$ALLOWLIST" >/dev/null 2>&1; then
  echo "Error: allowlist file is not valid JSON: $ALLOWLIST" >&2
  exit 1
fi

REQUIRED_SECRETS=()
while IFS= read -r line; do [ -n "$line" ] && REQUIRED_SECRETS+=("$line"); done < <(json_list required)

OPTIONAL_SECRETS=()
while IFS= read -r line; do [ -n "$line" ] && OPTIONAL_SECRETS+=("$line"); done < <(json_list optional)

ALWAYS_SET_KEYS=()
ALWAYS_SET_DEFAULTS=()
while IFS=$'\t' read -r k v; do
  [ -n "$k" ] || continue
  ALWAYS_SET_KEYS+=("$k")
  ALWAYS_SET_DEFAULTS+=("$v")
done < <(json_map alwaysSet)

ALIAS_TARGETS=()
ALIAS_SOURCES=()
while IFS=$'\t' read -r k v; do
  [ -n "$k" ] || continue
  ALIAS_TARGETS+=("$k")
  ALIAS_SOURCES+=("$v")
done < <(json_map aliases)

if [ ${#REQUIRED_SECRETS[@]} -eq 0 ] && [ ${#OPTIONAL_SECRETS[@]} -eq 0 ]; then
  echo "Error: allowlist has no 'required' or 'optional' secrets: $ALLOWLIST" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Set a GitHub environment secret, retrying transient failures.
# ---------------------------------------------------------------------------
# `gh secret set` occasionally fails on a transient GitHub API 502 while
# fetching the environment public key. The call is idempotent — setting the
# same value again is harmless — so retry a few times with backoff before
# giving up. Reads the value from stdin so secret values never appear in the
# process table. Returns non-zero only after all attempts fail.
gh_secret_set_retry() {
  local key="$1" env="$2" value
  value="$(cat)"
  local attempt=1 max=3
  while true; do
    if printf '%s' "$value" | gh secret set "$key" --env "$env" --repo "$REPO" >/dev/null; then
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      return 1
    fi
    echo "  (transient failure — retry $attempt/$((max - 1)) in $((attempt * 3))s)"
    sleep $((attempt * 3))
    attempt=$((attempt + 1))
  done
}

set_secret() {
  local key="$1" value="$2" env="$3"
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] Would set $key"
    return 0
  fi
  echo -n "  Setting $key..."
  if printf '%s' "$value" | gh_secret_set_retry "$key" "$env"; then
    echo " done"
    return 0
  fi
  echo " FAILED"
  return 1
}

# Deletes a secret from the GitHub environment. Idempotent: missing secrets
# don't count as failures. Used to prune stale optional/alias secrets that
# were removed from 1Password so a deploy never reads a silently-stale value.
delete_secret() {
  local key="$1" env="$2"
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] Would delete $key if present"
    return 0
  fi
  echo -n "  Clearing $key..."
  if gh secret delete "$key" --env "$env" --repo "$REPO" >/dev/null 2>&1; then
    echo " done"
  else
    echo " not set (skipped)"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Sync function
# ---------------------------------------------------------------------------
sync_environment() {
  local env="$1"
  local synced=0
  local skipped=0
  local failed=0
  local missing_required=0

  echo ""
  echo "========================================"
  echo "  Syncing secrets"
  echo "  1Password: op://$VAULT/*/$env"
  echo "  GitHub:    $REPO (environment: $env)"
  if [ "$DRY_RUN" = true ]; then
    echo "  Mode:      DRY RUN"
  fi
  echo "========================================"
  echo ""

  echo "Required secrets:"
  for key in "${REQUIRED_SECRETS[@]}"; do
    local value
    value=$(op read "op://$VAULT/$key/$env" 2>/dev/null || true)
    if [ -z "$value" ]; then
      echo "  MISSING $key (op://$VAULT/$key/$env)"
      missing_required=$((missing_required + 1))
      continue
    fi
    if set_secret "$key" "$value" "$env"; then
      synced=$((synced + 1))
    else
      failed=$((failed + 1))
    fi
  done

  echo ""
  echo "Optional secrets:"
  for key in "${OPTIONAL_SECRETS[@]}"; do
    local value
    value=$(op read "op://$VAULT/$key/$env" 2>/dev/null || true)
    if [ -z "$value" ]; then
      # 1Password is the source of truth: a missing optional item means it
      # should not exist in GitHub either, so prune any stale copy.
      delete_secret "$key" "$env"
      skipped=$((skipped + 1))
      continue
    fi
    if set_secret "$key" "$value" "$env"; then
      synced=$((synced + 1))
    else
      failed=$((failed + 1))
    fi
  done

  if [ ${#ALWAYS_SET_KEYS[@]} -gt 0 ]; then
    echo ""
    echo "Always-set switches:"
    local i
    for i in "${!ALWAYS_SET_KEYS[@]}"; do
      local key="${ALWAYS_SET_KEYS[$i]}"
      local default="${ALWAYS_SET_DEFAULTS[$i]}"
      local value
      value=$(op read "op://$VAULT/$key/$env" 2>/dev/null || true)
      value="${value:-$default}"
      if set_secret "$key" "$value" "$env"; then
        synced=$((synced + 1))
      else
        failed=$((failed + 1))
      fi
    done
  fi

  if [ ${#ALIAS_TARGETS[@]} -gt 0 ]; then
    echo ""
    echo "Aliases:"
    local i
    for i in "${!ALIAS_TARGETS[@]}"; do
      local target="${ALIAS_TARGETS[$i]}"
      local source="${ALIAS_SOURCES[$i]}"
      local value
      value=$(op read "op://$VAULT/$source/$env" 2>/dev/null || true)
      if [ -z "$value" ]; then
        delete_secret "$target" "$env"
        skipped=$((skipped + 1))
        continue
      fi
      echo "  $target (alias for $source)"
      if set_secret "$target" "$value" "$env"; then
        synced=$((synced + 1))
      else
        failed=$((failed + 1))
      fi
    done
  fi

  echo ""
  echo "========================================"
  echo "  $env sync complete"
  echo "  Synced:  $synced"
  echo "  Skipped: $skipped"
  echo "  Failed:  $failed"
  if [ "$missing_required" -gt 0 ]; then
    echo "  Missing required: $missing_required"
  fi
  echo "========================================"

  if [ "$failed" -gt 0 ] || [ "$missing_required" -gt 0 ]; then
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Run sync for each environment
# ---------------------------------------------------------------------------
EXIT_CODE=0

for ENV in "${ENVIRONMENTS[@]}"; do
  if ! sync_environment "$ENV"; then
    EXIT_CODE=1
  fi
done

exit $EXIT_CODE
