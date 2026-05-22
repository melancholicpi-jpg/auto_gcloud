const { Storage } = require('@google-cloud/storage');
const YAML = require('yaml');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REGION = process.env.REGION || 'asia-east1';
const GCP_PROJECT = process.env.GCP_PROJECT || 'project-a8f8e3c3-9724-4306-9bb';
const GCS_BUCKET = process.env.GCS_BUCKET || 'image.aihubflux.com';
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'aihubflux.com';
const AR_REPO = process.env.AR_REPO || 'my-app-repo';
const VPC_CONNECTOR = process.env.VPC_CONNECTOR || 'nexus-connector-v2';
const DNS_ZONE = process.env.DNS_ZONE || 'my-domain-zone';
const REGISTRY = `${REGION}-docker.pkg.dev`;

const storage = new Storage({
  projectId: GCP_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'gcs-service-account.json')
});

function execLog(command, cwd) {
  console.log(`[EXEC] ${command}`);
  try {
    const result = execSync(command, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15 * 60 * 1000
    });
    if (result.trim()) console.log(result.trim());
    return { success: true, output: result };
  } catch (err) {
    console.error(`[ERROR] ${command}: ${err.message}`);
    if (err.stderr) console.error(err.stderr.toString());
    return { success: false, error: err.message, stderr: err.stderr?.toString() };
  }
}

