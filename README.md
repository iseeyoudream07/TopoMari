# TopoMari

<p align="center">
  <img src="public/favicon.png" width="112" alt="TopoMari 图标" />
</p>

TopoMari 是一个可以部署在自己服务器上的 Komari 链路拓扑面板。它把“本地 → 中转 → 落地 → 目标网站”画成直观的链路，并显示每一段的延迟、丢包、在线状态和历史变化。

如果还没有准备好 Komari，也可以先用内置演示数据启动，确认页面和部署流程都正常后再接入真实节点。

## 它能做什么

- 同时查看多条线路和每一段链路的健康状态。
- 读取 Komari 节点与 Ping 任务，估算用户到中转机的延迟。
- 在中转机、落地机上安装轻量探针，测量两台服务器之间的真实 TCP 延迟。
- 记录最近一段时间的延迟与丢包，方便发现线路波动。
- 直接在网页里添加、修改和删除链路。
- 支持简体中文 / English、日间 / 夜间模式和手机页面。
- 更新面板时自动备份配置、探针身份和历史数据。

页面默认的网站名称和主标题都是 `TopoMari`。后端已预留品牌设置接口：读取使用 `GET /api/editor/branding`，修改使用 `PUT /api/editor/branding`；写入需要启用链路编辑器，并携带 Basic Auth、编辑器 CSRF Token 和当前配置 `revision`。请求体字段为 `siteName`、`mainTitle`、`revision`，以后可以直接接入设置页面。

一条常见线路大致是：

```text
本地网络 → 中转服务器 → 落地服务器 → 目标网站
```

## 推荐部署方式

下面以一台 Ubuntu / Debian 服务器为例，使用 Docker Compose 部署。这种方式最省心，也方便以后更新。

开始前请准备：

- 一台可以使用 `sudo` 的服务器；
- 一个已经解析到该服务器的域名，例如 `topology.example.com`；
- 放行 TCP 80 和 443；
- 如果要显示真实数据，还需要一个可访问的 Komari 面板。

### 1. 安装 Docker、Git 和 Nginx

```bash
sudo apt update
sudo apt install -y git curl ca-certificates nginx
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sudo sh /tmp/get-docker.sh
sudo systemctl enable --now docker nginx
docker --version
docker compose version
```

最后两条命令都能显示版本号，就可以继续。

### 2. 下载 TopoMari

```bash
cd /opt
sudo git clone https://github.com/iseeyoudream07/TopoMari.git
cd /opt/TopoMari
sudo cp .env.example .env
sudo cp config/topology.example.json config/topology.json
sudo chown -R 1000:1000 config data
sudo chmod 0750 config data
sudo chmod 0600 .env
```

### 3. 填写配置

编辑配置文件：

```bash
sudo nano /opt/TopoMari/.env
```

先填写下面这些常用项目：

```dotenv
KOMARI_BASE_URL=https://你的-komari-域名/
DEMO_MODE=false

HOST=127.0.0.1
PORT=3000

DASHBOARD_USER=topomari
DASHBOARD_PASSWORD=请换成一个足够长的随机密码
ALLOW_UNAUTHENTICATED_DASHBOARD=false
ENABLE_TOPOLOGY_EDITOR=true
```

说明：

- 只想先看演示页面：把 `KOMARI_BASE_URL` 留空，并设置 `DEMO_MODE=true`。
- 使用真实 Komari：填写 `KOMARI_BASE_URL`，并设置 `DEMO_MODE=false`。
- Komari 需要登录时：继续填写 `.env` 里的 `KOMARI_COOKIE` 或 `KOMARI_AUTHORIZATION`。
- `DASHBOARD_USER` 和 `DASHBOARD_PASSWORD` 是 TopoMari 自己的登录账号，不是 Komari 账号。
- 网页里的“管理链路”只有在账号密码和 `ENABLE_TOPOLOGY_EDITOR=true` 都已配置时才会出现。

可以用下面的命令生成随机密码：

```bash
openssl rand -base64 24
```

### 4. 启动面板

```bash
cd /opt/TopoMari
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=100 komari-topology
curl -fsS http://127.0.0.1:3000/api/health
```

看到容器状态为 `healthy`，并且健康接口返回 JSON，就说明 TopoMari 已经启动。服务只监听 `127.0.0.1:3000`，不会直接把 Node.js 端口暴露到公网。

### 5. 配置域名访问

创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/topomari
```

写入以下内容，并把域名换成自己的：

```nginx
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
```

启用配置：

```bash
sudo ln -sfn /etc/nginx/sites-available/topomari /etc/nginx/sites-enabled/topomari
sudo nginx -t
sudo systemctl reload nginx
```

### 6. 开启 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d topology.example.com --redirect
sudo nginx -t
sudo systemctl reload nginx
```

现在打开 `https://topology.example.com`，输入 `.env` 中设置的 TopoMari 账号和密码即可。

> 建议完成 HTTPS 后再安装私有探针，避免探针 Token 通过明文 HTTP 传输。

## 第一次使用

