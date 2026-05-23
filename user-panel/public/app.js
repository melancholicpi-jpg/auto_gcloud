var currentStep = 1;
var projectFile = null;
var AUTH_TOKEN = localStorage.getItem('auto_gcloud_token') || '';
var AUTH_USER = null;

try {
  AUTH_USER = JSON.parse(localStorage.getItem('auto_gcloud_user') || 'null');
} catch (_) {}

var envVars = [
  { key: 'NODE_ENV', value: 'production' },
  { key: 'API_URL', value: '' },
  { key: 'CORS_ORIGIN', value: '' }
];

var ROOT_DOMAIN = 'aihubflux.com';
var CHUNK_SIZE = 5 * 1024 * 1024;

function getAuthHeaders() {
  return AUTH_TOKEN ? { 'Authorization': 'Bearer ' + AUTH_TOKEN } : {};
}

function requireLogin() {
  if (!AUTH_TOKEN) {
    showToast('请先登录', 'error');
    setTimeout(function() {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(window.location.pathname);
    }, 600);
    return false;
  }
  return true;
}

function updateHeaderActions() {
  var el = document.getElementById('headerActions');
  if (!el) return;
  if (AUTH_USER) {
    var adminLink = AUTH_USER.role === 'admin' ? ' <a href="/admin.html" class="header-link">管理</a>' : '';
    el.innerHTML = '<span class="header-user">' + esc(AUTH_USER.username) + '</span>' + adminLink +
      ' <a href="#" class="header-link" onclick="logout();return false">退出</a>';
  } else {
    el.innerHTML = '<a href="/login.html" class="header-link">登录</a>';
  }
}

function logout() {
  localStorage.removeItem('auto_gcloud_token');
  localStorage.removeItem('auto_gcloud_user');
  AUTH_TOKEN = '';
  AUTH_USER = null;
  updateHeaderActions();
  showToast('已退出登录', 'info');
}

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
    var pid = document.getElementById('projectId').value.trim();
    if (!pid || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pid) || pid.length < 3) {
      showToast('项目 ID 格式无效（3-63位小写字母、数字、短横线）', 'error');
      return false;
    }
    document.getElementById('subdomain').value = pid;
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
  var pid = document.getElementById('projectId').value.trim();
  var sub = document.getElementById('subdomain').value.trim();
  document.getElementById('summaryProjectId').textContent = pid || '-';
  document.getElementById('summaryDomain').textContent = '部署后自动分配';
  document.getElementById('summaryImage').textContent = projectFile ? projectFile.name : '-';
  document.getElementById('summaryEnvCount').textContent = envVars.filter(function(e) { return e.key; }).length + ' 个';
}

