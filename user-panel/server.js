const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const YAML = require('yaml');

const REGION = process.env.REGION || 'asia-east1';
const GCP_PROJECT = process.env.GCP_PROJECT || 'project-a8f8e3c3-9724-4306-9bb';
const GCS_BUCKET = process.env.GCS_BUCKET || 'image.aihubflux.com';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'aihubflux.com';
const AR_REPO = process.env.AR_REPO || 'my-app-repo';
const VPC_CONNECTOR = process.env.VPC_CONNECTOR || 'nexus-connector-v2';
const DNS_ZONE = process.env.DNS_ZONE || 'my-domain-zone';
const REGISTRY = `${REGION}-docker.pkg.dev`;
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'gcs-service-account.json');
const UPLOAD_URL_EXPIRY = 60 * 60 * 1000;

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getProjectDir(projectId) {
  const dir = path.join(UPLOADS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let storage = null;
try {
  storage = new Storage({
    projectId: GCP_PROJECT,
    keyFilename: KEY_FILE
  });
  console.log(`GCS 客户端已初始化: ${KEY_FILE}`);
} catch (err) {
  console.error('GCS 客户端初始化失败:', err.message);
}

const gcsUploadStatus = new Map();

function validateSubdomain(s) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && s.length >= 3 && s.length <= 20;
}
function validateProjectId(s) {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && s.length >= 3 && s.length <= 63;
}

function buildConfigYaml({ projectId, subdomain, imageName, tag, envVars }) {
  const defaults = {
    NODE_ENV: 'production',
    API_URL: `https://${subdomain}.${ROOT_DOMAIN}`,
    CORS_ORIGIN: `https://${subdomain}.${ROOT_DOMAIN}`,
    ...envVars
  };
  return `# ====================== 用户配置 ======================
user:
  project_id: "${projectId}"
  subdomain: "${subdomain}"

image:
  name: "${imageName}"
  tag: "${tag || 'latest'}"

cloud_run:
  cpu: 2
  memory: "4Gi"
  port: 3000
  min_instances: 1
  max_instances: 10

env:
${Object.entries(defaults).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}
`;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/api/')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

app.get('/api/config', (_req, res) => {
  res.json({
    region: REGION, project: GCP_PROJECT, bucket: GCS_BUCKET,
    rootDomain: ROOT_DOMAIN, arRepo: AR_REPO,
    vpcConnector: VPC_CONNECTOR, dnsZone: DNS_ZONE, registry: REGISTRY
  });
});

app.get('/api/generate-template', (req, res) => {
  const { subdomain, projectId } = req.query;
  if (!subdomain || !validateSubdomain(subdomain)) {
    return res.status(400).json({ error: '二级域名格式无效' });
  }
  if (!projectId || !validateProjectId(projectId)) {
    return res.status(400).json({ error: '项目ID格式无效' });
  }
  res.json({ yaml: buildConfigYaml({
    projectId, subdomain, imageName: 'project-app', tag: 'latest', envVars: {}
  }) });
});

app.post('/api/init-upload', async (req, res) => {
  const { projectId, fileName } = req.body;
  if (!projectId || !validateProjectId(projectId)) {
    return res.status(400).json({ error: '项目ID无效' });
  }
  if (!fileName) {
    return res.status(400).json({ error: '缺少文件名' });
  }
  if (!storage) {
    return res.status(500).json({ error: 'GCS客户端未初始化' });
  }

  const gcsPath = `projects/${projectId}/${fileName}`;
  const file = storage.bucket(GCS_BUCKET).file(gcsPath);

  try {
    const [url] = await file.getSignedUrl({
      action: 'write',
      expires: Date.now() + UPLOAD_URL_EXPIRY,
      contentType: 'application/x-tar'
    });
    console.log(`[${projectId}] 已生成签名URL: ${gcsPath}`);
    res.json({ uploadUrl: url, gcsPath, bucket: GCS_BUCKET });
  } catch (err) {
    console.error(`[${projectId}] 签名URL生成失败:`, err.message);
    res.status(500).json({ error: '签名URL生成失败: ' + err.message });
  }
});

app.post('/api/submit', async (req, res) => {
  console.log('=== 收到部署提交 ===');

  const { projectId, subdomain, gcsPath, envVars } = req.body;

  if (!projectId || !validateProjectId(projectId)) {
    return res.status(400).json({ error: '项目ID无效' });
  }
  if (!subdomain || !validateSubdomain(subdomain)) {
    return res.status(400).json({ error: '二级域名无效' });
  }
  if (!gcsPath) {
    return res.status(400).json({ error: '缺少GCS文件路径' });
  }
  if (!storage) {
    return res.status(500).json({ error: 'GCS客户端未初始化' });
  }

  const dir = getProjectDir(projectId);
  const imageName = path.basename(gcsPath).replace('.tar', '');

  const yamlContent = buildConfigYaml({
    projectId, subdomain,
    imageName,
    tag: 'latest',
    envVars: envVars || {}
  });

  const yamlPath = path.join(dir, 'user-config.yaml');
  fs.writeFileSync(yamlPath, yamlContent);

  console.log(`[${projectId}] YAML 已生成: ${gcsPath}`);

  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const yamlGcsPath = `projects/${projectId}/user-config.yaml`;
    await bucket.file(yamlGcsPath).save(yamlContent, {
      contentType: 'application/x-yaml'
    });
    console.log(`[${projectId}] YAML 已上传到 GCS: ${yamlGcsPath}`);
  } catch (err) {
    console.error(`[${projectId}] YAML GCS上传失败:`, err.message);
  }

  console.log(`[${projectId}] 部署已提交，镜像: gs://${GCS_BUCKET}/${gcsPath}`);

  res.json({
    success: true,
    projectId,
    subdomain,
    expectedDomain: `https://${subdomain}.${ROOT_DOMAIN}`,
    gcsPath,
    message: '部署已提交，Cloud Function 将在检测到文件后自动部署'
  });
});

app.get('/api/upload-status/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const dir = getProjectDir(projectId);
  let localFiles = [];
  try {
    localFiles = fs.readdirSync(dir).map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, size: stat.size };
    });
  } catch (_) {}

  const gcs = gcsUploadStatus.get(projectId);
  res.json({
    projectId,
    localFiles,
    gcsStatus: gcs?.status || 'pending',
    gcsError: gcs?.error || null
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    gcsReady: !!storage,
    bucket: GCS_BUCKET,
    rootDomain: ROOT_DOMAIN
  });
});

const PORT = process.env.PORT || 9002;
app.listen(PORT, () => {
  console.log(`管理面板: http://localhost:${PORT}`);
  console.log(`GCS 桶:   gs://${GCS_BUCKET}`);
  console.log(`域名:     *.${ROOT_DOMAIN}`);
  console.log(`本地存储: ${UPLOADS_DIR}`);
});