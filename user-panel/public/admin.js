var token = localStorage.getItem('auto_gcloud_token');
var user = null;
try {
  user = JSON.parse(localStorage.getItem('auto_gcloud_user') || 'null');
} catch (_) {}

if (!token || !user || user.role !== 'admin') {
  window.location.href = '/login.html';
}

var currentAssignCodeId = null;

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

function apiGet(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      window.location.href = '/login.html?redirect=/admin.html';
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
  xhr.addEventListener('error', function() { callback('网络错误'); });
  xhr.open('GET', url);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
}

function apiPost(url, data, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      window.location.href = '/login.html?redirect=/admin.html';
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
  xhr.addEventListener('error', function() { callback('网络错误'); });
  xhr.open('POST', url);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send(JSON.stringify(data || {}));
}

function apiDelete(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 401) {
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
      window.location.href = '/login.html?redirect=/admin.html';
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
  xhr.addEventListener('error', function() { callback('网络错误'); });
  xhr.open('DELETE', url);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
}

function formatDate(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ========== Tabs ==========

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
  document.querySelector('.tab-btn[onclick*="' + name + '"]').classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'codes') loadCodes();
  if (name === 'stats') loadStats();
}

// ========== Users ==========

function renderUsers(users) {
  var tbody = document.getElementById('userTbody');
  tbody.innerHTML = '';

  if (!users || users.length === 0) {
    document.getElementById('usersLoading').classList.add('hidden');
    document.getElementById('userTable').classList.add('hidden');
    document.getElementById('usersEmpty').classList.remove('hidden');
    return;
  }

  users.forEach(function(u) {
    var deployCount = u.deployCount !== undefined ? u.deployCount : '-';
    var row = document.createElement('tr');

    row.innerHTML =
      '<td>' + esc(u.username) + '</td>' +
      '<td><span class="badge ' + (u.role === 'admin' ? 'badge-admin' : 'badge-user') + '">' + (u.role === 'admin' ? '管理员' : '用户') + '</span></td>' +
      '<td><span class="badge ' + (u.enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (u.enabled ? '正常' : '已禁用') + '</span></td>' +
      '<td>' + deployCount + '</td>' +
      '<td>' + formatDate(u.createdAt) + '</td>' +
      '<td></td>';

    var tdActions = row.lastChild;
    var isProtected = u.username === 'admin';

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-sm ' + (isProtected ? 'btn-disabled' : 'btn-toggle');
    toggleBtn.textContent = u.enabled ? '禁用' : '启用';
    toggleBtn.disabled = isProtected;
    if (!isProtected) toggleBtn.onclick = function() { toggleUser(u.id); };
    tdActions.appendChild(toggleBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-sm ' + (isProtected ? 'btn-disabled' : 'btn-delete');
    deleteBtn.textContent = '删除';
    deleteBtn.style.marginLeft = '6px';
    deleteBtn.disabled = isProtected;
    if (!isProtected) deleteBtn.onclick = function() { deleteUser(u.id, u.username); };
    tdActions.appendChild(deleteBtn);

    tbody.appendChild(row);
  });

  document.getElementById('usersLoading').classList.add('hidden');
  document.getElementById('userTable').classList.remove('hidden');
  document.getElementById('usersEmpty').classList.add('hidden');
}

function toggleUser(userId) {
  apiPost('/api/admin/users/' + userId + '/toggle', {}, function(err) {
    if (err) { showToast('操作失败: ' + err, 'error'); }
    else { showToast('操作成功', 'success'); loadUsers(); }
  });
}

function deleteUser(userId, username) {
  if (!confirm('确定要删除用户 "' + username + '" 吗？此操作不可恢复。')) return;
  apiDelete('/api/admin/users/' + userId, function(err) {
    if (err) { showToast('删除失败: ' + err, 'error'); }
    else { showToast('已删除用户: ' + username, 'success'); loadUsers(); }
  });
}

function loadUsers() {
  apiGet('/api/admin/users', function(err, data) {
    if (err) { document.getElementById('usersLoading').textContent = '加载失败: ' + err; return; }
    renderUsers(data.users);
  });
}

// ========== Codes ==========

function renderCodes(codes, usersMap) {
  var tbody = document.getElementById('codeTbody');
  tbody.innerHTML = '';

  if (!codes || codes.length === 0) {
    document.getElementById('codesLoading').classList.add('hidden');
    document.getElementById('codeTable').classList.add('hidden');
    document.getElementById('codesEmpty').classList.remove('hidden');
    return;
  }

  codes.forEach(function(c) {
    var remaining = c.limitCount - (c.usedCount || 0);
    var assignedUser = c.assignedTo && usersMap[c.assignedTo] ? usersMap[c.assignedTo] : null;
    var row = document.createElement('tr');
    row.innerHTML =
      '<td><code style="font-size:13px;background:#f3f4f6;padding:2px 6px;border-radius:4px;">' + esc(c.code) + '</code></td>' +
      '<td>' + c.limitCount + '</td>' +
      '<td>' + (c.usedCount || 0) + ' / <strong>' + remaining + '</strong></td>' +
      '<td>' + (assignedUser ? '<span class="badge badge-assigned">' + esc(assignedUser) + '</span>' : '<span class="badge badge-unassigned">未分配</span>') + '</td>' +
      '<td><span class="badge ' + (c.enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (c.enabled ? '正常' : '已禁用') + '</span></td>' +
      '<td>' + formatDate(c.createdAt) + '</td>' +
      '<td></td>';

    var tdActions = row.lastChild;

    if (!assignedUser) {
      var abtn = document.createElement('button');
      abtn.className = 'btn-sm btn-assign';
      abtn.textContent = '分配';
      abtn.onclick = function() { openAssignModal(c.id); };
      tdActions.appendChild(abtn);
    }

    var tbtn = document.createElement('button');
    tbtn.className = 'btn-sm btn-toggle';
    tbtn.textContent = c.enabled ? '禁用' : '启用';
    tbtn.style.marginLeft = '6px';
    tbtn.onclick = function() { toggleCode(c.id); };
    tdActions.appendChild(tbtn);

    var dbtn = document.createElement('button');
    dbtn.className = 'btn-sm btn-delete';
    dbtn.textContent = '删除';
    dbtn.style.marginLeft = '6px';
    dbtn.onclick = function() { deleteCode(c.id, c.code); };
    tdActions.appendChild(dbtn);

    tbody.appendChild(row);
  });

  document.getElementById('codesLoading').classList.add('hidden');
  document.getElementById('codeTable').classList.remove('hidden');
  document.getElementById('codesEmpty').classList.add('hidden');
}

function generateCodes() {
  var prefix = document.getElementById('genPrefix').value.trim();
  var count = parseInt(document.getElementById('genCount').value, 10) || 5;
  var limitCount = parseInt(document.getElementById('genLimit').value, 10) || 10;

  apiPost('/api/admin/codes/generate', { prefix: prefix, count: count, limitCount: limitCount }, function(err, data) {
    if (err) { showToast('生成失败: ' + err, 'error'); return; }
    showToast('成功生成 ' + data.codes.length + ' 个兑换码', 'success');
    loadCodes();
  });
}

function toggleCode(codeId) {
  apiPost('/api/admin/codes/' + codeId + '/toggle', {}, function(err) {
    if (err) { showToast('操作失败: ' + err, 'error'); }
    else { showToast('操作成功', 'success'); loadCodes(); }
  });
}

function deleteCode(codeId, codeStr) {
  if (!confirm('确定要删除兑换码 "' + codeStr + '" 吗？')) return;
  apiDelete('/api/admin/codes/' + codeId, function(err) {
    if (err) { showToast('删除失败: ' + err, 'error'); }
    else { showToast('已删除', 'success'); loadCodes(); }
  });
}

function openAssignModal(codeId) {
  currentAssignCodeId = codeId;
  var sel = document.getElementById('assignUserSelect');
  sel.innerHTML = '<option value="">请选择用户</option>';
  apiGet('/api/admin/users', function(err, data) {
    if (err) return;
    (data.users || []).forEach(function(u) {
      if (u.role !== 'admin') {
        var opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.username;
        sel.appendChild(opt);
      }
    });
  });
  document.getElementById('assignModal').classList.add('show');
}

function closeAssignModal() {
  document.getElementById('assignModal').classList.remove('show');
  currentAssignCodeId = null;
}

function doAssign() {
  var userId = document.getElementById('assignUserSelect').value;
  if (!userId) { showToast('请选择用户', 'error'); return; }
  apiPost('/api/admin/codes/' + currentAssignCodeId + '/assign', { userId: userId }, function(err) {
    if (err) { showToast('分配失败: ' + err, 'error'); return; }
    showToast('分配成功', 'success');
    closeAssignModal();
    loadCodes();
  });
}

function loadCodes() {
  apiGet('/api/admin/codes', function(err, data) {
    if (err) { document.getElementById('codesLoading').textContent = '加载失败: ' + err; return; }
    apiGet('/api/admin/users', function(errU, dataU) {
      var usersMap = {};
      if (!errU && dataU.users) {
        dataU.users.forEach(function(u) { usersMap[u.id] = u.username; });
      }
      renderCodes(data.codes, usersMap);
    });
  });
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i >= units.length) i = units.length - 1;
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  var d = new Date(isoStr);
  var pad = function(n) { return n < 10 ? '0' + n : n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function getStatusBadge(status) {
  if (status === 'success') return '<span class="badge badge-enabled">成功</span>';
  if (status === 'error') return '<span class="badge badge-disabled">失败</span>';
  if (status === 'deploying') return '<span class="badge" style="background:#dbeafe;color:#1d4ed8;">部署中</span>';
  return '<span class="badge badge-unassigned">' + status + '</span>';
}

var statsHistoryPage = 1;
var statsHistoryTotal = 0;

function loadStats() {
  apiGet('/api/admin/stats', function(err, data) {
    var loading = document.getElementById('statsLoading');
    var content = document.getElementById('statsContent');

    if (err) { loading.textContent = '加载失败: ' + err; return; }
    loading.classList.add('hidden');
    content.classList.remove('hidden');

    var o = data.overview;
    document.getElementById('statsGrid').innerHTML =
      '<div class="stat-card"><div class="stat-num">' + o.totalDeploys + '</div><div class="stat-label">总部署数</div></div>' +
      '<div class="stat-card"><div class="stat-num" style="color:var(--success)">' + o.successDeploys + '</div><div class="stat-label">成功</div></div>' +
      '<div class="stat-card"><div class="stat-num" style="color:var(--error)">' + o.failedDeploys + '</div><div class="stat-label">失败</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + o.deployingDeploys + '</div><div class="stat-label">进行中</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + o.todayDeploys + '</div><div class="stat-label">今日部署</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + o.totalFileSizeMB + '</div><div class="stat-label">总流量 (MB)</div></div>';

    var userList = document.getElementById('userStatsList');
    if (data.userStats && data.userStats.length > 0) {
      userList.innerHTML = '';
      data.userStats.forEach(function(us) {
        var div = document.createElement('div');
        div.className = 'user-stat-row';
        div.innerHTML = '<span class="us-name">' + esc(us.username) + '</span>' +
          '<span class="us-counts">共 ' + us.total + ' 次 | 成功 ' + us.success + ' | 失败 ' + us.failed + '</span>';
        userList.appendChild(div);
      });
    } else {
      userList.innerHTML = '<div class="empty-text">暂无用户统计数据</div>';
    }

    var recentDiv = document.getElementById('recentDeploys');
    if (data.recentDeploys && data.recentDeploys.length > 0) {
      recentDiv.innerHTML = '';
      data.recentDeploys.forEach(function(r) {
        var div = document.createElement('div');
        div.className = 'recent-item';
        div.innerHTML = '<div class="ri-left">' +
          '<span class="ri-user">' + esc(r.username) + '</span>' +
          '<span class="ri-project">' + esc(r.projectId) + '</span>' +
          getStatusBadge(r.status) +
          '</div>' +
          '<span class="ri-time">' + formatDateTime(r.createdAt) + '</span>';
        recentDiv.appendChild(div);
      });
    } else {
      recentDiv.innerHTML = '<div class="empty-text">暂无部署记录</div>';
    }

    loadHistoryPage(1);
  });
}

function loadHistoryPage(page) {
  statsHistoryPage = page;
  var loadingEl = document.getElementById('historyLoading');
  var listEl = document.getElementById('historyList');
  var pagEl = document.getElementById('historyPagination');

  loadingEl.classList.remove('hidden');
  listEl.innerHTML = '';

  apiGet('/api/admin/history?page=' + page + '&limit=20', function(err, data) {
    loadingEl.classList.add('hidden');

    if (err) { listEl.innerHTML = '<div class="empty-text">加载失败: ' + err + '</div>'; return; }

    statsHistoryTotal = data.total;
    listEl.innerHTML = '';

    if (!data.records || data.records.length === 0) {
      listEl.innerHTML = '<div class="empty-text">暂无部署记录</div>';
    } else {
      data.records.forEach(function(r) {
        var div = document.createElement('div');
        div.className = 'history-card';
        div.innerHTML =
          '<div class="hc-header">' +
            '<strong>' + esc(r.username) + ' → ' + esc(r.projectId) + '</strong>' +
            getStatusBadge(r.status) +
          '</div>' +
          '<div class="hc-body">' +
            '<div><span class="hc-label">镜像</span>' + esc(r.imageName) + '</div>' +
            '<div><span class="hc-label">域名</span>' + esc(r.subdomain) + '.aihubflux.com</div>' +
            '<div><span class="hc-label">大小</span>' + formatSize(r.fileSize) + '</div>' +
            (r.codeUsed ? '<div><span class="hc-label">兑换码</span><code style="font-size:11px;background:#f3f4f6;padding:1px 6px;border-radius:3px;">' + esc(r.codeUsed) + '</code></div>' : '') +
            '<div><span class="hc-label">时间</span>' + formatDateTime(r.createdAt) + '</div>' +
            (r.serviceUrl ? '<div><span class="hc-label">地址</span><a href="' + r.serviceUrl + '" target="_blank" style="color:var(--primary);font-size:12px;">' + r.serviceUrl + '</a></div>' : '') +
            (r.error ? '<div style="color:var(--error);font-size:12px;grid-column:1/-1;">错误: ' + esc(r.error) + '</div>' : '') +
          '</div>';
        listEl.appendChild(div);
      });
    }

    var totalPages = Math.ceil(statsHistoryTotal / 20) || 1;
    pagEl.innerHTML =
      '<button ' + (page <= 1 ? 'disabled' : '') + ' onclick="loadHistoryPage(' + (page - 1) + ')">上一页</button>' +
      '<span>' + page + ' / ' + totalPages + '</span>' +
      '<button ' + (page >= totalPages ? 'disabled' : '') + ' onclick="loadHistoryPage(' + (page + 1) + ')">下一页</button>';
  });
}

loadUsers();