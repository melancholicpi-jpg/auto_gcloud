#!/bin/bash
set -euo pipefail

REGION="${REGION:-asia-east1}"
GCP_PROJECT="${GCP_PROJECT:-project-a8f8e3c3-9724-4306-9bb}"
GCS_BUCKET="${GCS_BUCKET:-customer}"
ROOT_DOMAIN="${ROOT_DOMAIN:-aihubflux.com}"
AR_REPO="${AR_REPO:-my-app-repo}"
VPC_CONNECTOR="${VPC_CONNECTOR:-nexus-connector-v2}"
DNS_ZONE="${DNS_ZONE:-my-domain-zone}"
FUNCTION_NAME="auto-deploy-customer"

echo "部署 Cloud Function: ${FUNCTION_NAME}"

gcloud functions deploy ${FUNCTION_NAME} \
  --gen2 \
  --region=${REGION} \
  --runtime=nodejs20 \
  --source=. \
  --entry-point=handleUpload \
  --trigger-event-filters="type=google.cloud.storage.object.v1.finalized" \
  --trigger-event-filters="bucket=${GCS_BUCKET}" \
  --trigger-location=${REGION} \
  --memory=2Gi \
  --timeout=900 \
  --set-env-vars="REGION=${REGION},GCP_PROJECT=${GCP_PROJECT},GCS_BUCKET=${GCS_BUCKET},ROOT_DOMAIN=${ROOT_DOMAIN},AR_REPO=${AR_REPO},VPC_CONNECTOR=${VPC_CONNECTOR},DNS_ZONE=${DNS_ZONE}" \
  --quiet

echo "Cloud Function 部署完成"
echo "监听桶: gs://${GCS_BUCKET}"