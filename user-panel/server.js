const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const { CloudBuildClient } = require('@google-cloud/cloudbuild');
const YAML = require('yaml');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const REGION = process.env.REGION || 'asia-east1';
const GCP_PROJECT = process.env.GCP_PROJECT || 'project-a8f8e3c3-9724-4306-9bb';
const GCS_BUCKET = process.env.GCS_BUCKET || 'image.aihubflux.com';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'aihubflux.com';
const AR_REPO = process.env.AR_REPO || 'my-app-repo';
const VPC_CONNECTOR = process.env.VPC_CONNECTOR || 'nexus-connector-v2';
const DNS_ZONE = process.env.DNS_ZONE || 'my-domain-zone';
const REGISTRY = `${REGION}-docker.pkg.dev`;
const KEY_FILE = process.env.GCS_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'gcs-service-account.json');
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
let cloudBuild = null;
try {
  storage = new Storage({
    projectId: GCP_PROJECT,
    keyFilename: KEY_FILE
  });
  console.log('GCS 客户端已初始化');

  cloudBuild = new CloudBuildClient({
    projectId: GCP_PROJECT
  });
  console.log('Cloud Build 客户端已初始化');
} catch (err) {
  console.error('GCP 客户端初始化失败:', err.message);
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

const JWT_SECRET = process.env.JWT_SECRET || 'auto-gcloud-jwt-secret-' + (GCP_PROJECT || 'default');
const USERS_FILE = 'admin/users.json';
const TOKEN_EXPIRY = '7d';

let users = [];

async function loadUsers() {
  if (!storage) return;
  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const [exists] = await bucket.file(USERS_FILE).exists();
    if (exists) {
      const [data] = await bucket.file(USERS_FILE).download();
      users = JSON.parse(data.toString());
      console.log(`已加载 ${users.length} 个用户`);
    } else {
      users = [];
    }
  } catch (err) {
    console.error('加载用户数据失败:', err.message);
    users = [];
  }
  await ensureAdminUser();
}

async function saveUsers() {
  if (!storage) return;
  try {
    const bucket = storage.bucket(GCS_BUCKET);
    await bucket.file(USERS_FILE).save(JSON.stringify(users, null, 2), {
      contentType: 'application/json'
    });
  } catch (err) {
    console.error('保存用户数据失败:', err.message);
  }
}

async function ensureAdminUser() {
  const adminExists = users.find(u => u.role === 'admin');
  if (!adminExists) {
    const hash = await bcrypt.hash('admin123', 10);
    users.push({
      id: uuidv4(),
      username: 'admin',
      password: hash,
      role: 'admin',
      enabled: true,
      createdAt: new Date().toISOString()
    });
    console.log('已创建默认管理员: admin / admin123');
    await saveUsers();
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find(u => u.id === payload.userId);
    if (!user || !user.enabled) {
      return res.status(401).json({ error: '账号已被禁用或不存在' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: '用户名格式无效（3-32位，字母数字下划线短横线）' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username,
      password: hash,
      role: 'user',
      enabled: true,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await saveUsers();
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('注册失败:', err.message);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (!user.enabled) {
      return res.status(401).json({ error: '账号已被禁用，请联系管理员' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('登录失败:', err.message);
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const list = users.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    enabled: u.enabled,
    createdAt: u.createdAt
  }));
  res.json({ users: list });
});

app.post('/api/admin/users/:userId/toggle', authMiddleware, adminMiddleware, async (req, res) => {
  const user = users.find(u => u.id === req.params.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (user.username === 'admin') {
    return res.status(400).json({ error: '不能操作默认管理员' });
  }
  user.enabled = !user.enabled;
  await saveUsers();
  res.json({ success: true, enabled: user.enabled });
});

app.delete('/api/admin/users/:userId', authMiddleware, adminMiddleware, async (req, res) => {
  const user = users.find(u => u.id === req.params.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  if (user.username === 'admin') {
    return res.status(400).json({ error: '不能删除默认管理员' });
  }
  users = users.filter(u => u.id !== req.params.userId);
  await saveUsers();
  res.json({ success: true });
});

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

app.post('/api/init-upload', authMiddleware, (req, res) => {
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

app.put('/api/upload-chunk/:sessionId',
  express.raw({ limit: CHUNK_SIZE + 1024 * 1024, type: 'application/octet-stream' }),
  authMiddleware,
  (req, res) => {
    const { sessionId } = req.params;
    const chunkIndex = parseInt(req.query.chunkIndex, 10);

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: '会话不存在或已过期' });
    }

    if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return res.status(400).json({ error: '分片索引无效' });
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: '分片数据为空' });
    }

    try {
      const chunkDir = getSessionDir(sessionId);
      const chunkPath = path.join(chunkDir, 'chunk-' + chunkIndex);
      fs.writeFileSync(chunkPath, req.body);
      console.log(`[${sessionId}] 分片 ${chunkIndex + 1}/${session.totalChunks} 已保存 (${(req.body.length / 1024).toFixed(1)}KB)`);
    } catch (err) {
      console.error(`[${sessionId}] 写入分片失败:`, err.message);
      return res.status(500).json({ error: '写入分片失败: ' + err.message });
    }

    session.receivedChunks.add(chunkIndex);
    session.lastActivity = Date.now();

    res.json({
      success: true,
      chunkIndex: chunkIndex,
      received: session.receivedChunks.size,
      total: session.totalChunks
    });
  }
);

function assembleFile(chunkDir, tarPath, totalChunks) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(tarPath);
    writeStream.on('finish', () => {
      const size = fs.statSync(tarPath).size;
      resolve(size);
    });
    writeStream.on('error', reject);

    let i = 0;
    function writeNext() {
      if (i >= totalChunks) {
        writeStream.end();
        return;
      }
      try {
        const chunkPath = path.join(chunkDir, 'chunk-' + i);
        const data = fs.readFileSync(chunkPath);
        writeStream.write(data);
        i++;
        setImmediate(writeNext);
      } catch (err) {
        writeStream.destroy();
        reject(err);
      }
    }
    writeNext();
  });
}

