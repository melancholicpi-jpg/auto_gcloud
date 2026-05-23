var token = localStorage.getItem('auto_gcloud_token');
var user = null;

try {
  user = JSON.parse(localStorage.getItem('auto_gcloud_user') || 'null');
} catch (_) {}

if (!token || !user || user.role !== 'admin') {
  window.location.href = '/login.html';
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
  xhr.addEventListener('error', function() {
    callback('网络错误');
  });
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
  xhr.addEventListener('error', function() {
    callback('网络错误');
  });
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
  xhr.addEventListener('error', function() {
    callback('网络错误');
  });
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

function renderUsers(users) {
  var tbody = document.getElementById('userTbody');
  tbody.innerHTML = '';

  if (!users || users.length === 0) {
    document.getElementById('loadingText').classList.add('hidden');
    document.getElementById('userTable').classList.add('hidden');
    document.getElementById('emptyText').classList.remove('hidden');
    return;
  }

  users.forEach(function(u) {
    var row = document.createElement('tr');

    var tdName = document.createElement('td');
    tdName.textContent = u.username;

    var tdRole = document.createElement('td');
    var roleBadge = document.createElement('span');
    roleBadge.className = 'badge ' + (u.role === 'admin' ? 'badge-admin' : 'badge-user');
    roleBadge.textContent = u.role === 'admin' ? '管理员' : '普通用户';
    tdRole.appendChild(roleBadge);

    var tdStatus = document.createElement('td');
    var statusBadge = document.createElement('span');
    statusBadge.className = 'badge ' + (u.enabled ? 'badge-enabled' : 'badge-disabled');
    statusBadge.textContent = u.enabled ? '正常' : '已禁用';
    tdStatus.appendChild(statusBadge);

    var tdDate = document.createElement('td');
    tdDate.textContent = formatDate(u.createdAt);

    var tdActions = document.createElement('td');

    var isProtectedAdmin = u.username === 'admin';

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-sm ' + (isProtectedAdmin ? 'btn-disabled' : 'btn-toggle');
    toggleBtn.textContent = u.enabled ? '禁用' : '启用';
    toggleBtn.disabled = isProtectedAdmin;
    if (!isProtectedAdmin) {
      toggleBtn.onclick = function() { toggleUser(u.id); };
    }
    tdActions.appendChild(toggleBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-sm ' + (isProtectedAdmin ? 'btn-disabled' : 'btn-delete');
    deleteBtn.textContent = '删除';
    deleteBtn.style.marginLeft = '6px';
    deleteBtn.disabled = isProtectedAdmin;
    if (!isProtectedAdmin) {
      deleteBtn.onclick = function() { deleteUser(u.id, u.username); };
    }
    tdActions.appendChild(deleteBtn);

    row.appendChild(tdName);
    row.appendChild(tdRole);
    row.appendChild(tdStatus);
    row.appendChild(tdDate);
    row.appendChild(tdActions);
    tbody.appendChild(row);
  });

  document.getElementById('loadingText').classList.add('hidden');
  document.getElementById('userTable').classList.remove('hidden');
  document.getElementById('emptyText').classList.add('hidden');
}

function toggleUser(userId) {
  apiPost('/api/admin/users/' + userId + '/toggle', {}, function(err) {
    if (err) {
      showToast('操作失败: ' + err, 'error');
    } else {
      showToast('操作成功', 'success');
      loadUsers();
    }
  });
}

function deleteUser(userId, username) {
  if (!confirm('确定要删除用户 "' + username + '" 吗？此操作不可恢复。')) return;
  apiDelete('/api/admin/users/' + userId, function(err) {
    if (err) {
      showToast('删除失败: ' + err, 'error');
    } else {
      showToast('已删除用户: ' + username, 'success');
      loadUsers();
    }
  });
}

function loadUsers() {
  apiGet('/api/admin/users', function(err, data) {
    if (err) {
      document.getElementById('loadingText').textContent = '加载失败: ' + err;
      return;
    }
    renderUsers(data.users);
  });
}

loadUsers();