function generateTemplate() {
  var sub = document.getElementById('subdomain').value.trim() || 'your-subdomain';
  envVars = [
    { key: 'NODE_ENV', value: 'production' },
    { key: 'API_URL', value: 'https://' + sub + '.' + ROOT_DOMAIN },
    { key: 'CORS_ORIGIN', value: 'https://' + sub + '.' + ROOT_DOMAIN }
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

function updateEnvVar(index, field, val) {
  envVars[index][field] = val;
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
  var pid = document.getElementById('projectId').value.trim() || 'my-project-001';
  var sub = document.getElementById('subdomain').value.trim() || 'admin';
  var yaml = [];
  yaml.push('user:');
  yaml.push('  project_id: "' + pid + '"');
  yaml.push('  subdomain: "' + sub + '"');
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
  if (!requireLogin()) return;
  var submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = '\u23f3 初始化...';

  showUploadProgressBar(true);
  updateUploadProgress(0, '准备分片上传...');

  var totalChunks = Math.ceil(projectFile.size / CHUNK_SIZE);

  initUpload(projectFile.name, projectFile.size, function(err, sessionId) {
    if (err) {
      showToast('初始化上传失败: ' + err, 'error');
      resetSubmitBtn(submitBtn);
      return;
    }

    var uploadedChunks = 0;
    var currentChunk = 0;

    function uploadNextChunk() {
      if (currentChunk >= totalChunks) {
        submitBtn.textContent = '\u23f3 组装并部署...';
        updateUploadProgress(100, formatSize(projectFile.size) + ' / ' + formatSize(projectFile.size));

        var envObj = {};
        envVars.filter(function(e) { return e.key; }).forEach(function(e) {
          envObj[e.key] = e.value;
        });

        completeUpload(sessionId, function(completeErr, result) {
          if (completeErr) {
            showToast('部署失败: ' + completeErr, 'error');
            resetSubmitBtn(submitBtn);
            return;
          }
          setTimeout(function() { showResult(result); }, 400);
        });
        return;
      }

      var start = currentChunk * CHUNK_SIZE;
      var end = Math.min(start + CHUNK_SIZE, projectFile.size);
      var blob = projectFile.slice(start, end);

      submitBtn.textContent = '\u23f3 上传分片 ' + (currentChunk + 1) + '/' + totalChunks;

      uploadChunk(sessionId, currentChunk, totalChunks, blob, function(chunkErr) {
        if (chunkErr) {
          showToast('分片 ' + (currentChunk + 1) + ' 上传失败: ' + chunkErr, 'error');
          resetSubmitBtn(submitBtn);
          return;
        }
        uploadedChunks++;
        currentChunk++;
        var pct = Math.round((uploadedChunks / totalChunks) * 100);
        var uploadedBytes = uploadedChunks * CHUNK_SIZE;
        if (uploadedBytes > projectFile.size) uploadedBytes = projectFile.size;
        updateUploadProgress(pct, formatSize(uploadedBytes) + ' / ' + formatSize(projectFile.size));
        uploadNextChunk();
      });
    }

    uploadNextChunk();
  });
}

function initUpload(fileName, totalSize, callback) {
  postJSON('/api/init-upload', { fileName: fileName, totalSize: totalSize }, function(err, data) {
    if (err) return callback(err);
    callback(null, data.sessionId);
  });
}

function uploadChunk(sessionId, chunkIndex, totalChunks, blob, callback) {
  var xhr = new XMLHttpRequest();

  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      AUTH_TOKEN = ''; AUTH_USER = null;
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      updateHeaderActions();
      showToast('登录已过期，请重新登录', 'error');
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      callback(null);
    } else {
      var msg = '上传失败 (HTTP ' + xhr.status + ')';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
      callback(msg);
    }
  });

  xhr.addEventListener('error', function() {
    callback('网络错误');
  });

  xhr.open('PUT', '/api/upload-chunk/' + sessionId + '?chunkIndex=' + chunkIndex + '&totalChunks=' + totalChunks);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  if (AUTH_TOKEN) xhr.setRequestHeader('Authorization', 'Bearer ' + AUTH_TOKEN);
  xhr.send(blob);
}

function completeUpload(sessionId, callback) {
  var pid = document.getElementById('projectId').value.trim();
  var sub = document.getElementById('subdomain').value.trim();

  var envObj = {};
  envVars.filter(function(e) { return e.key; }).forEach(function(e) {
    envObj[e.key] = e.value;
  });

  postJSON('/api/complete-upload/' + sessionId, {
    projectId: pid,
    subdomain: sub,
    envVars: envObj
  }, function(err, result) {
    if (err) return callback(err);
    if (result.processing) {
      pollDeployStatus(sessionId, function(pollErr, finalResult) {
        callback(pollErr, finalResult || result);
      });
    } else {
      callback(null, result);
    }
  });
}

