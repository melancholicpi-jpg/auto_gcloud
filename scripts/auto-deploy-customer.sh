#!/bin/bash
set -euo pipefail

echo "============================================"
echo " Auto GCloud - 全自动部署脚本（单镜像）"
echo "============================================"
echo ""

REGION="${REGION:-asia-east1}"
GCP_PROJECT="${GCP_PROJECT:-project-a8f8e3c3-9724-4306-9bb}"
GCS_BUCKET="${GCS_BUCKET:-image.aihubflux.com}"
ROOT_DOMAIN="${ROOT_DOMAIN:-aihubflux.com}"
AR_REPO="${AR_REPO:-my-app-repo}"
VPC_CONNECTOR="${VPC_CONNECTOR:-nexus-connector-v2}"
DNS_ZONE="${DNS_ZONE:-my-domain-zone}"
REGISTRY="${REGION}-docker.pkg.dev"

echo "[INFO] 区域: ${REGION}"
echo "[INFO] 项目: ${GCP_PROJECT}"
echo "[INFO] 域名: ${ROOT_DOMAIN}"
echo "[INFO] 存储: gs://${GCS_BUCKET}"
echo ""

log_info() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

deploy_single_project() {
  local USER_PROJECT=$1
  local TMP="./tmp-${USER_PROJECT}"

  log_info "开始部署: ${USER_PROJECT}"
  mkdir -p ${TMP}

  gsutil -m cp gs://${GCS_BUCKET}/projects/${USER_PROJECT}/* ${TMP}/

  local CONFIG=$(ls ${TMP}/*.yaml 2>/dev/null | head -n1)
  local PROJECT_TAR=$(ls ${TMP}/*.tar 2>/dev/null | head -n1)

  if [ -z "$CONFIG" ]; then
    log_info "  [跳过] 未找到配置文件"
    rm -rf ${TMP}
    return
  fi
  if [ -z "$PROJECT_TAR" ]; then
    log_info "  [跳过] 未找到镜像文件"
    rm -rf ${TMP}
    return
  fi

  local USER_SUBDOMAIN=$(yq e '.user.subdomain' ${CONFIG})
  local IMG_NAME=$(yq e '.image.name' ${CONFIG})
  local TAG=$(yq e '.image.tag' ${CONFIG})
  local FULL_DOMAIN="${USER_SUBDOMAIN}.${ROOT_DOMAIN}"
  local SERVICE_NAME="${USER_PROJECT}"

  log_info "  子域名: ${FULL_DOMAIN}"
  log_info "  服务名: ${SERVICE_NAME}"

  gcloud auth configure-docker ${REGISTRY} --quiet

  log_info "  加载并推送镜像..."
  docker load -i ${PROJECT_TAR}
  local FULL_IMAGE="${REGISTRY}/${GCP_PROJECT}/${AR_REPO}/${IMG_NAME}:${TAG}"
  docker tag ${IMG_NAME}:amd64 ${FULL_IMAGE}
  docker push ${FULL_IMAGE}

  local CPU=$(yq e '.cloud_run.cpu // 2' ${CONFIG})
  local MEMORY=$(yq e '.cloud_run.memory // "4Gi"' ${CONFIG})
  local PORT=$(yq e '.cloud_run.port // 3000' ${CONFIG})
  local MIN_INSTANCES=$(yq e '.cloud_run.min_instances // 1' ${CONFIG})
  local MAX_INSTANCES=$(yq e '.cloud_run.max_instances // 10' ${CONFIG})

  log_info "  部署 Cloud Run 服务..."
  local DEPLOY_CMD="gcloud run deploy ${SERVICE_NAME} \
    --image=${FULL_IMAGE} \
    --platform=managed --region=${REGION} \
    --allow-unauthenticated --port=${PORT} \
    --cpu=${CPU} --memory=${MEMORY} \
    --min-instances=${MIN_INSTANCES} --max-instances=${MAX_INSTANCES} \
    --vpc-connector=${VPC_CONNECTOR} --vpc-egress=private-ranges-only"

  local ENV_VARS=$(yq e '.env | to_entries | map("\(.key)=\(.value)") | .[]' ${CONFIG} 2>/dev/null || true)
  if [ -n "${ENV_VARS}" ]; then
    while IFS= read -r line; do
      DEPLOY_CMD="${DEPLOY_CMD} --set-env-vars=\"${line}\""
    done <<< "${ENV_VARS}"
  fi

  DEPLOY_CMD="${DEPLOY_CMD} --quiet"
  eval ${DEPLOY_CMD}

  log_info "  配置域名: ${FULL_DOMAIN}"
  gcloud run domain-mappings create \
    --service=${SERVICE_NAME} \
    --region=${REGION} \
    --domain=${FULL_DOMAIN} \
    --quiet 2>&1 || true

  local RUN_TARGET=$(gcloud run domain-mappings describe \
    --domain=${FULL_DOMAIN} --region=${REGION} \
    --format='value(resourceRecords[0].rrdata)' 2>/dev/null || echo "")

  if [ -n "${RUN_TARGET}" ]; then
    gcloud dns record-sets transaction start --zone=${DNS_ZONE} 2>/dev/null || true
    gcloud dns record-sets transaction add ${RUN_TARGET} \
      --name=${FULL_DOMAIN}. --ttl=300 --type=A --zone=${DNS_ZONE} 2>/dev/null || true
    gcloud dns record-sets transaction execute --zone=${DNS_ZONE} 2>/dev/null || true
  fi

  local RESULT_JSON="{\"projectId\":\"${USER_PROJECT}\",\"domain\":\"https://${FULL_DOMAIN}\",\"service\":\"${SERVICE_NAME}\",\"status\":\"deployed\",\"timestamp\":\"$(date -Iseconds)\"}"
  echo "${RESULT_JSON}" > ${TMP}/deploy-result.json
  gsutil cp ${TMP}/deploy-result.json gs://${GCS_BUCKET}/projects/${USER_PROJECT}/deploy-result.json

  rm -rf ${TMP}

  log_info "  完成! 访问地址: https://${FULL_DOMAIN}"
  echo "${RESULT_JSON}"
}

echo "扫描用户项目..."
for USER_PROJECT in $(gsutil ls gs://${GCS_BUCKET}/projects/ 2>/dev/null | sed "s|gs://${GCS_BUCKET}/projects/||g" | sed 's|/||g' | sort -u); do
  if [ -n "$USER_PROJECT" ] && [ "$USER_PROJECT" != ".placeholder" ]; then
    echo "----------------------------------------"
    deploy_single_project "$USER_PROJECT" || log_info "  [失败] ${USER_PROJECT}"
    echo ""
  fi
done

echo "============================================"
echo " 扫描完成"
echo "============================================"