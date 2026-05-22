#!/bin/bash
set -euo pipefail

echo "============================================"
echo " Auto GCloud - 本地构建镜像脚本"
echo "============================================"

REGION="${REGION:-asia-east1}"
GCP_PROJECT="${GCP_PROJECT:-project-a8f8e3c3-9724-4306-9bb}"
AR_REPO="${AR_REPO:-my-app-repo}"
SERVICE_NAME="${SERVICE_NAME:-auto-gcloud-panel}"
REGISTRY="${REGION}-docker.pkg.dev"
IMAGE_URL="${REGISTRY}/${GCP_PROJECT}/${AR_REPO}/${SERVICE_NAME}"

echo ""
echo "配置:"
echo "  GCP 项目:  ${GCP_PROJECT}"
echo "  区域:      ${REGION}"
echo "  镜像地址:  ${IMAGE_URL}"
echo ""

echo "[1/3] 配置 gcloud..."
gcloud config set project ${GCP_PROJECT}
gcloud config set compute/region ${REGION}

echo "[2/3] 启用 Artifact Registry..."
gcloud services enable artifactregistry.googleapis.com --project=${GCP_PROJECT}

# 检查仓库是否存在
if ! gcloud artifacts repositories describe ${AR_REPO} --location=${REGION} --project=${GCP_PROJECT} 2>/dev/null; then
  echo "  创建镜像仓库..."
  gcloud artifacts repositories create ${AR_REPO} \
    --repository-format=docker \
    --location=${REGION} \
    --project=${GCP_PROJECT}
fi

echo "[3/3] 使用 Cloud Build 构建镜像..."
gcloud builds submit \
  --project=${GCP_PROJECT} \
  --region=${REGION} \
  --tag=${IMAGE_URL}:latest \
  --machine-type=e2-medium \
  --timeout=20m \
  .

echo ""
echo "============================================"
echo " 镜像构建完成！"
echo "============================================"
echo ""
echo "镜像地址: ${IMAGE_URL}:latest"
echo ""
echo "下一步:"
echo "  1. 部署到 Cloud Run:"
echo "     gcloud run deploy ${SERVICE_NAME} --image=${IMAGE_URL}:latest --region=${REGION} --allow-unauthenticated"
echo ""