async function submitCloudBuildDeploy(session, projectId, subdomain, imageName, envVars) {
  session.status = 'deploying';
  session.buildLogUrl = null;
  const serviceName = projectId;
  const imageUrl = `${REGISTRY}/${GCP_PROJECT}/${AR_REPO}/${imageName}:latest`;
  const envString = Object.entries(envVars || {}).map(([k, v]) => `${k}=${v}`).join(',');

  const build = {
    steps: [
      {
        name: 'gcr.io/cloud-builders/gsutil',
        args: ['cp', `gs://${GCS_BUCKET}/projects/${projectId}/${imageName}.tar`, '/workspace/image.tar']
      },
      {
        name: 'gcr.io/cloud-builders/docker',
        entrypoint: 'bash',
        args: [
          '-c',
          [
            'set -e',
            'docker load -i /workspace/image.tar',
            `LOADED_TAG=$$(docker images | tail -n +2 | head -1 | tr -s ' ' | cut -d' ' -f1,2 | tr ' ' ':')`,
            `echo "Loaded image: $$LOADED_TAG"`,
            `docker tag $$LOADED_TAG ${imageUrl}`,
            `docker push ${imageUrl}`
          ].join('\n')
        ]
      },
      {
        name: 'gcr.io/google.com/cloudsdktool/cloud-sdk',
        entrypoint: 'bash',
        args: [
          '-c',
          [
            'set -e',
            `gcloud run deploy ${serviceName} --image=${imageUrl} --platform=managed --region=${REGION} --port=3000 --cpu=2 --memory=4Gi --min-instances=1 --max-instances=10 --allow-unauthenticated --concurrency=80 --timeout=600 --no-cpu-throttling --quiet` + (envString ? ` --set-env-vars="${envString}"` : ''),
            `SERVICE_URL=$$(gcloud run services describe ${serviceName} --region=${REGION} --format="value(status.url)")`,
            `echo "URL: $$SERVICE_URL"`,
            `echo $$SERVICE_URL | gsutil cp - gs://${GCS_BUCKET}/projects/${projectId}/service-url.txt`
          ].join('\n')
        ]
      }
    ],
    timeout: { seconds: 1800 },
    logsBucket: `gs://${GCS_BUCKET}/logs`
  };

  try {
    console.log(`[${projectId}] 提交 Cloud Build 部署任务...`);
    const [operation] = await cloudBuild.createBuild({
      projectId: GCP_PROJECT,
      build: build
    });
    const buildId = operation.metadata.build.id;
    session.buildId = buildId;
    session.buildLogUrl = `https://console.cloud.google.com/cloud-build/builds/${buildId}?project=${GCP_PROJECT}`;
    console.log(`[${projectId}] Cloud Build 已提交: ${buildId}`);
    console.log(`[${projectId}] 日志: ${session.buildLogUrl}`);
    return { buildId, logUrl: session.buildLogUrl };
  } catch (err) {
    console.error(`[${projectId}] Cloud Build 提交失败:`, err.message);
    session.status = 'error';
    session.error = 'Cloud Build 部署失败: ' + err.message;
    return null;
  }
}

