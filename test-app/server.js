const http = require('http');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>Auto GCloud Test</title>
<style>
  body { font-family: -apple-system, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; color:#e2e8f0; }
  .card { text-align:center; padding:48px; border-radius:16px; background:#1e293b; box-shadow:0 25px 50px rgba(0,0,0,.3); }
  h1 { font-size:2rem; margin-bottom:8px; }
  .tag { display:inline-block; padding:4px 12px; border-radius:20px; background:#059669; font-size:.8rem; }
  p { color:#94a3b8; margin-top:16px; }
  .envs { margin-top:24px; text-align:left; font-size:.85rem; color:#64748b; }
  .envs span { color:#38bdf8; }
</style></head>
<body>
  <div class="card">
    <h1>Auto GCloud 部署成功</h1>
    <span class="tag">Cloud Run</span>
    <p>这个服务是通过 auto-gcloud 面板自动部署的</p>
    <div class="envs">
      <div>NODE_ENV: <span>${process.env.NODE_ENV || '-'}</span></div>
      <div>API_URL: <span>${process.env.API_URL || '-'}</span></div>
      <div>PORT: <span>${PORT}</span></div>
      <div>启动时间: <span>${new Date().toISOString()}</span></div>
    </div>
  </div>
</body></html>`);
});

server.listen(PORT, () => {
  console.log(`测试服务已启动: http://localhost:${PORT}`);
});