#!/usr/bin/env bash
#
# Create ONE client's GCP Dataform plumbing, end to end:
#
#   scripts/dataform-gcp-client.sh <slug> [region]
#
#   1. Dataform repository <slug>, git-linked to THIS repo at branch dataform/<slug>,
#      authenticating with the Secret Manager secret dataform-gcp-setup.sh stored
#   2. release config "production" on that branch, recompiling hourly — the compile is offline
#      and free, and it is what picks up new commits after `npm run dataform:sync`
#   3. workflow config "production" referencing it, with NO schedule — the portal owns timing
#      (this is the object everyone forgets by hand; without it every orchestrated run fails
#      with "No workflowConfig")
#
# Reads defaultProject from the client's workflow_settings.yaml, so the repo lands in the same
# project the models build in. Region defaults to us-central1 — NOTE this is the DATAFORM region
# (a real region), not the BigQuery dataset location (often the US multi-region); the two are
# different namespaces and defaultLocation in workflow_settings.yaml is NOT a valid choice here.
#
# Requires: the dataform/<slug> branch pushed (run `npm run dataform:sync -- <slug>` first) and
# dataform-gcp-setup.sh already run once for the agency. Safe to re-run: existing objects are
# left alone (ALREADY_EXISTS is reported, not fatal).
set -euo pipefail
die() { echo "error: $*" >&2; exit 1; }

SLUG="${1:-}"; SLUG="${SLUG%/}"; SLUG="${SLUG%/dataform}"; SLUG="${SLUG#clients/}"; SLUG="${SLUG%/}"
[ -n "$SLUG" ] || die "usage: scripts/dataform-gcp-client.sh <slug> [region]"
REGION="${2:-${DATAFORM_REGION:-us-central1}}"
SECRET="${DATAFORM_GH_SECRET:-dataform-github-token}"

cd "$(git rev-parse --show-toplevel)"
WS="clients/$SLUG/dataform/workflow_settings.yaml"
[ -f "$WS" ] || die "$WS not found"
PROJECT=$(awk '/^defaultProject:/ {print $2}' "$WS")
[ -n "$PROJECT" ] && [ "$PROJECT" != "your-agency-gcp-project" ] \
  || die "set defaultProject in $WS to the agency GCP project first"

# The branch must exist before a release config can compile it.
git ls-remote --exit-code origin "refs/heads/dataform/$SLUG" >/dev/null \
  || die "branch dataform/$SLUG is not on origin — run: npm run dataform:sync -- $SLUG"

# GCP speaks https to GitHub; normalize an ssh remote.
URL=$(git remote get-url origin)
case "$URL" in
  git@github.com:*) URL="https://github.com/${URL#git@github.com:}" ;;
esac

TOKEN=$(gcloud auth print-access-token) || die "gcloud not authenticated (gcloud auth login)"
RES="projects/$PROJECT/locations/$REGION"           # resource NAME prefix (goes in payloads)
BASE="https://dataform.googleapis.com/v1beta1/$RES"  # API URL prefix (goes in curl)

# POST one resource; tolerate ALREADY_EXISTS so re-runs converge instead of failing.
post() { # post <url> <json> <label>
  local out
  out=$(curl -sS -X POST "$1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2")
  if printf '%s' "$out" | grep -q '"error"'; then
    if printf '%s' "$out" | grep -q 'ALREADY_EXISTS'; then
      echo "[ok]   $3 already exists"
    else
      die "$3 failed: $out"
    fi
  else
    echo "[made] $3"
  fi
}

post "$BASE/repositories?repositoryId=$SLUG" "{
  \"gitRemoteSettings\": {
    \"url\": \"$URL\",
    \"defaultBranch\": \"dataform/$SLUG\",
    \"authenticationTokenSecretVersion\": \"projects/$PROJECT/secrets/$SECRET/versions/latest\"
  }
}" "Dataform repository $SLUG"

post "$BASE/repositories/$SLUG/releaseConfigs?releaseConfigId=production" "{
  \"gitCommitish\": \"dataform/$SLUG\",
  \"cronSchedule\": \"0 * * * *\"
}" "release config production (compiles dataform/$SLUG hourly)"

post "$BASE/repositories/$SLUG/workflowConfigs?workflowConfigId=production" "{
  \"releaseConfig\": \"$RES/repositories/$SLUG/releaseConfigs/production\"
}" "workflow config production (no cron — the portal owns timing)"

echo
echo "Dataform repo path for the portal (client_configs.dataform_repository):"
echo "  projects/$PROJECT/locations/$REGION/repositories/$SLUG"
