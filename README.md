# TopoMari

<p align="center">
  <img src="public/favicon.png" width="112" alt="TopoMari 图标" />
</p>

TopoMari 是一个可以部署在自己服务器上的 Komari 链路拓扑面板。它把“本地 → 中转 → 落地 → 目标网站”画成直观的链路，并显示每一段的延迟、丢包、在线状态和历史变化。

如果还没有准备好 Komari，也可以先用内置演示数据启动，确认页面和部署流程都正常后再接入真实节点。

## 它能做什么

- 同时查看多条线路和每一段链路的健康状态。
- 在发光地球上按拓扑方向显示链路弧线、地区节点和传输光点。
- 读取 Komari 节点与 Ping 任务，估算用户到中转机的延迟。
- 通过服务端 Komari API 密钥读取节点 IP，并用 MaxMind 国家数据库自动定位地球节点。
- 在中转机、落地机上安装轻量探针，测量两台服务器之间的真实 TCP 延迟。
- 记录最近一段时间的延迟与丢包，方便发现线路波动。
- 在独立后台中添加、修改和删除链路，并管理私有探针。
- 在“设置 → 站点”中修改站点名称、描述和 PNG / ICO Favicon，并安全录入 Komari API 密钥。
- 在“设置 → 通用”中切换视觉主题、自定义日夜配色，并启用或更新 GeoIP 数据库。
- 启用 Glassmorphism 后，在一级菜单“主题设置”中配置亮暗背景图片或视频、模糊、遮罩、卡片透明度、边框和圆角。
- 支持简体中文 / English、日间 / 夜间模式、北京时间日出日落自动主题和手机页面。
- 更新面板时自动备份配置、探针身份和历史数据。

公开面板位于 `/`，打开后不会要求登录。点击右上角齿轮或直接访问 `/admin` 才会进入登录页；登录后可以使用“链路管理”、“主题设置”、“设置 → 通用”和“设置 → 站点”。管理员会话使用 HttpOnly Cookie，站点与主题配置写入 `config/topology.json`，自定义 Favicon 与上传的背景媒体写入持久化的 `data/` 目录。

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
# 可留空，启动后也能在“设置 → 站点”中安全保存
KOMARI_API_KEY=
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
- 使用自动 GeoIP 定位：可以填写服务端 `KOMARI_API_KEY`，也可以启动后在“设置 → 站点”中保存；密钥和节点 IP 只在 TopoMari 服务端使用。
- Komari 需要登录时：继续填写 `.env` 里的 `KOMARI_COOKIE` 或 `KOMARI_AUTHORIZATION`。
- `DASHBOARD_USER` 和 `DASHBOARD_PASSWORD` 是 TopoMari 后台账号，不是 Komari 账号；公开面板不使用这组账号。
- “链路管理”只有在账号密码和 `ENABLE_TOPOLOGY_EDITOR=true` 都已配置时才可使用。

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

现在打开 `https://topology.example.com` 会直接显示公开面板。需要修改配置时，点击右上角齿轮进入后台，再输入 `.env` 中设置的 TopoMari 账号和密码。

> 建议完成 HTTPS 后再安装私有探针，避免探针 Token 通过明文 HTTP 传输。

## 第一次使用

### 添加真实链路

点击公开面板右上角齿轮，登录后台后进入“链路管理”：

1. 点击“新链路”，填写一个容易识别的名称。
2. 选择 Komari 中的中转节点和落地节点。
3. 给第一段链路选择一个或多个 Komari Ping 任务。
4. 给需要主动测量的链路填写唯一的 `probe_id` 和 `agent_id`。
5. 点击“保存并应用”。

仓库中的 Alpha / Beta 线路只是演示数据。接入真实 Komari 后，请在管理页面中换成自己的节点和任务。

顶部地球会直接按照链路节点顺序绘制传输方向。节点可在 `config/topology.json` 中同时提供 `latitude` 与 `longitude` 以精确定位；没有手动坐标时，TopoMari 会优先使用已启用的 MaxMind 国家结果，再从 `region`、节点名称中的城市或 `JP`、`US`、`SG` 等地区代码推断，并为无法识别的演示节点分配稳定的备用位置。

### 启用 MaxMind GeoIP 定位

先在服务器 `.env` 中配置 `KOMARI_API_KEY`，或登录 TopoMari 后台在“设置 → 站点 → Komari API 密钥”中保存。后台保存的值位于忽略版本控制的 `data/komari-api-key`，不会回显到浏览器；随后打开“设置 → 通用 → GeoIP 数据库”：

1. 点击“更新”，TopoMari 会通过 Komari 管理接口启用 `mmdb` 提供商并更新 GeoLite2 Country 数据库；
2. 打开“启用地理位置信息”，再保存通用设置；
3. 公开面板下一次刷新时会按国家位置绘制 Komari 节点。

