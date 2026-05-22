let currentStep = 1;
let projectFile = null;
let envVars = [
  { key: 'NODE_ENV', value: 'production' },
  { key: 'API_URL', value: '' },
  { key: 'CORS_ORIGIN', value: '' }
];

var ROOT_DOMAIN = 'aihubflux.com';

function setStep(step) {
  document.querySelectorAll('.step').forEach(function(el, i) {
    el.classList.remove('active', 'completed');
    if (i + 1 < step) el.classList.add('completed');
    if (i + 1 === step) el.classList.add('active');
  });
  document.querySelectorAll('.step-panel').forEach(function(el, i) {
    el.classList.toggle('hidden', i + 1 !== step);
  });
  currentStep = step;
  if (step === 4) updateSummary();
}

function nextStep(step) {
  if (!validateStep(currentStep)) return;
  setStep(step);
}

function prevStep(step) {
  setStep(step);
}

function validateStep(step) {
  if (step === 1) {
    var projectId = document.getElementById('projectId').value.trim();
    var subdomain = document.getElementById('subdomain').value.trim();
    if (!projectId || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(projectId) || projectId.length < 3) {
      showToast('项目 ID 格式无效 (3-63位小写字母/数字/短横线)', 'error');
      return false;
    }
    if (!subdomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(subdomain) || subdomain.length < 3 || subdomain.length > 20) {
      showToast('二级域名格式无效 (3-20位小写字母/数字/短横线)', 'error');
      return false;
    }
    document.getElementById('domainSuffix').textContent = '.' + ROOT_DOMAIN;
    return true;
  }
  if (step === 2) {
    if (!projectFile) {
      showToast('请选择项目镜像文件', 'error');
      return false;
    }
    return true;
  }
  return true;
}

function updateSummary() {
  var projectId = document.getElementById('projectId').value.trim();
  var subdomain = document.getElementById('subdomain').value.trim();
  document.getElementById('summaryProjectId').textContent = projectId || '-';
  document.getElementById('summaryDomain').textContent = 'https://' + (subdomain || '???') + '.' + ROOT_DOMAIN;
  document.getElementById('summaryImage').textContent = projectFile ? projectFile.name : '-';
  document.getElementById('summaryEnvCount').textContent = envVars.filter(function(e) { return e.key; }).length + ' 个';
}

function generateTemplate() {
  var subdomain = document.getElementById('subdomain').value.trim() || 'your-subdomain';
  envVars = [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'API_URL', value: 'https://' + subdomain + '.' + ROOT_DOMAIN },
    { key: 'CORS_ORIGIN', value: 'https://' + subdomain + '.' + ROOT_DOMAIN }
  ];
  renderEnvRows();
  showToast('已加载默认环境变量模板', 'info');
}

function addEnvRow(key, value) {
  envVars.push({ key: key || '', value: value || '' });
  renderEnvRows();
}

function removeEnvRow(index) {
  envVars.splice(index, 1);
  renderEnvRows();
}

function updateEnvVar(index, field, newValue) {
  envVars[index][field] = newValue;
  updateYamlPreview();
}

function renderEnvRows() {
  var html = '';
  envVars.forEach(function(v, i) {
    html += '<div class="env-row">';
    html += '<input type="text" placeholder="变量名" value="' + esc(v.key) + '" onchange="updateEnvVar(' + i + ', \'key\', this.value); updateYamlPreview()">';
    html += '<input type="text" placeholder="变量值" value="' + esc(v.value) + '" onchange="updateEnvVar(' + i + ', \'value\', this.value); updateYamlPreview()">';
    html += '<button type="button" class="btn-remove" onclick="removeEnvRow(' + i + ')">\u2715</button>';
    html += '</div>';
  });
  document.getElementById('envRows').innerHTML = html;
}

