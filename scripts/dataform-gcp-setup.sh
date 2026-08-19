#!/usr/bin/env bash
#
# ONE-TIME GCP setup for the agency project — everything Dataform needs that isn't per-client:
#
#   scripts/dataform-gcp-setup.sh <agency-gcp-project>
#
# It will prompt for the GitHub PAT (mint it first — see the Auth section of the client dataform
# README: fine-grained, ONLY this repo, Contents: Read-only). Then it:
#   1. enables the Dataform / Secret Manager / BigQuery APIs
#   2. provisions the Dataform service agent (it only exists after this)
#   3. stores the PAT as the Secret Manager secret every client's Dataform repo will reference
#      (re-running with a fresh PAT adds a new version — that's the rotation path)
#   4. grants the service agent: read on that secret, and project-level BigQuery
#      jobUser + dataEditor (the execution identity — no per-client grants needed, and no
#      repository-level service account either; see the README's Auth section)
#
# Safe to re-run: every step is create-or-update.
set -euo pipefail
die() { echo "error: $*" >&2; exit 1; }

PROJECT="${1:-}"
[ -n "$PROJECT" ] || die "usage: scripts/dataform-gcp-setup.sh <agency-gcp-project>"
SECRET="${DATAFORM_GH_SECRET:-dataform-github-token}"

command -v gcloud >/dev/null || die "gcloud CLI not installed (https://cloud.google.com/sdk)"

echo "== enabling APIs on $PROJECT"
gcloud services enable dataform.googleapis.com secretmanager.googleapis.com bigquery.googleapis.com \
  --project "$PROJECT"

echo "== provisioning the Dataform service agent"
gcloud beta services identity create --service=dataform.googleapis.com --project="$PROJECT" >/dev/null 2>&1 || true
PN=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
AGENT="service-${PN}@gcp-sa-dataform.iam.gserviceaccount.com"
echo "   $AGENT"

# The PAT never lands in shell history or a file: prompted silently, piped straight in.
# printf '%s', NOT echo — echo appends a newline into the secret and git auth then fails
# with an unhelpful "authentication failed", which is a miserable thing to debug.
if [ -t 0 ]; then
  read -rsp "Paste the GitHub PAT (input hidden): " TOKEN; echo
else
  TOKEN=$(cat)
fi
[ -n "$TOKEN" ] || die "empty token"

if gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "== secret $SECRET exists — adding a new version (rotation)"
  printf '%s' "$TOKEN" | gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file=-
else
  echo "== creating secret $SECRET"
  printf '%s' "$TOKEN" | gcloud secrets create "$SECRET" --project "$PROJECT" \
    --replication-policy=automatic --data-file=-
fi

echo "== granting the service agent access"
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
  --member="serviceAccount:$AGENT" --role=roles/secretmanager.secretAccessor >/dev/null
for role in roles/bigquery.jobUser roles/bigquery.dataEditor; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$AGENT" --role="$role" --condition=None >/dev/null
done

echo "done. Per client, now run: scripts/dataform-gcp-client.sh <slug>"
