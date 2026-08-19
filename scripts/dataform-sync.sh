#!/usr/bin/env bash
#
# Publish each client's committed clients/<slug>/dataform/ folder to its dataform/<slug> branch —
# the branch GCP Dataform actually reads (it requires workflow_settings.yaml at the repo ROOT and
# cannot point at a subdirectory, so every client's Dataform repository links to THIS repo pinned
# to its own branch).
#
#   scripts/dataform-sync.sh acme-co             # one client
#   scripts/dataform-sync.sh acme-co bobs-shop   # several
#   scripts/dataform-sync.sh --all               # every clients/*/dataform in HEAD
#   scripts/dataform-sync.sh acme-co -m "add ga4 staging"
#
# DETERMINISTIC BY CONSTRUCTION, not by careful copying: the branch commit is built with
# `git commit-tree` directly from the subfolder's tree object in HEAD. There is no checkout, no
# rsync, no worktree, and no stale-file cleanup — the branch content cannot differ from the
# committed folder because it IS the committed folder's tree. Re-running when nothing changed is
# a no-op (the tree hashes match), so it is safe to run --all after every merge.
#
# Rules the script enforces:
#   - Only COMMITTED state syncs. Uncommitted edits under the folder abort with a message —
#     silently publishing yesterday's models while today's sit unstaged is the failure mode.
#   - Never edit the dataform/<slug> branch directly; it is generated output. Fix on main, re-run.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

MSG=""
ALL=false
SLUGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=true ;;
    -m) shift; MSG="${1:-}" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown flag $1" ;;
    *) SLUGS+=("$1") ;;
  esac
  shift
done

cd "$(git rev-parse --show-toplevel)"
HEAD_SHA=$(git rev-parse --short HEAD)

if $ALL; then
  # Discover from HEAD, not the filesystem — only committed folders can sync anyway.
  while IFS= read -r c; do
    if git rev-parse -q --verify "HEAD:clients/$c/dataform" >/dev/null 2>&1; then
      SLUGS+=("$c")
    fi
  done < <(git ls-tree --name-only "HEAD:clients")
fi

[ ${#SLUGS[@]} -gt 0 ] || die "no client slugs given (or --all found none). Usage: scripts/dataform-sync.sh <slug>… | --all"

# One fetch so branch parents are current; fine offline too (we then parent on local refs).
git fetch origin --prune 'refs/heads/dataform/*:refs/remotes/origin/dataform/*' 2>/dev/null || true

for SLUG in "${SLUGS[@]}"; do
  SRC="clients/$SLUG/dataform"
  BRANCH="dataform/$SLUG"

  TREE=$(git rev-parse -q --verify "HEAD:$SRC" 2>/dev/null) \
    || die "$SRC is not committed on HEAD — commit it on main first"

  if [ -n "$(git status --porcelain -- "$SRC")" ]; then
    die "$SRC has uncommitted changes — commit them first, or you'd publish a stale snapshot"
  fi

  # Parent on the newest of remote/local branch, so history chains instead of forking.
  PARENT=$(git rev-parse -q --verify "refs/remotes/origin/$BRANCH" 2>/dev/null \
        || git rev-parse -q --verify "refs/heads/$BRANCH" 2>/dev/null \
        || true)

  if [ -n "$PARENT" ] && [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
    echo "[ok]   $BRANCH already matches $SRC @ $HEAD_SHA"
    git update-ref "refs/heads/$BRANCH" "$PARENT"
    continue
  fi

  COMMIT=$(git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} \
    -m "Sync $SRC from main @ $HEAD_SHA${MSG:+: $MSG}")
  git update-ref "refs/heads/$BRANCH" "$COMMIT"
  git push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
  echo "[sync] $BRANCH ← $SRC @ $HEAD_SHA ($COMMIT)"
done