function esc(s) {
  var div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function toggleYamlPreview() {
  var preview = document.getElementById('yamlPreview');
  preview.classList.toggle('hidden');
  if (!preview.classList.contains('hidden')) updateYamlPreview();
}

function updateYamlPreview() {
  var projectId = document.getElementById('projectId').value.trim() || 'my-project-001';
  var subdomain = document.getElementById('subdomain').value.trim() || 'admin';
  var yaml = [];
  yaml.push('user:');
  yaml.push('  project_id: "' + projectId + '"');
  yaml.push('  subdomain: "' + subdomain + '"');
  yaml.push('');
  yaml.push('image:');
  yaml.push('  name: "' + (projectFile ? projectFile.name.replace('.tar', '') : 'project-app') + '"');
  yaml.push('  tag: "latest"');
  yaml.push('');
  yaml.push('cloud_run:');
  yaml.push('  cpu: 2');
  yaml.push('  memory: "4Gi"');
  yaml.push('  port: 3000');
  yaml.push('  min_instances: 1');
  yaml.push('  max_instances: 10');
  yaml.push('');
  yaml.push('env:');
  envVars.forEach(function(v) {
    if (v.key) yaml.push('  ' + v.key + ': "' + v.value + '"');
  });
  document.getElementById('yamlContent').textContent = yaml.join('\n');
}

function submitDeploy() {
  var submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '\u23f3 上传中...';

  var projectId = document.getElementById('projectId').value.trim();
  var subdomain = document.getElementById('subdomain').value.trim();

  var formData = new FormData();
  formData.append('projectId', projectId);
  formData.append('subdomain', subdomain);
  formData.append('projectImage', projectFile);

  var yamlLines = [];
  yamlLines.push('user:');
  yamlLines.push('  project_id: "' + projectId + '"');
  yamlLines.push('  subdomain: "' + subdomain + '"');
  yamlLines.push('');
  yamlLines.push('image:');
  yamlLines.push('  name: "' + projectFile.name.replace('.tar', '') + '"');
  yamlLines.push('  tag: "latest"');
  yamlLines.push('');
  yamlLines.push('cloud_run:');
  yamlLines.push('  cpu: 2');
  yamlLines.push('  memory: "4Gi"');
  yamlLines.push('  port: 3000');
  yamlLines.push('  min_instances: 1');
  yamlLines.push('  max_instances: 10');
  yamlLines.push('');
  yamlLines.push('env:');
  envVars.filter(function(e) { return e.key; }).forEach(function(e) {
    yamlLines.push('  ' + e.key + ': "' + e.value + '"');
  });
  var yamlBlob = new Blob([yamlLines.join('\n')], { type: 'application/x-yaml' });
  formData.append('configYaml', yamlBlob, 'user-config.yaml');

  var xhr = new XMLHttpRequest();

  xhr.upload.addEventListener('progress', function(e) {
    if (e.lengthComputable) {
      var pct = Math.round((e.loaded / e.total) * 100);
      updateUploadProgress(pct, formatSize(e.loaded) + ' / ' + formatSize(e.total));
    }
  });

  xhr.addEventListener('load', function() {
    if (xhr.status >= 200 && xhr.status < 300) {
      var result = JSON.parse(xhr.responseText);
      if (result.success) {
        updateUploadProgress(100, formatSize(projectFile.size) + ' / ' + formatSize(projectFile.size));
        setTimeout(function() { showResult(result); }, 400);
      } else {
        showToast(result.error || '提交失败', 'error');
        resetSubmitBtn(submitBtn);
      }
    } else {
      var errMsg = '服务器错误 (' + xhr.status + ')';
      try {
        var r = JSON.parse(xhr.responseText);
        errMsg = r.error || errMsg;
      } catch (_) {}
      showToast(errMsg, 'error');
      resetSubmitBtn(submitBtn);
    }
  });

  xhr.addEventListener('error', function() {
    showToast('网络错误，请检查服务器是否运行', 'error');
    resetSubmitBtn(submitBtn);
  });

  xhr.addEventListener('abort', function() {
    resetSubmitBtn(submitBtn);
  });

  showUploadProgressBar(true);
  xhr.open('POST', '/api/submit');
  xhr.send(formData);
}

function resetSubmitBtn(btn) {
  btn.disabled = false;
  btn.textContent = '\uD83D\uDE80 提交部署';
}

function updateUploadProgress(pct, text) {
  var bar = document.getElementById('uploadProgressBar');
  var label = document.getElementById('uploadProgressLabel');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = text;
}

function showUploadProgressBar(show) {
  var wrap = document.getElementById('uploadProgressWrap');
  if (wrap) wrap.classList.toggle('hidden', !show);
}

function showResult(result) {
  showUploadProgressBar(false);

  document.getElementById('deployForm').classList.add('hidden');
  document.querySelector('.steps').classList.add('hidden');

  var panel = document.getElementById('resultPanel');
  panel.classList.remove('hidden');

  document.getElementById('resultIcon').textContent = '\u2705';
  document.getElementById('resultTitle').textContent = '上传完成';
  document.getElementById('resultMessage').textContent = result.message;
  document.getElementById('resultDomain').innerHTML =
    '<a href="' + result.expectedDomain + '" target="_blank">' + result.expectedDomain + '</a>';

  showToast('文件已上传到服务器，后台同步至 GCS', 'success');
}

function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.3s';
    setTimeout(function() { toast.remove(); }, 300);
  }, 4000);
}

document.getElementById('projectImage').addEventListener('change', function() {
  var status = document.getElementById('imageStatus');
  var area = document.getElementById('imageUpload');
  if (this.files.length) {
    projectFile = this.files[0];
    status.textContent = '已选择: ' + projectFile.name + ' (' + formatSize(projectFile.size) + ')';
    area.classList.add('has-file');
  } else {
    projectFile = null;
    status.textContent = '';
    area.classList.remove('has-file');
  }
});

document.getElementById('deployForm').addEventListener('submit', function(e) {
  e.preventDefault();
  submitDeploy();
});

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

setStep(1);
renderEnvRows();