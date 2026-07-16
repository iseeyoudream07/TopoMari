# TopoMari

TopoMari is a self-hosted multi-hop topology dashboard for Komari, private TCP probes, latency history, packet loss, and route health.

这是一个独立于 Komari 原生前端的链路拓扑面板，适合观察：

```text
客户端网络 -> 中转节点 -> 出口节点 -> 公网目标
```

主要能力：

- 读取经过字段白名单处理的 Komari 节点和 Ping 任务。
- 聚合多个 Komari Ping 任务，作为客户端到中转节点的反向延迟估算。
- 在中转、出口等来源机运行轻量 Python Agent，测量 TCP 建连耗时。
- 使用短期单次注册码兑换 Agent Token，面板端只保存 Token 的 SHA-256 哈希。
- 使用 SQLite 保存历史延迟和丢包数据。
- 在登录后的网页中新增、编辑、删除和保存链路。
- 为每条 edge 设置独立的延迟与丢包健康阈值。
- Docker Compose、systemd、Nginx 和 HTTPS 部署支持。

浏览器不会获得 Agent Token、探针目标地址、Komari Cookie、Authorization 或 Komari 原始 payload。

## 快速体验

要求 Node.js 22.13 或更高版本。

```bash
git clone https://github.com/iseeyoudream07/TopoMari.git
cd TopoMari
cp .env.example .env
cp config/topology.example.json config/topology.json
npm start
```

未配置 `KOMARI_BASE_URL` 时，服务自动进入动画演示模式：

```text
http://127.0.0.1:3000
```

仓库中的 [config/topology.example.json](config/topology.example.json) 只包含虚构的 Alpha/Beta 示例节点，不对应任何真实服务器。运行时配置 `config/topology.json` 已被 Git 忽略。

## 正式环境配置

编辑 `.env`：

```dotenv
KOMARI_BASE_URL=https://status.example.com/
KOMARI_COOKIE=
KOMARI_AUTHORIZATION=
DEMO_MODE=false

HOST=127.0.0.1
PORT=3000

DASHBOARD_USER=your-user
DASHBOARD_PASSWORD=replace-with-a-long-random-password
ALLOW_UNAUTHENTICATED_DASHBOARD=false
ENABLE_DIAGNOSTIC_API=false
ENABLE_TOPOLOGY_EDITOR=true

PROBE_DB_PATH=./data/probes.db
AGENT_CONFIG_PATH=./config/agents.json
TOPOLOGY_CONFIG_PATH=./config/topology.json
PROBE_RETENTION_DAYS=7
```

live 模式默认要求应用自身配置 Basic Auth。`ENABLE_TOPOLOGY_EDITOR=true` 只有在用户名和密码都已配置时才会启用。

如果 Komari 需要登录态，可以在服务端环境中配置 `KOMARI_COOKIE` 或 `KOMARI_AUTHORIZATION`；不要把真实值提交到 Git。

## 配置链路

启动后点击右上角“管理链路”：

1. 从经过字段筛选的 Komari 节点列表中选择中转和出口节点。
2. 为第一段选择一个或多个 Komari Ping 任务。
3. 为私有探针 edge 填写唯一的 `probe_id`、显示名称和 `agent_id`。
4. 根据链路距离设置可选的健康阈值。
5. 保存并应用配置。

默认示例中的 `relay-alpha`、`exit-alpha` 等 ID 必须替换成你自己的 Komari 节点 ID，才能用于 live 模式。

拓扑配置只保存链路标识，不保存探针目标 IP 或端口。目标地址只在浏览器生成部署命令时使用，并最终写入来源机本地的 `/etc/komari-topology-agent.json`。

## 部署私有探针

推荐在网页“管理链路 → 私有探针一键部署”中生成安装命令。流程如下：

1. 面板生成 15 分钟有效、只能使用一次的注册码。
2. 来源机通过 HTTPS 兑换长期 Agent Token。
3. 安装器先执行一次真实测量，并要求面板返回 `202 Accepted`。
4. 首报成功后才安装并启动 systemd 服务。

看到下面两行才表示安装完成：

```text
First private probe report accepted.
Private probe installed and reporting
```

安装器默认拒绝通过 HTTP 传输 Token。生产环境应先配置 HTTPS。

### 手动 Token 模式

如需离线或手动管理，可以从当前拓扑自动创建尚不存在的 Agent：

```bash
npm run agents:bootstrap
```