### 添加真实链路

登录面板后点击“管理链路”：

1. 点击“新链路”，填写一个容易识别的名称。
2. 选择 Komari 中的中转节点和落地节点。
3. 给第一段链路选择一个或多个 Komari Ping 任务。
4. 给需要主动测量的链路填写唯一的 `probe_id` 和 `agent_id`。
5. 点击“保存并应用”。

仓库中的 Alpha / Beta 线路只是演示数据。接入真实 Komari 后，请在管理页面中换成自己的节点和任务。

### 安装私有探针

私有探针用于测量“中转 → 落地”或“落地 → 目标网站”等链路：

1. 在“管理链路”中打开“私有探针部署”。
2. 选择链路，填写目标 IP、端口和采样间隔。
3. 点击“生成一次性部署命令”。
4. 把命令复制到这段链路的来源服务器上执行。

安装成功时会看到：

```text
First private probe report accepted.
Private probe installed and reporting
```

探针状态会回到 TopoMari 的“已注册探针”区域。目标地址只会保存在运行探针的服务器上，不会写入面板配置。

## 平时怎么看

- 顶部四个数字：线路数量、在线节点、平均延迟和平均丢包。
- 链路拓扑：快速判断是哪一段变慢或断开。
- 链路健康：查看最新延迟、平均延迟、丢包和变化趋势。
- 受监测节点：确认 Komari 节点是否在线。
- 管理链路：修改线路、部署探针、启用或停用探针。

状态含义：

- `健康`：延迟和丢包处于正常范围；
- `关注`：出现轻微延迟或丢包；
- `异常`：延迟或丢包已经明显影响线路；
- `失败`：当前测量失败；
- `无数据`：任务或探针暂时没有可用样本。

## 如何更新

不要删除旧目录后重新克隆。TopoMari 的线路配置、探针身份和历史数据都保存在旧目录里，直接替换容易导致探针持续返回 401。

在原目录运行更新脚本：

```bash
cd /opt/TopoMari
sudo bash scripts/update-dashboard.sh
```

脚本会自动完成：

1. 停止容器；
2. 备份 `.env`、`config/` 和 `data/`；
3. 拉取最新代码；
4. 检查探针身份文件没有丢失；
5. 重新构建并启动；
6. 等待健康检查通过。

备份默认保存在 `/var/backups/topomari`。更新完成后可以这样确认：

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 komari-topology
curl -fsS http://127.0.0.1:3000/api/health
```

### 更新已经安装的探针

更新 Dashboard 不会自动修改各台服务器上的探针。确实需要升级探针程序时，在对应服务器执行：

```bash
curl -fsSL https://你的-topomari-域名/agent/update.sh -o /tmp/update-topology-agent.sh
sudo bash /tmp/update-topology-agent.sh
```

更新器会保留原来的 Agent ID、Token、目标地址和端口，验证失败时会恢复旧版本。

## 常用命令

```bash
# 查看运行状态
cd /opt/TopoMari
sudo docker compose ps

# 查看最近日志
sudo docker compose logs --tail=100 komari-topology

# 持续查看日志
sudo docker compose logs -f komari-topology

# 重启
sudo docker compose restart komari-topology

# 停止
sudo docker compose down

# 启动
sudo docker compose up -d
```

## 常见问题

### 页面能打开，但没有“管理链路”

检查 `.env` 是否同时设置了 `DASHBOARD_USER`、`DASHBOARD_PASSWORD` 和 `ENABLE_TOPOLOGY_EDITOR=true`，然后运行：

```bash
cd /opt/TopoMari
sudo docker compose up -d --build --force-recreate
```

### Komari 和 TopoMari 在同一台服务器

容器中的 `127.0.0.1` 指向容器自身。如果 Komari 只监听宿主机端口，可以尝试：

```dotenv
KOMARI_BASE_URL=http://host.docker.internal:Komari端口/
```

### 页面一直显示无数据

依次检查：

1. `KOMARI_BASE_URL` 能否从 TopoMari 服务器访问；
2. 私有 Komari 是否需要填写 Cookie 或 Authorization；
3. Komari 中是否已经创建 Ping 任务；
4. 管理链路时选择的任务和节点是否正确；
5. `sudo docker compose logs --tail=100 komari-topology` 中是否有连接错误。

### 更新后探针返回 401

通常是 `config/agents.json` 被替换或丢失。不要重新安装所有探针，先参考 [完整部署指南](QUICKSTART.md) 中的“从旧项目目录补回 Agent 注册表”。

## 其他说明

- 更完整的更新、回滚和 Agent 恢复步骤见 [QUICKSTART.md](QUICKSTART.md)。
- 不使用 Docker 时，可以运行 `sudo bash scripts/install-dashboard-service.sh` 安装 systemd 服务。
- `.env`、`config/topology.json`、`config/agents.json` 和 `data/` 都是服务器私有数据，不要上传到 GitHub。
- 安全问题请查看 [SECURITY.md](SECURITY.md)。
- 本项目使用 [MIT License](LICENSE)。
