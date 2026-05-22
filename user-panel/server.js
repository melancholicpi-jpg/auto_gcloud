const express = require('express');
const multer = require('multer');
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

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getProjectDir(projectId) {
  const dir = path.join(UPLOADS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const diskStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const projectId = req.body.projectId || req.params?.projectId || 'unknown';
    cb(null, getProjectDir(projectId));
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

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

async function uploadToGCS(projectId) {
  const key = projectId;
  if (gcsUploadStatus.get(key)?.status === 'uploading') return;

  const dir = getProjectDir(projectId);
  const files = fs.readdirSync(dir);
  const tarFile = files.find(f => f.endsWith('.tar'));
  const yamlFile = files.find(f => f === 'user-config.yaml' || f.endsWith('.yaml'));

  if (!storage || !tarFile) {
    gcsUploadStatus.set(key, {
      status: 'failed',
      error: !storage ? 'GCS客户端未初始化' : '缺少tar文件'
    });
    return;
  }

  gcsUploadStatus.set(key, { status: 'uploading', startedAt: new Date().toISOString() });

  const bucket = storage.bucket(GCS_BUCKET);
  const prefix = `projects/${projectId}`;

  try {
    console.log(`[${projectId}] 开始GCS上传: gs://${GCS_BUCKET}/${prefix}/`);
    await bucket.upload(path.join(dir, tarFile), {
      destination: `${prefix}/${tarFile}`,
      resumable: true
    });
    console.log(`[${projectId}] 镜像上传成功: ${tarFile}`);

    await bucket.upload(path.join(dir, yamlFile), {
      destination: `${prefix}/${yamlFile}`
    });
    console.log(`[${projectId}] YAML上传成功`);

    gcsUploadStatus.set(key, {
      status: 'done',
      completedAt: new Date().toISOString(),
      prefix
    });
    console.log(`[${projectId}] ✅ GCS同步完成`);
  } catch (err) {
    const errMsg = err.message || String(err);
    console.error(`[${projectId}] GCS上传失败: ${errMsg}`);
    if (errMsg.includes('oauth2') || errMsg.includes('token') || errMsg.includes('ENOTFOUND') || errMsg.includes('ECONNREFUSED')) {
      console.error(`[${projectId}] 网络不通，无法连接Google OAuth，请在能访问Google网络的服务器上运行`);
    }
    gcsUploadStatus.set(key, {
      status: 'failed',
      error: errMsg.slice(0, 200),
      failedAt: new Date().toISOString()
    });
  }
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

app.post('/api/submit', upload.fields([
  { name: 'projectImage', maxCount: 1 },
  { name: 'configYaml', maxCount: 1 }
]), async (req, res) => {
  console.log('=== 收到提交请求 ===');

  const files = req.files || {};
  const { projectId, subdomain } = req.body;

  if (!projectId || !validateProjectId(projectId)) {
    return res.status(400).json({ error: '项目ID无效' });
  }
  if (!subdomain || !validateSubdomain(subdomain)) {
    return res.status(400).json({ error: '二级域名无效' });
  }

  const imageFile = files.projectImage?.[0];
  if (!imageFile) {
    return res.status(400).json({ error: '缺少项目镜像' });
  }

  const dir = getProjectDir(projectId);
  let yamlContent;

  if (files.configYaml?.[0]) {
    yamlContent = fs.readFileSync(files.configYaml[0].path, 'utf-8');
    try { YAML.parse(yamlContent); } catch {
      return res.status(400).json({ error: 'YAML 格式错误' });
    }
  } else {
    yamlContent = buildConfigYaml({
      projectId, subdomain,
      imageName: imageFile.originalname.replace('.tar', ''),
      tag: 'latest', envVars: {}
    });
  }

  const yamlPath = path.join(dir, 'user-config.yaml');
  fs.writeFileSync(yamlPath, yamlContent);

  console.log(`[${projectId}] 本地保存完成，文件: ${fs.readdirSync(dir).join(', ')}`);

  res.json({
    success: true,
    projectId,
    subdomain,
    expectedDomain: `https://${subdomain}.${ROOT_DOMAIN}`,
    message: '文件已保存到服务器，正在同步至GCS，预计1-3分钟后可通过域名访问'
  });

  uploadToGCS(projectId);
});

app.get('/api/upload-status/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const dir = getProjectDir(projectId);
  const files = fs.readdirSync(dir);

  const gcs = gcsUploadStatus.get(projectId);
  const localFiles = files.map(f => {
    const stat = fs.statSync(path.join(dir, f));
    return { name: f, size: stat.size };
  });

  res.json({
    projectId,
    localFiles,
    gcsStatus: gcs?.status || 'pending',
    gcsError: gcs?.error || null
  });
});

const PORT = process.env.PORT || 9002;
app.listen(PORT, () => {
  console.log(`管理面板: http://localhost:${PORT}`);
  console.log(`GCS 桶:   gs://${GCS_BUCKET}`);
  console.log(`域名:     *.${ROOT_DOMAIN}`);
  console.log(`本地存储: ${UPLOADS_DIR}`);
});