脚本会读取所有同时包含 `probe_id` 与 `agent_id` 的 edge，并为每个新 Agent 显示一次 Token。也可以逐个管理：

```bash
npm run agent:create -- relay-alpha-agent relay-alpha-to-exit-alpha
npm run agent:list
npm run agent:rotate -- relay-alpha-agent
npm run agent:revoke -- relay-alpha-agent
npm run agent:enable -- relay-alpha-agent
```

手动安装示例：

```bash
curl -fsSL https://topology.example.com/agent/install.sh -o /tmp/install-topology-agent.sh
chmod +x /tmp/install-topology-agent.sh

bash /tmp/install-topology-agent.sh \
  --server-url https://topology.example.com \
  --agent-id relay-alpha-agent \
  --edge-id relay-alpha-to-exit-alpha \
  --target-host 203.0.113.10 \
  --target-port 443
```

`203.0.113.10` 属于文档专用地址段，请替换成实际目标。

## Docker Compose

```bash
cp .env.example .env
cp config/topology.example.json config/topology.json
nano .env
sudo chown -R 1000:1000 config data
docker compose up -d --build
docker compose logs -f komari-topology
```

Compose 只把服务发布到宿主机的 `127.0.0.1:3000`。容器使用非 root 用户、只读根文件系统、`no-new-privileges`，并移除全部 Linux capabilities。

持久化目录：

```text
./config -> /app/config
./data   -> /app/data
```

## systemd

项目放在 `/opt` 等非 home 目录并配置好 `.env` 后执行：

```bash
sudo bash scripts/install-dashboard-service.sh
sudo systemctl status komari-topology-dashboard --no-pager
sudo journalctl -u komari-topology-dashboard -f
```

脚本会创建无登录权限的专用用户，并限制服务只能写入项目的 `config/` 和 `data/` 目录。

## Nginx 与 HTTPS

```nginx
server {
    listen 443 ssl;
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
```

完整部署步骤见 [QUICKSTART.md](QUICKSTART.md)。

## 健康阈值

默认规则：

- 平均延迟达到 150ms 或丢包率高于 0%：`warning`
- 平均延迟达到 250ms 或丢包率达到 20%：`degraded`

单条 edge 可以覆盖默认值：

```json
{
  "from": "relay-alpha",
  "to": "exit-alpha",
  "probe_id": "relay-alpha-to-exit-alpha",
  "agent_id": "relay-alpha-agent",
  "health_thresholds": {
    "warning_latency_ms": 250,
    "degraded_latency_ms": 400,
    "warning_loss_percent": 2,
    "degraded_loss_percent": 25
  }
}
```

warning 阈值必须低于对应的 degraded 阈值。

## API

| 接口 | 认证 | 用途 |
|---|---|---|
| `GET /api/health` | 无 | 后端状态 |
| `GET /api/dashboard` | Basic Auth（live 默认必需） | 完整拓扑快照 |
| `GET /api/probes` | Basic Auth | Agent 与 edge 接收状态 |
| `GET /api/edge-stats?probe_id=...` | Basic Auth | 私有链路统计 |
| `GET /api/nodes` | Basic Auth + 诊断开关 | 筛选后的 Komari 节点 |
| `GET /api/ping-tasks` | Basic Auth + 诊断开关 | 筛选后的 Ping 任务 |
| `GET /api/editor/bootstrap` | Basic Auth + 编辑器开关 | 编辑器初始化数据 |
| `PUT /api/editor/topology` | Basic Auth + CSRF | 原子保存拓扑 |
| `POST /api/editor/enrollments` | Basic Auth + CSRF | 签发一次性注册码 |
| `POST /api/enroll` | 一次性注册码 | 兑换 Agent Token |
| `POST /api/ingest` | Agent Bearer Token | 私有探针上报 |

`/api/nodes` 和 `/api/ping-tasks` 默认关闭。服务不会提供透传 Komari 原始 payload 的接口。

## 安全与隐私

下面这些运行时文件已被 `.gitignore` 和 `.dockerignore` 排除：

```text
.env
config/topology.json
config/agents.json
data/*
```

公开仓库前仍应执行自己的秘密扫描，并避免使用 `git add -f` 强制添加这些文件。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 检查与测试

```bash
npm run check
npm test
npm run audit:public
```

项目没有第三方运行时依赖；服务器、存储和探针均使用 Node.js/Python 标准库。

## 参与贡献

提交修改前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
