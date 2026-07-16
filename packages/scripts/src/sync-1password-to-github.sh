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
#   SUPA_RETRY_MAX_ATTEMPTS  - (optional) Retry attempts for op read / gh secret set. Default 3.
#   SUPA_RETRY_BACKOFF_SECONDS - (optional) Backoff base (seconds) between retries. Default 3.
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
#
# Two-phase, all-or-nothing execution:
#   Phase 1 (read) reads and classifies EVERY allowlisted secret across every
#   targeted environment before making a single GitHub API call. A secret is
#   only ever pruned when 1Password gives a definitive "this item/field does
#   not exist" answer — any other read failure (auth, rate limit, network,
#   an unreachable vault, ...) aborts the whole run with zero writes/deletes,
#   because `op read` exits 1 identically for "doesn't exist" and "couldn't
#   check", and guessing wrong on that distinction means silently deleting a
#   real production secret. Phase 2 (apply) only runs if phase 1 came back
#   completely clean; it sets values first, then prunes.

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
      sed -n '2,53p' "$0" | sed 's/^# \{0,1\}//'
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

# Retry tuning (shared by op read and gh secret set retries below). Only
# meant to be overridden by tests — production runs use the defaults.
RETRY_MAX_ATTEMPTS="${SUPA_RETRY_MAX_ATTEMPTS:-3}"
RETRY_BACKOFF_SECONDS="${SUPA_RETRY_BACKOFF_SECONDS:-3}"

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
# Load + validate the allowlist (no jq dependency — parse with node, same
# trick used by supa-sync-secrets and supa-setup-secrets in this package).
#
# Validates both JSON syntax AND shape before anything else runs. A
# syntactically-valid-but-wrong-shape file (e.g. "required" as a bare string
# instead of an array) would otherwise throw inside json_list's/json_map's
# `.forEach` — but that throw happens inside `< <(...)` process substitution,
# where `set -e` does NOT propagate to the parent shell, so the `while read`
# loop below would just silently see zero lines and required-secret
# enforcement would vanish for the whole run with exit 0. Catching the shape
# mismatch here, before it ever reaches json_list/json_map, avoids that trap.
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

if ! node -e '
  const fs = require("fs");
  const path = process.argv[1];
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    console.error("Error: allowlist file is not valid JSON: " + path);
    console.error("  " + e.message);
    process.exit(1);
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    console.error("Error: allowlist file must contain a JSON object: " + path);
    process.exit(1);
  }
  const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
  const isStringMap = (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string");
  const errors = [];
  for (const field of ["required", "optional"]) {
    if (field in cfg && !isStringArray(cfg[field])) {
      errors.push(`"${field}" must be an array of strings`);
    }
  }
  for (const field of ["alwaysSet", "aliases"]) {
    if (field in cfg && !isStringMap(cfg[field])) {
      errors.push(`"${field}" must be an object mapping string keys to string values`);
    }
  }
  if (errors.length > 0) {
    console.error("Error: allowlist file has an invalid shape: " + path);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
' "$ALLOWLIST"; then
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
# op read, with retry + failure classification.
# ---------------------------------------------------------------------------
# Sets globals: OP_READ_STATUS (found|missing|error), OP_READ_VALUE, OP_READ_ERROR
#
# `op read` exits 1 uniformly for every failure mode — a genuinely missing
# item/field, a mistyped or unreachable vault, an expired/rate-limited
# service-account token, a network blip — there is no structured exit code
# to key off, only a free-text `[ERROR] ...` line on stderr. Treating "read
# failed" as "secret doesn't exist" is exactly the bug this rewrite fixes:
# a transient failure would otherwise look identical to an intentional
# 1Password deletion and trigger `gh secret delete` on a real secret.
#
# So: retry with backoff first (mirrors gh_secret_set_retry below). Only
# classify as "missing" (prune-eligible) when op's stderr matches its own
# specific not-found phrasing (verified against 1Password CLI 2.32.1:
# `"<item>" isn't an item in the "<vault>" vault` for a missing item,
# `does not have a field '<field>'` for a missing field on an item that does
# exist). Everything else — including an unreachable/misnamed vault, which
# is a config problem, not a per-secret absence — is "error" after retries
# are exhausted, and the caller must abort rather than prune on it.
op_read_retry() {
  local ref="$1"
  local attempt=1
  local output
  while true; do
    if output=$(op read "$ref" 2>&1); then
      OP_READ_STATUS="found"
      OP_READ_VALUE="$output"
      OP_READ_ERROR=""
      return 0
    fi
    case "$output" in
      *"isn't an item in"*|*"does not have a field"*)
        OP_READ_STATUS="missing"
        OP_READ_VALUE=""
        OP_READ_ERROR="$output"
        return 0
        ;;
    esac
    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ]; then
      OP_READ_STATUS="error"
      OP_READ_VALUE=""
      OP_READ_ERROR="$output"
      return 0
    fi
    echo "  (op read failed, retry $attempt/$((RETRY_MAX_ATTEMPTS - 1)) in $((attempt * RETRY_BACKOFF_SECONDS))s: $ref)" >&2
    sleep $((attempt * RETRY_BACKOFF_SECONDS))
    attempt=$((attempt + 1))
  done
}

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
  local attempt=1
  while true; do
    if printf '%s' "$value" | gh secret set "$key" --env "$env" --repo "$REPO" >/dev/null; then
      return 0
    fi
    if [ "$attempt" -ge "$RETRY_MAX_ATTEMPTS" ]; then
      return 1
    fi
    echo "  (transient failure — retry $attempt/$((RETRY_MAX_ATTEMPTS - 1)) in $((attempt * RETRY_BACKOFF_SECONDS))s)"
    sleep $((attempt * RETRY_BACKOFF_SECONDS))
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
# were confirmed removed from 1Password so a deploy never reads a
# silently-stale value.
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
# Phase 1: read + classify every allowlisted secret, for every targeted
# environment. No GitHub writes happen in this phase. Populates the PLAN_*
# arrays (what phase 2 will do) plus MISSING_REQUIRED / READ_ERRORS (either
# of which blocks phase 2 entirely).
#
# Deliberately does NOT short-circuit on the first error: seeing every
# affected secret up front (not just the first one hit) is what makes the
# abort summary actually useful for diagnosing "is this really a systemic
# 1Password outage, or one flaky read" before re-running.
# ---------------------------------------------------------------------------
PLAN_ACTION=()
PLAN_ENV=()
PLAN_KEY=()
PLAN_VALUE=()
MISSING_REQUIRED=()
READ_ERRORS=()