TopoMari 只从 Komari 管理接口临时读取节点 UUID 与公网 IP；公开 `/api/site` 和 `/api/dashboard` 只返回已清洗的国家代码、国家名称和定位来源，不返回 IP、API 密钥或 Komari 节点令牌。MaxMind Country 数据只能定位到国家中心点；需要精确位置时仍可在拓扑节点上填写 `latitude` 和 `longitude`，手动坐标优先。

### 设置主题和颜色

进入“设置 → 通用”后，可以在 TopoMari 原版与 Glassmorphism 之间切换。Glassmorphism 已原生作用于公开面板的顶部栏、统计卡片、链路拓扑、健康列表和节点卡片，也会统一后台表面；它不会加载外部脚本，也不会替换 TopoMari 的数据接口。

打开“启用自定义配色”后，可以分别调整日间 / 夜间背景色和强调色。颜色只接受六位十六进制值，保存后写入 `config/topology.json` 并立即应用到公开面板。Glassmorphism 的配色与毛玻璃层思路来自 MIT 授权的 [komari-theme-Glassmorphism](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism)，许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

一级菜单“主题设置”是 Glassmorphism 专属的细节控制。必须先在“设置 → 通用”中选择并保存 Glassmorphism；TopoMari 原版始终使用自己的内置背景，后台和接口都不会允许它修改背景或玻璃参数。切回原版不会删除已经保存的 Glassmorphism 设置，再次切换回来时可以继续使用。

- 启用或停用自定义背景，并选择图片 / 视频；
- 为亮色、暗色模式分别填写 HTTPS 地址、站内 `/路径`，或上传 PNG、JPEG、WebP、GIF、MP4、WebM 文件；
- 调节背景模糊和遮罩强度；
- 调节公开面板毛玻璃卡片的模糊、不透明度、边框强度和圆角。

上传文件最大 32 MiB，保存在 `data/theme/user-assets/`。远程背景地址不会经 TopoMari 服务端代理，而是由访客浏览器直接请求，因此第三方背景主机能看到访客 IP；在意隐私时请优先上传到本机。主题样式的选择仍固定在“设置 → 通用”，不会和这些细节控制混在一起。

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

- 顶部六个数字：线路数量、在线节点、平均延迟、平均丢包、监测链路段和异常链路。
- 链路拓扑：快速判断是哪一段变慢或断开。
- 链路健康：查看最新延迟、平均延迟、丢包和变化趋势。
- 受监测节点：确认 Komari 节点是否在线。
- 后台管理：点击右上角齿轮后登录，可修改线路、部署探针、启停探针，以及编辑通用主题和站点设置。

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

## 如何卸载

### 卸载 Dashboard

在项目目录运行一键卸载脚本：

```bash
cd /opt/TopoMari || exit 1
sudo bash scripts/uninstall-dashboard.sh
```

脚本会依次停止 Docker Compose 和非 Docker systemd 服务，备份 `.env`、`config/`、`data/`，移除 `komari-topology-dashboard.service` 与默认的 Nginx `topomari` 站点配置，最后把项目目录移动为带时间戳的 `TopoMari.uninstalled-*`。它不会使用 `docker compose down -v`，也不会永久删除运行数据；完成时会打印运行数据备份、系统配置备份和可恢复项目目录的确切位置。

如果 Nginx 配置文件不是默认的 `topomari`，运行时传入文件名（只写文件名，不写路径）：

```bash
cd /opt/TopoMari || exit 1
sudo TOPOMARI_NGINX_SITE=topology.example.com bash scripts/uninstall-dashboard.sh
```

恢复时，把 `TopoMari.uninstalled-时间戳` 改回原目录名，再恢复 Nginx / systemd 配置并启动服务即可。确认长期不再需要后，才手动删除该目录和 `/var/backups/topomari/` 下对应备份。

脚本不会连接其他服务器，因此私有探针需要按照下一节在每台来源服务器上分别卸载。HTTPS 证书也会保留；确实不再使用原域名时，可单独执行：

```bash
sudo certbot delete --cert-name topology.example.com
```

### 卸载私有探针

在每台安装过探针的来源服务器上执行：

```bash
curl -fsSL https://你的-topomari-域名/agent/uninstall.sh -o /tmp/uninstall-topology-agent.sh
sudo bash /tmp/uninstall-topology-agent.sh
```

卸载脚本会停止并删除 `komari-topology-agent.service`，同时删除该服务器保存的 Agent Token 和探针程序。删除后若要重新接入，需要在 TopoMari 后台重新生成一次性部署命令。

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

### 进入后台后没有“链路管理”

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
