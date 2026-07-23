# TopoMari 项目交接

最后更新：2026-07-19（Asia/Shanghai）

## 1. 当前状态快照

- 项目：TopoMari，自托管 Komari 链路拓扑面板。
- 环境传入的旧目录名是 `/Users/iseeyoudream/Documents/komari-topology-dashboard`，实际解析后的本地检出路径是 `/Users/iseeyoudream/Documents/TopoMari`。
- 当前版本：`2.8.2`，以 `package.json` 和 `CHANGELOG.md` 为准。
- 远端：`https://github.com/iseeyoudream07/TopoMari.git`。
- 当前本地分支：`agent/topomari-2-8-2-komari-geoip`，HEAD 为 `730a779`。
- 远端跟踪分支 `origin/main` 为 `421d44c`，即 PR #12 的合并提交；因此 2.8.2 代码已经合入远端主分支。
- 本地 `main` 仍停在 `d551eb2`，比 `origin/main` 落后 11 个提交。
- 创建本文档前工作区干净；本文档本身尚未提交。
- 本地没有 Git tag。是否需要补 `v2.8.2` tag 或 GitHub Release，尚未决定，也未在线核验。

### 2026-07-19 重新验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 70/70 通过 |
| `npm run audit:public` | 通过，扫描 71 个文件 |
| `git diff --check origin/main...HEAD` | 通过；当前功能提交已在 `origin/main` |
| `npm pack --dry-run` | 通过，`topomari@2.8.2`，70 个打包文件，约 1.8 MB |

说明：以上是本地代码、测试和本地远端引用的验证。当前 `gh` 缓存令牌无效，而且本环境连接 `api.github.com` 失败，所以没有在本次交接中在线刷新 GitHub Actions、Release 或仓库页面状态。

## 2. 过往任务目标

项目历次工作的总体目标是：把最初面向单一环境的 Komari 拓扑面板，逐步变成可以公开发布、安全更新、保护运行时隐私、具备后台管理能力，并能清晰展示真实链路和地理位置的通用自托管项目。

具体目标包括：

1. 展示“本地 → 中转 → 落地 → 目标”的链路状态、延迟、丢包和历史趋势。
2. 支持 Komari Ping 数据与私有 Agent TCP 探测，并避免公开探针凭据和内部诊断信息。
3. 提供认证后台、拓扑编辑器、一次性 Agent 注册和安全的配置写入。
4. 将仓库公开化：移除个人基础设施数据，提供示例配置、部署文档、审计脚本和 CI。
5. 提供简洁、较大、低噪音的中英文界面、明暗模式、可配置品牌与 Komari 风格后台。
6. 原生整合 Glassmorphism 视觉体系，而不替换现有 API、认证、国际化和编辑器架构。
7. 增加轻量动态地球，将拓扑方向、节点、链路健康和传输动画集中显示。
8. 通过服务端 Komari 管理接口和 MaxMind Country 数据，为没有手工坐标的真实节点补充国家级位置，同时保证 IP 和密钥不进入公开响应。
9. 让升级和卸载可恢复，始终保护 `.env`、拓扑、Agent 身份和 SQLite 历史。

## 3. 已完成内容

### 3.1 私有探针、拓扑编辑与安全边界（2.3.x–2.4.1）

- 建立私有 Agent 注册、令牌哈希、一次性注册代码、显式轮换/撤销和允许边约束。
- 增加 SQLite 探针采样、保留策略、延迟/丢包统计和每条边的健康阈值。
- 加入认证拓扑编辑器、CSRF 校验、配置 revision 和过期写入 `409` 冲突保护。
- 默认关闭诊断 API，公开接口使用字段白名单；管理、编辑、探针清单和诊断接口均受保护。
- Agent 注册表会镜像到 `data/agents.backup.json`，缺失时可恢复，且不会覆盖更新的令牌哈希。
- Agent 安装器会验证首次上报；更新器保留 Agent ID、Token、目标和配置；systemd watchdog 防止进程存活但探测停滞。
- 仪表盘安全更新脚本会锁定更新、检查脏工作区、停止 SQLite、备份 `.env/config/data`、验证 Agent 指纹、重建容器并检查健康状态。
- 修复 Docker 构建后源码权限问题：Git 更新使用可读 umask，并让镜像中的非 root `node` 用户可读取应用代码。

