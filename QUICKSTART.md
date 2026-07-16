# Ubuntu + Docker Compose 部署指南

本指南使用以下通用示例：

```text
项目目录：/opt/TopoMari
面板域名：topology.example.com
本地端口：127.0.0.1:3000
```

请把示例域名和账号配置替换成自己的值。

## 1. 获取项目并创建运行时配置

```bash
cd /opt
sudo git clone https://github.com/iseeyoudream07/TopoMari.git TopoMari
cd /opt/TopoMari

sudo cp .env.example .env
sudo cp config/topology.example.json config/topology.json
sudo chown -R 1000:1000 config data
sudo chmod 0750 config data
```

`.env`、`config/topology.json`、`config/agents.json` 和 `data/*.db` 都是本机运行时文件，不应提交到 Git。

## 2. 配置 live 模式

编辑 `.env`：

```dotenv
KOMARI_BASE_URL=https://status.example.com/
DEMO_MODE=false
HOST=127.0.0.1
PORT=3000

DASHBOARD_USER=your-user
DASHBOARD_PASSWORD=replace-with-a-long-random-password
ALLOW_UNAUTHENTICATED_DASHBOARD=false
ENABLE_DIAGNOSTIC_API=false
ENABLE_TOPOLOGY_EDITOR=true
```

如果 Komari 需要登录态，再填写 `KOMARI_COOKIE` 或 `KOMARI_AUTHORIZATION`。这些值只能存在于服务器 `.env` 中。

只想先查看演示页面时，保持 `KOMARI_BASE_URL` 为空并使用 `DEMO_MODE=true`。

## 3. 启动容器

```bash
cd /opt/TopoMari
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 komari-topology
```

验证：

```bash
curl -fsS http://127.0.0.1:3000/api/health
sudo ss -ltnp | grep ':3000'
```

宿主机应只显示 `127.0.0.1:3000`，不能把 Node 服务直接绑定到公网网卡。

## 4. 配置 Nginx

```bash
sudo tee /etc/nginx/sites-available/topology.example.com >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name topology.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX

sudo ln -sfn /etc/nginx/sites-available/topology.example.com /etc/nginx/sites-enabled/topology.example.com
sudo nginx -t
sudo systemctl reload nginx
```

先确认 DNS A/AAAA 记录已经指向面板服务器，并放行 TCP 80/443。

## 5. 配置 HTTPS

Ubuntu/Debian：

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d topology.example.com --redirect
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

不要在 HTTPS 完成前部署真实探针。安装器默认拒绝通过 HTTP 传输 Token。

## 6. 替换示例拓扑

登录 `https://topology.example.com`，点击“管理链路”：

1. 新建 route。
2. 从 Komari 节点列表选择真实的中转和出口节点。
3. 为第一段选择一个或多个 Komari Ping 任务。
4. 为私有 edge 设置唯一的 `probe_id` 和 `agent_id`。
5. 保存配置。

默认的 Alpha/Beta 节点只是公开演示数据，不能直接用于 live 环境。

## 7. 部署探针

在网页的“私有探针一键部署”中：

1. 选择一条 private edge。
2. 输入目标主机和 TCP 端口。
3. 生成一次性安装命令。
4. 在该 edge 的来源机执行命令。

只有出现以下输出才算成功：

```text
First private probe report accepted.
Private probe installed and reporting
```

来源机验证：

```bash
sudo systemctl is-active komari-topology-agent.service
sudo systemctl status komari-topology-agent.service --no-pager
sudo journalctl -u komari-topology-agent.service -n 80 --no-pager
```

面板验证：

```bash
curl -fsS -u 'your-user:your-password' http://127.0.0.1:3000/api/probes
```

## 8. 安全升级

升级前先备份所有运行时状态：

```bash
cd /opt/TopoMari
sudo docker compose down
sudo tar -C /opt -czf "/root/topomari-backup-$(date +%F-%H%M%S).tar.gz" TopoMari

sudo git pull --ff-only
sudo chown -R 1000:1000 config data
sudo docker compose up -d --build --force-recreate
```

由于运行时配置已被 Git 忽略，正常 `git pull` 不会覆盖 `.env`、真实拓扑、Agent Token 哈希或 SQLite 历史。

升级后验证：

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 komari-topology
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS -u 'your-user:your-password' http://127.0.0.1:3000/api/dashboard >/dev/null
```

## 9. 回滚

```bash
cd /opt
sudo docker compose -f TopoMari/docker-compose.yml down || true
sudo mv TopoMari TopoMari.failed
sudo tar -C /opt -xzf /root/topomari-backup-YYYY-MM-DD-HHMMSS.tar.gz
cd /opt/TopoMari
sudo docker compose up -d --build
```

把备份文件名替换成升级时实际生成的文件名。
