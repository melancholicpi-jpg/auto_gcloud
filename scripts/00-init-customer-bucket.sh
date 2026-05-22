#!/bin/bash
set -euo pipefail

echo "============================================"
echo " Auto GCloud - 基础设施初始化"
echo "============================================"

REGION="${REGION:-asia-east1}"
GCP_PROJECT="${GCP_PROJECT:-project-a8f8e3c3-9724-4306-9bb}"
ROOT_DOMAIN="${ROOT_DOMAIN:-aihubflux.com}"
GCS_CUSTOMER_BUCKET="${GCS_CUSTOMER_BUCKET:-customer}"
AR_REPO="${AR_REPO:-my-app-repo}"
VPC_CONNECTOR="${VPC_CONNECTOR:-nexus-connector-v2}"
DNS_ZONE="${DNS_ZONE:-my-domain-zone}"

echo ""
echo "全局配置:"
echo "  区域 (REGION):        ${REGION}"
echo "  GCP 项目:             ${GCP_PROJECT}"
echo "  一级域名:             ${ROOT_DOMAIN}"
echo "  用户上传桶:           gs://${GCS_CUSTOMER_BUCKET}"
echo "  镜像仓库:             ${AR_REPO}"
echo "  VPC 连接器:           ${VPC_CONNECTOR}"
echo "  DNS 托管区:           ${DNS_ZONE}"
echo ""

echo "[1/5] 启用必要 API..."
gcloud services enable cloudfunctions.googleapis.com --project=${GCP_PROJECT}
gcloud services enable eventarc.googleapis.com --project=${GCP_PROJECT}
gcloud services enable run.googleapis.com --project=${GCP_PROJECT}
gcloud services enable artifactregistry.googleapis.com --project=${GCP_PROJECT}
gcloud services enable dns.googleapis.com --project=${GCP_PROJECT}
gcloud services enable cloudbuild.googleapis.com --project=${GCP_PROJECT}
echo "  API 已启用"

echo "[2/5] 创建用户上传桶: ${GCS_CUSTOMER_BUCKET}..."
if gsutil ls -p ${GCP_PROJECT} gs://${GCS_CUSTOMER_BUCKET} &>/dev/null; then
  echo "  桶已存在: gs://${GCS_CUSTOMER_BUCKET}"
else
  gsutil mb -p ${GCP_PROJECT} -l ${REGION} gs://${GCS_CUSTOMER_BUCKET}
  echo "  桶已创建"
fi

gsutil uniformbucketlevelaccess set on gs://${GCS_CUSTOMER_BUCKET}
gsutil iam ch allUsers:legacyObjectReader gs://${GCS_CUSTOMER_BUCKET} || true
echo "  权限已配置"

echo "[3/5] 创建桶内标准目录..."
touch /tmp/.gcs_placeholder
gsutil cp /tmp/.gcs_placeholder gs://${GCS_CUSTOMER_BUCKET}/templates/.placeholder
gsutil cp /tmp/.gcs_placeholder gs://${GCS_CUSTOMER_BUCKET}/projects/.placeholder
gsutil cp /tmp/.gcs_placeholder gs://${GCS_CUSTOMER_BUCKET}/logs/.placeholder
rm /tmp/.gcs_placeholder
echo "  目录已创建"

echo "[4/5] 创建镜像仓库..."
if gcloud artifacts repositories describe ${AR_REPO} \
  --location=${REGION} --project=${GCP_PROJECT} &>/dev/null; then
  echo "  仓库已存在: ${AR_REPO}"
else
  gcloud artifacts repositories create ${AR_REPO} \
    --repository-format=docker \
    --location=${REGION} \
    --project=${GCP_PROJECT} \
    --description="Auto GCloud 镜像仓库"
  echo "  仓库已创建"
fi

echo "[5/5] 初始化 Docker 认证..."
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
echo "  Docker 认证已配置"

echo ""
echo "============================================"
echo " 初始化完成！"
echo "============================================"
echo ""
echo "下一步:"
echo "  1. 部署管理面板: cd user-panel && npm install && npm start"
echo "  2. 部署 Cloud Function: bash cloud-function/deploy.sh"
echo "  3. 访问管理面板上传项目"
echo ""