### 3.2 公共仓库与发布基线（2.4.0 起）

- 项目统一更名为 TopoMari，并更新包信息、页面文案、文档和仓库链接。
- 将真实运行时配置改为忽略的 `config/topology.json`、`config/agents.json` 和 `data/` 内容；仓库只发布 Alpha/Beta 示例。
- 增加 MIT License、贡献指南、安全策略、第三方声明和 GitHub Actions CI。
- 增加 `scripts/public-audit.mjs`，在发布前检查敏感内容和有效 Git 文件集。
- 形成发布检查基线：语法检查、完整测试、公开审计、`git diff --check` 和隔离 npm cache 的打包预检。

### 3.3 前端重构与品牌配置（2.5.0–2.5.1）

- 将浏览器 API、国际化、偏好、太阳时间主题和视觉 token 拆分成独立前端模块。
- 完成中英文、明暗主题和本地偏好保存；当前按需求隐藏语言切换入口，但保留实现以便后续恢复。
- 使用更安静的暖中性色、更大字号和精简文案；中文使用 Noto Serif SC，品牌图标改为提供的圆形透明图。
- 站点名与主页主标题保持为两个独立后端字段，默认都为 `TopoMari`，并兼容旧字段格式。
- 品牌修改通过认证、JSON、CSRF 和当前 revision 写入；公共响应只包含清洗后的值。

### 3.4 Komari 风格后台（2.6.0）

- 公开面板无需登录；后台 `/admin` 使用服务端账号登录和不透明 HttpOnly session cookie。
- 后台集中管理线路、站点、Favicon、主题和后续 GeoIP 设置。
- 登录页按要求只保留“登录”，返回链接简化为“返回”。
- 支持站点名、描述、Favicon 和北京时间日出/日落自动主题。
- 未设置后台凭据时，真实模式拒绝不安全启动；显式演示模式可按限定规则运行。

### 3.5 Glassmorphism 与主题背景（2.7.0–2.8.0，PR #9–#10）

- 参考 MIT 许可的 `sanrokamlan-prog/komari-theme-Glassmorphism`，只吸收视觉语言和配置思路，未嵌入其 Vue 应用或数据层。
- Glassmorphism 已原生覆盖公开面板、统计卡片、拓扑、链路健康、节点卡片、后台和响应式布局。
- 视觉预设和颜色入口保留在“后台设置 → 通用”；同时增加一级“主题设置”用于详细背景和玻璃参数。
- 支持明/暗图片或视频背景、远端 URL 或 `local:` 本地资源，以及模糊、遮罩、玻璃模糊、透明度、边框和圆角。
- 本地资源存放在 `data/theme/user-assets/`，通过 `/theme-background/:mode` 提供；上传按内容签名、格式和大小验证，而不是只相信扩展名或 MIME。
- 背景与玻璃细节仅在 Glassmorphism 激活时生效；切回原主题时保存值但不应用。
- 增加可恢复卸载脚本：备份运行时和系统配置、移除配置的 Nginx/systemd 项，并将项目移动到可恢复归档目录，不删除远端私有 Agent。
- 2.8.0 曾因 GitHub 令牌/集成权限无法立即建 PR，但分支随后通过 PR #10 合入。

### 3.6 动态地球总览（2.8.1，PR #11）

- 将公开首页重构为紧凑的六项指标总览和轻量头部。
- 新增无第三方运行时依赖的 Canvas 动态地球。
- 按拓扑节点顺序绘制地区节点、健康色链路弧线和移动传输光点。
- 支持手工经纬度、地区/名称/国家代码推断和稳定的未知节点备用位置。
- 完成桌面和移动响应式布局，并修正地球与 Glassmorphism 卡片的组合样式。
- 2.8.1 已通过 PR #11 合入远端主分支。

### 3.7 Komari MaxMind GeoIP（2.8.2，PR #12）

