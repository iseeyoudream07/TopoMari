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
# Optional here; it can also be saved from Settings -> Site after startup.
KOMARI_API_KEY=
DEMO_MODE=false
HOST=127.0.0.1
PORT=3000

DASHBOARD_USER=your-user
DASHBOARD_PASSWORD=replace-with-a-long-random-password
ALLOW_UNAUTHENTICATED_DASHBOARD=false
ENABLE_DIAGNOSTIC_API=false
ENABLE_TOPOLOGY_EDITOR=true
```

如果 Komari 需要登录态，再填写 `KOMARI_COOKIE` 或 `KOMARI_AUTHORIZATION`。需要 MaxMind 自动定位时，可填写 Komari 管理员 `KOMARI_API_KEY`，也可在启动后通过“设置 → 站点”保存；后台保存的值只存在于持久化 `data/komari-api-key`，不会返回前端。

公开面板 `/` 不要求登录。`DASHBOARD_USER` 和 `DASHBOARD_PASSWORD` 只用于 `/admin` 后台；“设置 → 通用”可以切换主题、调整日夜配色、设置全局链路健康阈值、启用北京时间自动主题，以及启用和更新 MaxMind GeoIP；“设置 → 站点”可以修改名称、描述、自定义 Favicon 和服务端 Komari API 密钥。

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
    client_max_body_size 32m;

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

打开 `https://topology.example.com` 后点击右上角齿轮，登录 `/admin` 并进入“链路管理”：

1. 新建 route。
2. 从 Komari 节点列表选择真实的中转和出口节点。
3. 为第一段选择一个或多个 Komari Ping 任务。
4. 为私有 edge 设置唯一的 `probe_id` 和 `agent_id`。
5. 保存配置。

如需按 Komari 节点公网 IP 自动定位，先在“设置 → 站点”保存 Komari API 密钥（或使用 `.env`），再进入“设置 → 通用 → GeoIP 数据库”，点击“更新”，启用地理位置信息后保存。节点 IP 和密钥只在服务端处理。

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

不要把新版本克隆到另一个目录后只复制 `config/topology.json`。以下四类文件共同构成运行时状态，缺少 `config/agents.json` 会让旧 Agent 持续收到 401：

```text
.env
config/topology.json
config/agents.json
data/probes.db
```

在原项目目录使用带保护的更新脚本：

```bash
cd /opt/TopoMari
sudo bash scripts/update-dashboard.sh
```

脚本会停机关闭 SQLite，将 `.env`、`config/`、`data/` 备份到 `/var/backups/topomari`，只允许 fast-forward 拉取，对 Agent 注册表做更新前后 SHA-256 指纹校验，重建容器并等待健康接口。任何一步失败都会保留备份并尝试重新启动服务。

新版本还会把 `config/agents.json` 原样镜像到 `data/agents.backup.json`。如果后续更新只误丢主注册表而 `data/` 仍在，服务启动时会自动恢复原 Token 哈希和 edge 权限，不需要重装 Agent。

升级后验证：

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 komari-topology
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/dashboard >/dev/null
```

`/api/health` 应包含 `"agentRegistryProtection":"mirrored"`。

### 从旧项目目录补回 Agent 注册表

如果之前从 `/opt/komari-topology-dashboard` 切换到了 `/opt/TopoMari`，而旧目录还在，不要直接覆盖当前 `config/agents.json`，否则新建的 Agent 也会失效。使用合并恢复：

```bash
cd /opt/TopoMari
sudo cp /opt/komari-topology-dashboard/config/agents.json config/agents.previous.json
sudo chown 1000:1000 config/agents.previous.json
sudo docker compose exec komari-topology \
  node scripts/recover-agent-registry.mjs /app/config/agents.previous.json
sudo rm -f config/agents.previous.json
```

该命令只添加当前缺失的 Agent；同名 Token 冲突不会覆盖当前记录。若旧注册表也已丢失，只能为受影响的 Agent 重新生成一次注册码并在对应来源机重新执行安装命令。

### 更新 Agent 程序（不轮换 Token）

Dashboard 更新本身不需要更新来源机 Agent。需要启用新版 watchdog 时，在每台来源机执行：

```bash
curl -fsSL https://topology.example.com/agent/update.sh -o /tmp/update-topology-agent.sh
sudo bash /tmp/update-topology-agent.sh
```

更新器使用现有 Token 做首报验证，保留 `/etc/komari-topology-agent.json`，失败时回滚旧程序和 systemd unit。

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
