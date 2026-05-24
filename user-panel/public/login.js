var isLogin = true;
var captchaId = null;

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

function showError(msg) {
  var el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('show');
}

function hideError() {
  document.getElementById('errorMsg').classList.remove('show');
}

function refreshCaptcha() {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    var data = JSON.parse(xhr.responseText);
    captchaId = data.captchaId;
    document.getElementById('captchaQuestion').textContent = data.question;
  });
  xhr.open('GET', '/api/captcha/generate');
  xhr.send();
}

function toggleMode() {
  isLogin = !isLogin;
  document.getElementById('authTitle').textContent = isLogin ? '登录' : '注册';
  document.getElementById('authSub').textContent = isLogin ? '登录以使用 Auto GCloud 部署服务' : '注册账号开始部署你的项目';
  document.getElementById('submitBtn').textContent = isLogin ? '登 录' : '注 册';
  document.getElementById('switchArea').innerHTML = isLogin
    ? '还没有账号？<a id="switchLink" onclick="toggleMode()">立即注册</a>'
    : '已有账号？<a id="switchLink" onclick="toggleMode()">去登录</a>';
  document.getElementById('password').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');

  var captchaGroup = document.getElementById('captchaGroup');
  if (isLogin) {
    captchaGroup.classList.add('hidden');
    captchaId = null;
  } else {
    captchaGroup.classList.remove('hidden');
    refreshCaptcha();
  }
  hideError();
}

function setToken(token, user) {
  localStorage.setItem('auto_gcloud_token', token);
  localStorage.setItem('auto_gcloud_user', JSON.stringify(user));
}

function handleAuth() {
  hideError();
  var username = document.getElementById('username').value.trim();
  var password = document.getElementById('password').value;

  if (!username) { showError('请输入用户名'); return; }
  if (!password) { showError('请输入密码'); return; }

  if (!isLogin) {
    var captchaAnswer = document.getElementById('captchaInput').value.trim();
    if (!captchaAnswer) { showError('请输入验证码'); return; }
  }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = isLogin ? '登录中...' : '注册中...';

  var url = isLogin ? '/api/auth/login' : '/api/auth/register';
  var body = { username: username, password: password };
  if (!isLogin) {
    body.captchaId = captchaId;
    body.captchaAnswer = captchaAnswer;
  }

  postJSON(url, body, function(err, data) {
    btn.disabled = false;
    btn.textContent = isLogin ? '登 录' : '注 册';

    if (err) {
      showError(typeof err === 'string' ? err : '请求失败');
      if (!isLogin) refreshCaptcha();
      return;
    }

    setToken(data.token, data.user);
    showToast(isLogin ? '登录成功' : '注册成功', 'success');

    var redirect = getParameterByName('redirect');
    setTimeout(function() {
      window.location.href = redirect || '/';
    }, 500);
  });
}

function getParameterByName(name) {
  var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function postJSON(url, data, callback) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
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
  xhr.send(JSON.stringify(data));
}

document.getElementById('password').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') handleAuth();
});

var token = localStorage.getItem('auto_gcloud_token');
if (token) {
  var xhr = new XMLHttpRequest();
  xhr.addEventListener('load', function() {
    if (xhr.status === 200) {
      var data = JSON.parse(xhr.responseText);
      setToken(token, data.user);
      var redirect = getParameterByName('redirect');
      window.location.href = redirect || '/';
    } else {
      localStorage.removeItem('auto_gcloud_token');
      localStorage.removeItem('auto_gcloud_user');
    }
  });
  xhr.addEventListener('error', function() {});
  xhr.open('GET', '/api/auth/me');
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);
  xhr.send();
}