- 新增 `KOMARI_API_KEY`，仅用于服务端 Komari 管理接口；Cookie/Authorization 仍可独立配置。
- 新增 `KomariGeoIpService`：查询 Komari GeoIP 状态、读取节点公网地址、启用或重载 `mmdb` 提供商、触发数据库更新并验证结果。
- 只接受可公开路由的节点地址；拒绝私有、保留和文档示例地址。
- GeoIP 结果只保留两位国家代码、受限国家名和 `locationSource: "maxmind"`，不会把 IP、API key 或 Komari 节点令牌写入公开响应或拓扑配置。
- 后台“设置 → 通用”新增 GeoIP 开关、MaxMind 状态和更新按钮；更新端点为 `POST /api/admin/geoip/update`，受后台认证和 CSRF 保护。
- 位置优先级确定为：手工 `latitude/longitude` > 已启用的 MaxMind 国家位置 > `region`/名称/国家代码推断 > 确定性备用位置。
- 调整地球信息布局：数据源移入头部、移除地球说明文字；地球 Canvas 始终使用独立深色高对比配色，解决页面浅色模式下的可读性问题。
- 2.8.2 已通过 PR #12 合入 `origin/main`。

## 4. 关键技术决策

### 4.1 配置、隐私与公开 API

- 运行时数据与代码分离：`.env`、`config/topology.json`、`config/agents.json`、`data/probes.db`、`data/agents.backup.json` 和用户主题资源不得提交。
- 示例配置只使用合成 Alpha/Beta 数据；发布前必须运行公开审计和打包预检。
- `lib/topology-config.mjs` 是持久化配置和公开站点元数据的清洗边界。
- 拓扑编辑器使用允许列表，禁止目标地址、任意 secret 等字段进入可编辑/公开数据。
- Komari IP 和管理员 API key 只在服务端短暂处理；公开 `/api/site`、`/api/dashboard` 只能看到清洗后的国家级元数据。

### 4.2 前后端边界

- 浏览器请求集中在 `public/frontend/api-client.js`；`public/app.js`、`public/admin.js` 和 `public/editor.js` 不应重新散落直接请求逻辑。
- 国际化、偏好、自动主题、站点主题、背景和地球分别位于独立模块，避免把 API、状态和视觉 CSS 混为一体。
- 后台写入使用认证 session、JSON、CSRF 和 revision；发生并发修改时返回 `409`，客户端应重新读取后再提交。

### 4.3 地球与 GeoIP

- 地球使用项目自带 Canvas 实现，不引入大型地图或 WebGL 依赖，降低静态部署和供应链复杂度。
- 手工坐标永远优先，MaxMind Country 只提供国家中心级别的近似位置，不能宣称城市精度。
- GeoIP 开关属于 TopoMari 本地站点配置；Komari 的 provider/数据库状态由服务端即时读取，不把上游敏感设置整体持久化到本项目。
- GeoIP 失败不得阻断整个公开面板：实时构建会在位置服务异常时回退为空位置映射，再使用现有推断逻辑。

### 4.4 主题系统

- 主题持久化继续依附现有 topology/site config，不另建浏览器直写配置接口。
- 公共端只接收清洗后的 `visualTheme`、`themeColors`、`themeSettings` 和背景状态。
- 本地背景通过 `local:` 逻辑引用，真实文件保存在运行时目录；上传必须验证内容签名并限制体积。
- 切换主题不删除用户保存的颜色和背景，便于以后恢复。

### 4.5 运维与生命周期

- 升级前必须确认真实检出目录、`.env`、拓扑和工作区状态；服务器命令应使用 `cd /实际路径 || exit 1`，防止 `cd` 失败后在错误目录继续执行。
- 正式更新使用 `scripts/update-dashboard.sh`，让脚本负责停止、备份、拉取、权限、重建、健康检查和 Agent 指纹验证。
- 不使用 `docker compose down -v`，不随意重克隆或覆盖 `.env/config/data`。
- 卸载使用 `scripts/uninstall-dashboard.sh`，它以“可恢复归档”而不是永久删除为设计目标。

## 5. 修改过的文件

以下按职责列出本轮演进中涉及的主要文件。运行时私有文件未纳入版本控制。

### 根目录、发布与文档

- `.env.example`：Komari、后台、编辑器、GeoIP 和运行参数示例。
- `package.json`：版本、包元数据、Node 要求和检查脚本；当前为 2.8.2。
- `CHANGELOG.md`：2.3.x–2.8.2 版本演进。
- `README.md`、`QUICKSTART.md`：部署、接入 Komari、Agent、主题、地球和 GeoIP 使用说明。
- `CONTRIBUTING.md`、`SECURITY.md`、`LICENSE`、`THIRD_PARTY_NOTICES.md`：公共协作、安全和许可信息。
- `Dockerfile`、`docker-compose.yml`：非 root Node 运行、持久化挂载和部署入口。
- `config/topology.example.json`、`config/agents.example.json`：脱敏示例配置。