async function deployProject(projectId) {
  console.log(`\n===== 开始部署项目: ${projectId} =====`);

  const tmpDir = `/tmp/deploy-${projectId}-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const prefix = `projects/${projectId}`;
    const [files] = await bucket.getFiles({ prefix });

    if (files.length === 0) {
      throw new Error(`项目 ${projectId} 没有找到文件`);
    }

    for (const file of files) {
      const dest = path.join(tmpDir, path.basename(file.name));
      console.log(`  下载: gs://${GCS_BUCKET}/${file.name} -> ${dest}`);
      await file.download({ destination: dest });
    }

    const tmpFiles = fs.readdirSync(tmpDir);
    const configFile = tmpFiles.find(f => f === 'user-config.yaml' || f.endsWith('.yaml'));
    const projectTar = tmpFiles.find(f => f.endsWith('.tar'));

    if (!configFile) throw new Error('未找到 user-config.yaml');
    if (!projectTar) throw new Error('未找到项目镜像 .tar 文件');

    const configPath = path.join(tmpDir, configFile);
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const userSubdomain = config.user?.subdomain;
    const imgName = config.image?.name || projectTar.replace('.tar', '');
    const tag = config.image?.tag || 'latest';
    const fullDomain = `${userSubdomain}.${ROOT_DOMAIN}`;
    const serviceName = projectId;

    console.log(`  项目ID: ${projectId}`);
    console.log(`  域名: ${fullDomain}`);
    console.log(`  服务名: ${serviceName}`);

    execLog(`gcloud auth configure-docker ${REGISTRY} --quiet`, tmpDir);

    console.log('\n--- 加载并推送镜像 ---');
    const tarPath = path.join(tmpDir, projectTar);
    execLog(`docker load -i ${tarPath}`, tmpDir);

    const fullImage = `${REGISTRY}/${GCP_PROJECT}/${AR_REPO}/${imgName}:${tag}`;
    execLog(`docker tag ${imgName}:amd64 ${fullImage}`, tmpDir);
    execLog(`docker push ${fullImage}`, tmpDir);

    const envLines = [];
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        const resolvedValue = String(value).replace(/\{\{subdomain\}\}/g, userSubdomain);
        envLines.push(`${key}=${resolvedValue}`);
      }
    }

    const cloudRun = config.cloud_run || {};
    const cpu = cloudRun.cpu || 2;
    const memory = cloudRun.memory || '4Gi';
    const port = cloudRun.port || 3000;
    const minInstances = cloudRun.min_instances || 1;
    const maxInstances = cloudRun.max_instances || 10;

    console.log('\n--- 部署 Cloud Run 服务 ---');
    let deployCmd = `gcloud run deploy ${serviceName} \
      --image=${fullImage} \
      --platform=managed --region=${REGION} \
      --allow-unauthenticated --port=${port} \
      --cpu=${cpu} --memory=${memory} \
      --min-instances=${minInstances} --max-instances=${maxInstances} \
      --vpc-connector=${VPC_CONNECTOR} --vpc-egress=private-ranges-only`;

    if (envLines.length > 0) {
      const envFlags = envLines.map(e => `--set-env-vars="${e}"`).join(' ');
      deployCmd += ` ${envFlags}`;
    }

    deployCmd += ' --quiet';
    execLog(deployCmd, tmpDir);

    console.log('\n--- 配置二级域名 ---');
    execLog(`gcloud run domain-mappings create \
      --service=${serviceName} \
      --region=${REGION} \
      --domain=${fullDomain} \
      --quiet`, tmpDir);

    const dnsResult = execLog(
      `gcloud run domain-mappings describe --domain=${fullDomain} --region=${REGION} --format='value(resourceRecords[0].rrdata)'`,
      tmpDir
    );

    if (dnsResult.success && dnsResult.output.trim()) {
      const runTarget = dnsResult.output.trim();
      execLog(`gcloud dns record-sets transaction start --zone=${DNS_ZONE}`, tmpDir);
      execLog(`gcloud dns record-sets transaction add ${runTarget} \
        --name=${fullDomain}. --ttl=300 --type=A --zone=${DNS_ZONE}`, tmpDir);
      execLog(`gcloud dns record-sets transaction execute --zone=${DNS_ZONE}`, tmpDir);
    }

    const deployResult = {
      projectId,
      domain: `https://${fullDomain}`,
      service: serviceName,
      status: 'deployed',
      timestamp: new Date().toISOString()
    };

    await bucket.file(`${prefix}/deploy-result.json`).save(JSON.stringify(deployResult, null, 2));
    const logContent = `[${new Date().toISOString()}] 部署成功: ${fullDomain}\n`;
    await bucket.file(`${prefix}/deploy.log`).save(logContent);

    console.log(`✅ 项目 ${projectId} 部署完成: https://${fullDomain}`);
    return deployResult;

  } catch (err) {
    console.error(`❌ 项目 ${projectId} 部署失败:`, err.message);

    try {
      const bucket = storage.bucket(GCS_BUCKET);
      await bucket.file(`projects/${projectId}/deploy-result.json`).save(JSON.stringify({
        projectId,
        status: 'failed',
        error: err.message,
        timestamp: new Date().toISOString()
      }, null, 2));
    } catch {}

    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

exports.handleUpload = async (event, context) => {
  try {
    const file = event;
    if (!file || !file.name) {
      console.log('收到非文件事件，忽略');
      return;
    }

    const fileName = file.name;
    console.log(`触发文件: ${fileName}`);

    if (!fileName.startsWith('projects/') || !fileName.endsWith('.yaml')) {
      console.log(`跳过非 YAML 文件: ${fileName}`);
      return;
    }

    const parts = fileName.split('/');
    if (parts.length < 3) {
      console.log('路径格式异常，忽略');
      return;
    }

    const projectId = parts[1];
    console.log(`检测到项目配置上传: ${projectId}`);

    const bucket = storage.bucket(GCS_BUCKET);
    const prefix = `projects/${projectId}`;
    const [files] = await bucket.getFiles({ prefix });

    const hasImage = files.some(f => f.name.endsWith('.tar'));

    if (!hasImage) {
      console.log(`项目 ${projectId} 文件不完整，等待镜像上传`);
      return;
    }

    console.log(`项目 ${projectId} 文件完整，开始部署`);
    await deployProject(projectId);

  } catch (err) {
    console.error('处理上传事件失败:', err);
  }
};

exports.deployAll = async (req, res) => {
  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const [files] = await bucket.getFiles({ prefix: 'projects/' });

    const projectIds = new Set();
    for (const file of files) {
      const parts = file.name.split('/');
      if (parts.length >= 2) {
        projectIds.add(parts[1]);
      }
    }

    const results = [];
    for (const projectId of projectIds) {
      try {
        const result = await deployProject(projectId);
        results.push(result);
      } catch (err) {
        results.push({ projectId, status: 'failed', error: err.message });
      }
    }

    res.json({ deployed: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};