async function processDeploy(sessionId, session, projectId, subdomain, envVars) {
  session.status = 'assembling';
  const chunkDir = getSessionDir(sessionId);
  const dir = getProjectDir(projectId);
  const tarPath = path.join(dir, session.fileName);

  try {
    console.log(`[${sessionId}] 开始组装文件: ${session.fileName}`);
    const tarSize = await assembleFile(chunkDir, tarPath, session.totalChunks);
    console.log(`[${sessionId}] 文件组装完成: ${(tarSize / 1024 / 1024).toFixed(1)}MB`);
  } catch (err) {
    console.error(`[${sessionId}] 文件组装失败:`, err.message);
    session.status = 'error';
    session.error = '文件组装失败: ' + err.message;
    return;
  }

  const imageName = session.fileName.replace('.tar', '');
  const yamlContent = buildConfigYaml({ projectId, subdomain, imageName, tag: 'latest', envVars: envVars || {} });
  const yamlPath = path.join(dir, 'user-config.yaml');
  fs.writeFileSync(yamlPath, yamlContent);

  if (storage) {
    session.status = 'uploading';
    try {
      const bucket = storage.bucket(GCS_BUCKET);
      const prefix = `projects/${projectId}`;
      console.log(`[${projectId}] 上传镜像到 GCS: gs://${GCS_BUCKET}/${prefix}/${session.fileName}`);
      await bucket.upload(tarPath, {
        destination: `${prefix}/${session.fileName}`,
        resumable: true
      });
      console.log(`[${projectId}] 镜像上传 GCS 成功`);

      await bucket.file(`${prefix}/user-config.yaml`).save(yamlContent, { contentType: 'application/x-yaml' });
      session.status = 'uploaded';
      console.log(`[${projectId}] YAML 上传 GCS 成功`);

      await submitCloudBuildDeploy(session, projectId, subdomain, imageName, envVars);
    } catch (err) {
      console.error(`[${projectId}] GCS上传失败:`, err.message);
      session.status = 'error';
      session.error = 'GCS上传失败: ' + err.message;
      return;
    }
  } else {
    session.status = 'done';
  }

  try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch (_) {}
}

app.post('/api/complete-upload/:sessionId', authMiddleware, (req, res) => {
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

  if (session.status === 'assembling' || session.status === 'uploading') {
    return res.json({ success: true, processing: true, message: '已在处理中' });
  }

  session.status = 'processing';
  session.projectId = projectId;
  session.subdomain = subdomain;
  console.log(`[${sessionId}] 已接收，后台处理中...`);

  processDeploy(sessionId, session, projectId, subdomain, envVars);

  res.json({
    success: true,
    processing: true,
    projectId,
    subdomain,
    message: '分片已完整接收，正在后台组装 → 上传 GCS → 自动部署 Cloud Run，请稍候查看状态'
  });
});

app.get('/api/deploy-status/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.json({ status: 'gone', message: '部署已完成或会话已过期' });
  }

  if (!session.serviceUrl && session.status === 'deploying' && session.projectId && storage) {
    try {
      const [data] = await storage.bucket(GCS_BUCKET)
        .file(`projects/${session.projectId}/service-url.txt`)
        .download();
      const url = data.toString().trim();
      if (url && url.startsWith('https://')) {
        session.serviceUrl = url;
        session.status = 'done';
        console.log(`[${session.projectId}] 服务已部署: ${url}`);
      }
    } catch (_) {}
  }

  const result = {
    status: session.status || 'received',
    totalChunks: session.totalChunks,
    receivedChunks: session.receivedChunks ? session.receivedChunks.size : 0,
    projectId: session.projectId,
    subdomain: session.subdomain,
    serviceUrl: session.serviceUrl || null
  };
  if (session.error) result.error = session.error;
  if (session.buildId) result.buildId = session.buildId;
  if (session.buildLogUrl) result.buildLogUrl = session.buildLogUrl;
  res.json(result);
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
app.listen(PORT, async () => {
  await loadUsers();
  console.log(`管理面板: http://localhost:${PORT}`);
  console.log(`GCS 桶:   gs://${GCS_BUCKET}`);
  console.log(`域名:     *.${ROOT_DOMAIN}`);
  console.log(`本地存储: ${UPLOADS_DIR}`);
});