### 后端

- `server.mjs`：HTTP 路由、认证、CSRF、站点/背景/GeoIP 管理、静态资源和公开 API。
- `lib/admin-session.mjs`：后台 session 与 cookie。
- `lib/security-policy.mjs`：真实模式认证约束和诊断 API 门控。
- `lib/topology-config.mjs`、`lib/topology-config-store.mjs`：配置清洗、revision 与原子写入。
- `lib/topology-service.mjs`：演示/实时面板构建、节点/任务标准化、链路统计和国家级位置附加。
- `lib/komari-client.mjs`：Komari 公共数据和管理员 GeoIP 请求封装。
- `lib/komari-geoip.mjs`：公网地址过滤、MaxMind 结果清洗、状态、解析与更新服务。
- `lib/agent-registry.mjs`：Agent 身份、备份、恢复和轮换。
- `lib/probe-ingest.mjs`、`lib/probe-store.mjs`、`lib/health-status.mjs`：探针接收、SQLite 历史与状态计算。

### 公开页面与后台

- `public/index.html`、`public/styles.css`、`public/app.js`：公开仪表盘结构、总览、链路和数据绑定。
- `public/admin/index.html`、`public/admin.css`、`public/admin.js`：登录、后台导航、站点、主题和 GeoIP 设置。
- `public/editor.js`：拓扑、节点、任务、Agent 注册和保存流程。
- `public/sparkline.js`：趋势图和采样状态。
- `public/favicon.png`：用户提供的圆形透明品牌图。
- `public/frontend/api-client.js`：浏览器 API 唯一集中边界。
- `public/frontend/i18n.js`：中英文案。
- `public/frontend/preferences.js`、`preference-bootstrap.js`：语言/主题偏好和首屏启动。
- `public/frontend/site-theme.js`、`solar-theme.js`：站点设置和北京时间自动主题。
- `public/frontend/theme-background.js`、`theme.css`：Glassmorphism、背景、玻璃参数和跨页面主题样式。
- `public/frontend/route-globe.js`：坐标解析、拓扑链接构建和 Canvas 动态地球。

### Agent 与运维脚本

- `public/agent/probe_agent.py`：私有 TCP 探针。
- `public/agent/install.sh`、`update.sh`、`uninstall.sh`：Agent 生命周期。
- `scripts/bootstrap-agents.mjs`、`agent-token.mjs`、`recover-agent-registry.mjs`：Agent 初始化、管理和恢复。
- `scripts/update-dashboard.sh`：保护运行时的仪表盘更新。
- `scripts/uninstall-dashboard.sh`：可恢复卸载。
- `scripts/install-dashboard-service.sh`：systemd 安装。
- `scripts/public-audit.mjs`：公共仓库敏感内容检查。

### 测试

- `tests/admin-session.test.mjs`
- `tests/bootstrap-agents.test.mjs`
- `tests/frontend-ui.test.mjs`
- `tests/health-status.test.mjs`
- `tests/komari-client.test.mjs`
- `tests/komari-geoip.test.mjs`
- `tests/private-probes.test.mjs`
- `tests/route-globe.test.mjs`
- `tests/security-policy.test.mjs`
- `tests/solar-theme.test.mjs`
- `tests/sparkline.test.mjs`
- `tests/topology-editor.test.mjs`
- `tests/topology-service.test.mjs`

## 6. 尚未解决或尚未验证的问题

1. **本地分支未整理**：当前仍停在已经合并的 2.8.2 功能分支，本地 `main` 落后 `origin/main` 11 个提交；本文档也尚未提交。
2. **GitHub CLI 不可用**：`gh auth status` 显示 `iseeyoudream07` 的缓存 token 无效，本环境同时无法连接 `api.github.com`。后续创建 PR、检查 Actions 或发布 Release 前需要重新认证和联网核验。
3. **没有版本 tag**：本地 tag 列表为空。是否采用 `v2.8.2` tag/GitHub Release 需要由维护者确定，不能把包版本或合并 PR 自动等同于正式 GitHub Release。
4. **生产部署未在本次交接中执行**：代码已合入 `origin/main`，但没有证据证明目标 VPS 当前运行的容器已经重建到 `730a779`/2.8.2。
5. **真实 Komari GeoIP 联调未在本次交接中执行**：单元测试覆盖了 API key、provider 更新、地址过滤和隐私清洗，但仍需在实际 Komari 版本、真实管理员 API key 和真实节点上验证管理接口兼容性。
6. **2.8.2 浏览器回归未在本次交接中重跑**：已有结构/逻辑测试；仍建议在桌面和 390×844 移动视口检查浅色/深色、两种视觉主题、后台 GeoIP 状态和更新流程。
7. **MaxMind 只到国家级**：国家中心点是刻意的隐私/精度折中。如果需要城市级准确位置，应继续使用拓扑中的手工经纬度，而不是扩大公开 IP 数据范围。

