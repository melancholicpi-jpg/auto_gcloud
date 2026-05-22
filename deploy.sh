#!/bin/bash
set -euo pipefail

echo "============================================"
echo " Auto GCloud - 管理面板部署到 Cloud Run"
echo "============================================"

REGION="${REGION:-asia-east1}"
GCP_PROJECT="${GCP_PROJECT:-project-a8f8e3c3-9724-4306-9bb}"
ROOT_DOMAIN="${ROOT_DOMAIN:-aihubflux.com}"
GCS_BUCKET="${GCS_BUCKET:-image.aihubflux.com}"
AR_REPO="${AR_REPO:-my-app-repo}"
VPC_CONNECTOR="${VPC_CONNECTOR:-nexus-connector-v2}"
DNS_ZONE="${DNS_ZONE:-my-domain-zone}"
SERVICE_NAME="${SERVICE_NAME:-auto-gcloud-panel}"
SECRET_NAME="${SECRET_NAME:-gcs-service-account}"
SECRET_MOUNT_PATH="${SECRET_MOUNT_PATH:-/app/secrets}"

CREDENTIALS_FILE="${CREDENTIALS_FILE:-${PWD}/gcs-service-account.json}"

REGISTRY="${REGION}-docker.pkg.dev"
IMAGE_URL="${REGISTRY}/${GCP_PROJECT}/${AR_REPO}/${SERVICE_NAME}"

echo ""
echo "全局配置:"
echo "  区域:              ${REGION}"
echo "  GCP 项目:          ${GCP_PROJECT}"
echo "  GCS 桶:            gs://${GCS_BUCKET}"
echo "  一级域名:          ${ROOT_DOMAIN}"
echo "  镜像仓库:          ${AR_REPO}"
echo "  VPC 连接器:        ${VPC_CONNECTOR}"
echo "  服务名:            ${SERVICE_NAME}"
echo "  镜像地址:          ${IMAGE_URL}"
echo ""

echo "[1/7] 检查凭证文件..."
if [ ! -f "${CREDENTIALS_FILE}" ]; then
  echo "  错误: 找不到凭证文件: ${CREDENTIALS_FILE}"
  echo "  设置 CREDENTIALS_FILE 环境变量指向正确路径"
  exit 1
fi
echo "  凭证文件: ${CREDENTIALS_FILE}"

echo "[2/7] 上传 GCS 凭证到 Secret Manager..."
if gcloud secrets describe ${SECRET_NAME} --project=${GCP_PROJECT} &>/dev/null 2>&1; then
  echo "  密钥已存在，更新版本..."
  gcloud secrets versions add ${SECRET_NAME} \
    --data-file="${CREDENTIALS_FILE}" \
    --project=${GCP_PROJECT}
else
  echo "  创建密钥..."
  gcloud secrets create ${SECRET_NAME} \
    --data-file="${CREDENTIALS_FILE}" \
    --project=${GCP_PROJECT} \
    --replication-policy=automatic
fi
echo "  密钥已就绪"

echo "[3/7] 启用必要 API..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  --project=${GCP_PROJECT} 2>/dev/null || true
echo "  API 已启用"

echo "[4/7] 构建 Docker 镜像..."
gcloud builds submit \
  --project=${GCP_PROJECT} \
  --region=${REGION} \
  --tag=${IMAGE_URL}:latest \
  --machine-type=e2-medium \
  --timeout=20m \
  .
echo "  镜像构建并推送完成: ${IMAGE_URL}:latest"

echo "[5/7] 部署到 Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --project=${GCP_PROJECT} \
  --region=${REGION} \
  --image=${IMAGE_URL}:latest \
  --platform=managed \
  --port=8080 \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=1 \
  --max-instances=5 \
  --concurrency=80 \
  --timeout=600 \
  --allow-unauthenticated \
  --set-env-vars="GCS_BUCKET=${GCS_BUCKET},ROOT_DOMAIN=${ROOT_DOMAIN},REGION=${REGION},GCP_PROJECT=${GCP_PROJECT},AR_REPO=${AR_REPO},VPC_CONNECTOR=${VPC_CONNECTOR},DNS_ZONE=${DNS_ZONE},GOOGLE_APPLICATION_CREDENTIALS=${SECRET_MOUNT_PATH}/${SECRET_NAME}.json" \
  --set-secrets="${SECRET_MOUNT_PATH}/${SECRET_NAME}.json=${SECRET_NAME}:latest" \
  --no-cpu-throttling

echo "  部署完成"

echo "[6/7] 获取服务 URL..."
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} \
  --project=${GCP_PROJECT} \
  --region=${REGION} \
  --format='value(status.url)')
echo "  服务 URL: ${SERVICE_URL}"

echo "[7/7] 配置自定义域名 (可选)..."
PANEL_SUBDOMAIN="${PANEL_SUBDOMAIN:-panel}"
FULL_DOMAIN="${PANEL_SUBDOMAIN}.${ROOT_DOMAIN}"
echo "  尝试绑定域名: ${FULL_DOMAIN}"

if gcloud beta run domain-mappings describe \
  --domain=${FULL_DOMAIN} \
  --region=${REGION} \
  --project=${GCP_PROJECT} &>/dev/null 2>&1; then
  echo "  域名已绑定: ${FULL_DOMAIN}"
else
  gcloud beta run domain-mappings create \
    --service=${SERVICE_NAME} \
    --domain=${FULL_DOMAIN} \
    --region=${REGION} \
    --project=${GCP_PROJECT} || echo "  (域名绑定可稍后手动完成)"
fi

echo ""
echo "============================================"
echo " 部署完成！"
echo "============================================"
echo ""
echo "访问方式:"
echo "  Cloud Run URL: ${SERVICE_URL}"
echo "  自定义域名:    https://${FULL_DOMAIN}"
echo ""
echo "管理命令:"
echo "  查看日志:      gcloud logging read \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}\" --limit=50"
echo "  重新部署:      bash deploy.sh"
echo "  流量管理:      gcloud run services update-traffic ${SERVICE_NAME} --region=${REGION}"
echo ""