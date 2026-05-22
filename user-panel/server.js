const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const YAML = require('yaml');
const { v4: uuidv4 } = require('uuid');

const REGION = process.env.REGION || 'asia-east1';
const GCP_PROJECT = process.env.GCP_PROJECT || 'project-a8f8e3c3-9724-4306-9bb';
const GCS_BUCKET = process.env.GCS_BUCKET || 'image.aihubflux.com';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'aihubflux.com';
const AR_REPO = process.env.AR_REPO || 'my-app-repo';
const VPC_CONNECTOR = process.env.VPC_CONNECTOR || 'nexus-connector-v2';
const DNS_ZONE = process.env.DNS_ZONE || 'my-domain-zone';
const REGISTRY = `${REGION}-docker.pkg.dev`;
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'gcs-service-account.json');
const CHUNK_SIZE = 5 * 1024 * 1024;

const UPLOADS_DIR = '/tmp/uploads';
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getProjectDir(projectId) {
  const dir = path.join(UPLOADS_DIR, projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const sessions = new Map();

function getSessionDir(sessionId) {
  const dir = path.join(UPLOADS_DIR, '.chunks', sessionId);
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

const chunkStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sessionId = req.params.sessionId;
    cb(null, getSessionDir(sessionId));
  },
  filename: (req, file, cb) => {
    cb(null, 'chunk-' + req.body.chunkIndex);
  }
});
const chunkUpload = multer({ storage: chunkStorage, limits: { fileSize: CHUNK_SIZE } });

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

app.post('/api/init-upload', (req, res) => {
  const { fileName, totalSize } = req.body;
  if (!fileName) {
    return res.status(400).json({ error: '缺少文件名' });
  }

  const sessionId = uuidv4();
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  sessions.set(sessionId, {
    fileName,
    totalSize,
    totalChunks,
    receivedChunks: new Set(),
    createdAt: Date.now()
  });

  console.log(`[session] ${sessionId} 初始化: ${fileName}, ${totalChunks} 分片, ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
  res.json({ sessionId, totalChunks, chunkSize: CHUNK_SIZE });
});

app.post('/api/upload-chunk/:sessionId', chunkUpload.single('chunk'), (req, res) => {
  const { sessionId } = req.params;
  const { chunkIndex, totalChunks } = req.body;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在或已过期' });
  }

  const chunkIdx = parseInt(chunkIndex, 10);
  if (isNaN(chunkIdx) || chunkIdx < 0 || chunkIdx >= session.totalChunks) {
    return res.status(400).json({ error: '分片索引无效' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '缺少分片文件' });
  }

  session.receivedChunks.add(chunkIdx);
  session.lastActivity = Date.now();
  console.log(`[${sessionId}] 分片 ${chunkIdx + 1}/${session.totalChunks} 已接收`);

  res.json({
    success: true,
    chunkIndex: chunkIdx,
    received: session.receivedChunks.size,
    total: session.totalChunks
  });
});

app.post('/api/complete-upload/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { projectId, subdomain, envVars } = req.body;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在或已过期' });
  }

  if (!projectId || !validateProjectId(projectId)) {
    return res.status(400).json({ error: '项目ID无效' });
  }
  if (!subdomain || !validateSubdomain(subdomain)) {
    return res.status(400).json({ error: '二级域名无效' });
  }

  if (session.receivedChunks.size !== session.totalChunks) {
    return res.status(400).json({
      error: `分片不完整: 已收到 ${session.receivedChunks.size}/${session.totalChunks}`
    });
  }

  console.log(`[${sessionId}] 开始组装文件: ${session.fileName}`);
  const chunkDir = getSessionDir(sessionId);
  const dir = getProjectDir(projectId);
  const tarPath = path.join(dir, session.fileName);

  try {
    const writeStream = fs.createWriteStream(tarPath);
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(chunkDir, 'chunk-' + i);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    writeStream.end();
    console.log(`[${sessionId}] 文件组装完成: ${tarPath} (${(fs.statSync(tarPath).size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.error(`[${sessionId}] 文件组装失败:`, err.message);
    return res.status(500).json({ error: '文件组装失败: ' + err.message });
  }

  const imageName = session.fileName.replace('.tar', '');
  const yamlContent = buildConfigYaml({
    projectId, subdomain,
    imageName,
    tag: 'latest',
    envVars: envVars || {}
  });

  const yamlPath = path.join(dir, 'user-config.yaml');
  fs.writeFileSync(yamlPath, yamlContent);

  let gcsError = null;
  if (storage) {
    try {
      const bucket = storage.bucket(GCS_BUCKET);
      const prefix = `projects/${projectId}`;
      console.log(`[${projectId}] 上传镜像到 GCS: gs://${GCS_BUCKET}/${prefix}/${session.fileName}`);
      await bucket.upload(tarPath, {
        destination: `${prefix}/${session.fileName}`,
        resumable: true
      });
      console.log(`[${projectId}] 镜像上传 GCS 成功`);

      await bucket.file(`${prefix}/user-config.yaml`).save(yamlContent, {
        contentType: 'application/x-yaml'
      });
      console.log(`[${projectId}] YAML 上传 GCS 成功`);
    } catch (err) {
      console.error(`[${projectId}] GCS上传失败:`, err.message);
      gcsError = err.message;
    }
  } else {
    gcsError = 'GCS客户端未初始化';
  }

  try {
    fs.rmSync(chunkDir, { recursive: true, force: true });
  } catch (_) {}

  sessions.delete(sessionId);

  console.log(`[${projectId}] ✅ 部署完成: https://${subdomain}.${ROOT_DOMAIN}`);

  res.json({
    success: true,
    projectId,
    subdomain,
    expectedDomain: `https://${subdomain}.${ROOT_DOMAIN}`,
    message: storage
      ? '镜像已上传至 GCS，等待自动部署'
      : '文件已保存到服务器（GCS未连接，稍后自动重试）'
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

  res.json({ projectId, localFiles, gcsStatus: storage ? 'connected' : 'disconnected' });
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