## 7. 建议的下一步操作

### P0：整理本地 Git 状态并提交本文档

不要直接在已经合并的功能分支继续开发。建议从当前远端主分支新建交接文档分支；未跟踪的 `HANDOFF.md` 会随工作区保留：

```bash
cd /Users/iseeyoudream/Documents/TopoMari || exit 1
git switch -c codex/project-handoff origin/main
git add HANDOFF.md
git commit -m "docs: add project handoff"
git push -u origin codex/project-handoff
```

如需创建 PR，先修复 CLI 登录：

```bash
gh auth login -h github.com
gh auth status
```

如果本文档只用于本地交接、不准备进仓库，则不要提交它；在确认无其他改动后再将本地 `main` 快进到 `origin/main`。

### P1：安全部署 2.8.2

1. 在 VPS 上先确认实际路径。历史实际路径是 `/opt/komari-topology-dashboard`，不要假定是 `/opt/TopoMari`。
2. 确认 `.env`、`config/topology.json`、`config/agents.json`、`data/agents.backup.json` 和 `data/probes.db` 存在且权限正常。
3. 若使用 GeoIP，在服务器 `.env` 中填写 `KOMARI_API_KEY`；绝不能写入前端文件、示例配置或 Git。
4. 确认 Git 工作区干净后，从项目目录运行 `sudo ./scripts/update-dashboard.sh`。
5. 检查脚本输出的备份路径、`docker compose ps`、`/api/health`、容器创建时间和最近日志，避免把旧容器的健康响应误认为新版本已部署。
6. 验证 Agent 数量、注册表指纹和历史采样仍在。

### P1：真实 GeoIP 联调

1. 登录 TopoMari 后台，进入“设置 → 通用 → GeoIP 数据库”。
2. 点击“更新”，确认 Komari 已启用/重载 `mmdb` 并完成 GeoLite2 Country 更新。
3. 启用本地 GeoIP 设置并保存，刷新公开面板。
4. 确认无手工坐标的真实 Komari 节点按国家出现，手工经纬度节点仍保持原位置。
5. 检查 `/api/site` 和 `/api/dashboard`：只能出现国家代码、国家名和定位来源，不能出现节点 IP、`KOMARI_API_KEY`、Cookie、Authorization 或 Agent token。

### P2：浏览器与发布收尾

1. 在桌面与 390×844 移动视口测试公开面板和后台。
2. 覆盖原主题/Glassmorphism、浅色/深色、自动主题、远端/本地背景和 GeoIP 成功/缺少 key/上游不支持状态。
3. 重新运行：

```bash
npm run check
npm test
npm run audit:public
git diff --check
npm_config_cache=/tmp/topomari-npm-cache npm pack --dry-run
```

4. 恢复 GitHub 访问后，在线确认 `main`、Actions 和 PR #12 状态。
5. 如项目采用版本 tag/Release，再创建并验证 `v2.8.2`；不要在未决定发布规则前自动补 tag。

## 8. 接手时的硬性注意事项

- 不要提交或打印 `.env`、Cookie、Authorization、Komari API key、Agent token、完整唯一 ID、真实 IP 或真实拓扑。
- 不要使用 `git reset --hard`、强推、随意重克隆或 `docker compose down -v` 处理更新问题。
- 不要删除 `config/`、`data/` 或覆盖 Agent 注册表；先做可验证备份。
- 服务器连续命令必须以 `cd /实际路径 || exit 1` 开始。
- 修改公开响应时先审查隐私白名单；修改后台写入时保留认证、CSRF 和 revision。
- 新版本同时更新 `package.json`、`CHANGELOG.md`、文档和前端 cache key，并跑完整发布基线。