plan_add() {
  PLAN_ACTION+=("$1")
  PLAN_ENV+=("$2")
  PLAN_KEY+=("$3")
  PLAN_VALUE+=("${4:-}")
}

build_plan() {
  local env key i target source default
  for env in "${ENVIRONMENTS[@]}"; do
    echo ""
    echo "========================================"
    echo "  Reading secrets — phase 1/2, no changes yet"
    echo "  1Password: op://$VAULT/*/$env"
    echo "  GitHub:    $REPO (environment: $env)"
    echo "========================================"

    echo ""
    echo "Required:"
    # Guarded by a length check (not a bare `for key in "${ARR[@]}"`):
    # bash 3.2 — still `/bin/bash` on macOS — treats expanding an EMPTY
    # array under `set -u` as an unbound-variable error, not zero
    # iterations. required/optional are independently optional in the
    # allowlist (only "at least one of them is non-empty" is enforced
    # above), so either can legitimately be empty here.
    if [ ${#REQUIRED_SECRETS[@]} -gt 0 ]; then
      for key in "${REQUIRED_SECRETS[@]}"; do
        op_read_retry "op://$VAULT/$key/$env"
        case "$OP_READ_STATUS" in
          found)
            echo "  FOUND   $key"
            plan_add set "$env" "$key" "$OP_READ_VALUE"
            ;;
          missing)
            echo "  MISSING $key (required)"
            MISSING_REQUIRED+=("$env: $key")
            ;;
          error)
            echo "  ERROR   $key: $OP_READ_ERROR"
            READ_ERRORS+=("$env: $key: $OP_READ_ERROR")
            ;;
        esac
      done
    fi

    echo ""
    echo "Optional:"
    if [ ${#OPTIONAL_SECRETS[@]} -gt 0 ]; then
      for key in "${OPTIONAL_SECRETS[@]}"; do
        op_read_retry "op://$VAULT/$key/$env"
        case "$OP_READ_STATUS" in
          found)
            echo "  FOUND   $key"
            plan_add set "$env" "$key" "$OP_READ_VALUE"
            ;;
          missing)
            echo "  ABSENT  $key (will prune from GitHub if present)"
            plan_add delete "$env" "$key"
            ;;
          error)
            echo "  ERROR   $key: $OP_READ_ERROR"
            READ_ERRORS+=("$env: $key: $OP_READ_ERROR")
            ;;
        esac
      done
    fi

    if [ ${#ALWAYS_SET_KEYS[@]} -gt 0 ]; then
      echo ""
      echo "Always-set switches:"
      for i in "${!ALWAYS_SET_KEYS[@]}"; do
        key="${ALWAYS_SET_KEYS[$i]}"
        default="${ALWAYS_SET_DEFAULTS[$i]}"
        op_read_retry "op://$VAULT/$key/$env"
        case "$OP_READ_STATUS" in
          found)
            echo "  FOUND   $key"
            plan_add set "$env" "$key" "$OP_READ_VALUE"
            ;;
          missing)
            echo "  DEFAULT $key -> $default"
            plan_add set "$env" "$key" "$default"
            ;;
          error)
            echo "  ERROR   $key: $OP_READ_ERROR"
            READ_ERRORS+=("$env: $key: $OP_READ_ERROR")
            ;;
        esac
      done
    fi

    if [ ${#ALIAS_TARGETS[@]} -gt 0 ]; then
      echo ""
      echo "Aliases:"
      for i in "${!ALIAS_TARGETS[@]}"; do
        target="${ALIAS_TARGETS[$i]}"
        source="${ALIAS_SOURCES[$i]}"
        op_read_retry "op://$VAULT/$source/$env"
        case "$OP_READ_STATUS" in
          found)
            echo "  FOUND   $target (alias for $source)"
            plan_add set "$env" "$target" "$OP_READ_VALUE"
            ;;
          missing)
            echo "  ABSENT  $target (alias for $source, will prune if present)"
            plan_add delete "$env" "$target"
            ;;
          error)
            echo "  ERROR   $target (alias for $source): $OP_READ_ERROR"
            READ_ERRORS+=("$env: $target (alias for $source): $OP_READ_ERROR")
            ;;
        esac
      done
    fi
  done
}