function pollDeployStatus(sessionId, callback) {
    showUploadProgress(true, '正在后台组装文件...');
    var attempts = 0;
    var maxAttempts = 120;

    function poll() {
      getJSON('/api/deploy-status/' + sessionId, function(err, status) {
        if (err) {
          attempts++;
          if (attempts >= maxAttempts) {
            enableSubmitBtn();
            return callback('查询状态超时，请刷新页面后重试');
          }
          setTimeout(poll, 2000);
          return;
        }

        if (status.status === 'done' || status.serviceUrl) {
          showUploadProgressBar(false);
          enableSubmitBtn();
          callback(null, {
            success: true,
            projectId: status.projectId,
            subdomain: status.subdomain,
            serviceUrl: status.serviceUrl,
            message: 'Cloud Run 已部署完成'
          });
          return;
        }

        if (status.status === 'error') {
          showUploadProgressBar(false);
          enableSubmitBtn();
          var errMsg = status.error || '后台处理出错';
          if (status.buildLogUrl) {
            errMsg += '\n📊 查看构建日志了解详情: ' + status.buildLogUrl;
          }
          callback(errMsg);
          return;
        }

        var statusText = {
          'assembling': '正在后台组装文件...',
          'uploading': '正在上传至 GCS...',
          'uploaded': '正在提交 Cloud Build...',
          'deploying': 'Cloud Build 执行中（下载镜像 → 推送 → 部署）',
          'processing': '正在处理...'
        };
        showUploadProgress(true, statusText[status.status] || '处理中...');

        if (status.buildLogUrl) {
          showBuildLogLink(status.buildLogUrl);
        }

        attempts++;
        if (attempts >= maxAttempts) {
          enableSubmitBtn();
          return callback('处理超时，请刷新页面查看部署状态');
        }
        setTimeout(poll, 2000);
      });
    }

    poll();
  }

  function enableSubmitBtn() {
    var btn = document.getElementById('submitBtn');
    btn.disabled = false;
    btn.textContent = '🚀 提交部署';
  }

function showUploadProgress(show, text) {
  var wrap = document.getElementById('uploadProgressWrap');
  var label = document.getElementById('uploadProgressLabel');
  if (wrap) wrap.classList.toggle('hidden', !show);
  if (label && text) label.textContent = text;
}

function getJSON(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      AUTH_TOKEN = ''; AUTH_USER = null;
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      updateHeaderActions();
      showToast('登录已过期，请重新登录', 'error');
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      callback(null, JSON.parse(xhr.responseText));
    } else {
      var msg = '服务器错误 (' + xhr.status + ')';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
      callback(msg);
    }
  });
  xhr.addEventListener('error', function() {
    callback('网络错误');
  });
  xhr.open('GET', url);
  if (AUTH_TOKEN) xhr.setRequestHeader('Authorization', 'Bearer ' + AUTH_TOKEN);
  xhr.send();
}

function postJSON(url, data, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      AUTH_TOKEN = ''; AUTH_USER = null;
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      updateHeaderActions();
      showToast('登录已过期，请重新登录', 'error');
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      callback(null, JSON.parse(xhr.responseText));
    } else {
      var msg = '服务器错误 (' + xhr.status + ')';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
      callback(msg);
    }
  });
  xhr.addEventListener('error', function() {
    callback('网络错误');
  });
  xhr.open('POST', url);
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (AUTH_TOKEN) xhr.setRequestHeader('Authorization', 'Bearer ' + AUTH_TOKEN);
  xhr.send(JSON.stringify(data));
}

function resetSubmitBtn(btn) {
  btn.disabled = false;
  btn.textContent = '🚀 提交部署';
  showUploadProgressBar(false);
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
  if (!show) {
    var logLink = document.getElementById('buildLogLink');
    if (logLink) logLink.classList.add('hidden');
  }
}

function showBuildLogLink(url) {
  var el = document.getElementById('buildLogLink');
  if (!el) {
    el = document.createElement('div');
    el.id = 'buildLogLink';
    el.className = 'build-log-link';
    var wrap = document.getElementById('uploadProgressWrap');
    if (wrap) wrap.appendChild(el);
  }
  el.innerHTML = '📊 <a href="' + url + '" target="_blank">查看 Cloud Build 构建日志</a>';
  el.classList.remove('hidden');
}