# ---------------------------------------------------------------------------
# Phase 2: apply the plan built in phase 1 — sets first, then prunes. Only
# ever called once phase 1 confirmed zero missing-required and zero read
# errors across every targeted environment.
# ---------------------------------------------------------------------------
apply_plan() {
  local env i overall_failed=0
  for env in "${ENVIRONMENTS[@]}"; do
    local synced=0 pruned=0 failed=0
    echo ""
    echo "========================================"
    echo "  Applying changes — phase 2/2"
    echo "  GitHub: $REPO (environment: $env)"
    if [ "$DRY_RUN" = true ]; then
      echo "  Mode:   DRY RUN"
    fi
    echo "========================================"

    echo ""
    echo "Setting secrets:"
    for i in "${!PLAN_ACTION[@]}"; do
      [ "${PLAN_ENV[$i]}" = "$env" ] || continue
      [ "${PLAN_ACTION[$i]}" = "set" ] || continue
      if set_secret "${PLAN_KEY[$i]}" "${PLAN_VALUE[$i]}" "$env"; then
        synced=$((synced + 1))
      else
        failed=$((failed + 1))
      fi
    done

    echo ""
    echo "Pruning stale secrets:"
    for i in "${!PLAN_ACTION[@]}"; do
      [ "${PLAN_ENV[$i]}" = "$env" ] || continue
      [ "${PLAN_ACTION[$i]}" = "delete" ] || continue
      delete_secret "${PLAN_KEY[$i]}" "$env"
      pruned=$((pruned + 1))
    done

    echo ""
    echo "========================================"
    echo "  $env sync complete"
    echo "  Synced: $synced"
    echo "  Pruned: $pruned"
    echo "  Failed: $failed"
    echo "========================================"

    if [ "$failed" -gt 0 ]; then
      overall_failed=1
    fi
  done
  return $overall_failed
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
build_plan

if [ ${#MISSING_REQUIRED[@]} -gt 0 ] || [ ${#READ_ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "========================================"
  echo "  ABORTED — no GitHub secrets were changed"
  echo "========================================"
  if [ ${#MISSING_REQUIRED[@]} -gt 0 ]; then
    echo ""
    echo "Missing required secrets:"
    for entry in "${MISSING_REQUIRED[@]}"; do
      echo "  - $entry"
    done
  fi
  if [ ${#READ_ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "1Password read errors — could not confirm these are actually absent," \
      "so refusing to prune them or write anything else this run:"
    for entry in "${READ_ERRORS[@]}"; do
      echo "  - $entry"
    done
  fi
  echo ""
  echo "Fix the above (1Password item/vault/auth) and re-run. Nothing was set or deleted in GitHub." >&2
  exit 1
fi

if apply_plan; then
  exit 0
else
  exit 1
fi