function showResult(result) {
  showUploadProgressBar(false);

  document.getElementById('deployForm').classList.add('hidden');
  document.querySelector('.steps').classList.add('hidden');

  var panel = document.getElementById('resultPanel');
  panel.classList.remove('hidden');

  document.getElementById('resultIcon').textContent = '✅';
  document.getElementById('resultTitle').textContent = '部署成功！';
  document.getElementById('resultMessage').textContent = '你的服务已部署到 Google Cloud Run，可通过下方地址访问：';
  var url = result.serviceUrl;
  if (url) {
    document.getElementById('resultDomain').innerHTML =
      '<a href="' + url + '" target="_blank" style="font-size:18px;font-weight:700;">' + url + '</a>' +
      '<br><small style="color:var(--text-secondary);margin-top:8px;display:block;">点击链接可在新标签页中打开</small>';
  } else {
    document.getElementById('resultDomain').innerHTML =
      '<span style="color:var(--warning);">等待 Cloud Run 分配地址中...</span>' +
      '<br><small style="color:var(--text-secondary);margin-top:8px;display:block;">通常需要 1-3 分钟</small>';
  }

  showToast('部署成功！', 'success');
}

function resetToNewDeploy() {
  document.getElementById('resultPanel').classList.add('hidden');
  document.getElementById('deployForm').classList.remove('hidden');
  document.querySelector('.steps').classList.remove('hidden');
  document.getElementById('deployForm').reset();
  projectFile = null;
  document.getElementById('imageStatus').textContent = '';
  document.getElementById('imageUpload').classList.remove('has-file');
  currentStep = 1;
  updateSteps();
  prevStepButtons = [false, true, true, true];
  var panels = document.querySelectorAll('.step-panel');
  for (var i = 0; i < panels.length; i++) {
    panels[i].classList.toggle('hidden', i !== 0);
  }
  var guideBox = document.getElementById('guideBox');
  if (guideBox) guideBox.open = false;
  showUploadProgressBar(false);
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

function copyCode(btn) {
  var codeId = btn.getAttribute('data-code');
  var el = document.getElementById(codeId);
  if (!el) return;
  var text = el.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = '✅ 已复制';
      btn.classList.add('copied');
      setTimeout(function() { btn.textContent = '📋 复制'; btn.classList.remove('copied'); }, 2000);
    });
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✅ 已复制';
    btn.classList.add('copied');
    setTimeout(function() { btn.textContent = '📋 复制'; btn.classList.remove('copied'); }, 2000);
  }
}

(function detectPlatform() {
  var hint = document.getElementById('platformHint');
  if (!hint) return;
  var ua = navigator.userAgent || '';
  var isMac = /Mac/i.test(ua);
  var isWin = /Win/i.test(ua);
  if (isMac) {
    hint.textContent = '🔔 检测到您使用 macOS，构建时务必加 --platform linux/amd64 参数';
    hint.style.color = '#b45309';
  } else if (isWin) {
    hint.textContent = '🔔 检测到您使用 Windows，构建时务必加 --platform linux/amd64 参数';
    hint.style.color = '#b45309';
  } else {
    hint.textContent = '✅ 您可能使用 Linux，可省略 --platform 参数';
    hint.style.color = '#059669';
  }
})();

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

function handleSubmit(e) {
    e.preventDefault();
    var btn = document.getElementById('submitBtn');
    if (btn.disabled) return;
    submitDeploy();
  }

document.getElementById('deployForm').addEventListener('submit', handleSubmit);

function formatSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

fetch('/api/health')
  .then(function(r) { return r.json(); })
  .then(function(data) {
    ROOT_DOMAIN = data.rootDomain || ROOT_DOMAIN;
  })
  .catch(function() {});

updateHeaderActions();
setStep(1);
renderEnvRows();