const LANGUAGE_KEY = "topomari-language";
const DEFAULT_LANGUAGE = "zh-CN";
const SUPPORTED_LANGUAGES = new Set(["zh-CN", "en"]);

const messages = {
  "zh-CN": {
    "source.connecting": "正在连接",
    "source.live": "Komari 实时数据",
    "source.hybrid": "Komari + 私有探针",
    "source.demo": "动态演示",
    "source.connected": "已连接",
    "source.error": "连接异常",
    "actions.manageRoutes": "管理链路",
    "actions.refresh": "刷新",
    "language.label": "界面语言",
    "theme.switchToLight": "切换至日间模式",
    "theme.switchToDark": "切换至夜间模式",
    "stats.routes": "活动链路",
    "stats.nodes": "在线节点",
    "stats.latency": "平均延迟",
    "stats.loss": "平均丢包",
    "stats.waiting": "等待数据",
    "stats.measuredEdges": "{count} 个监测链路段",
    "stats.allNodesOnline": "所有已配置节点均在线",
    "stats.nodesOffline": "{count} 个节点离线",
    "topology.title": "链路拓扑",
    "topology.awaiting": "等待首个数据快照",
    "topology.aria": "网络概览",
    "manager.title": "链路管理器",
    "manager.close": "关闭",
    "manager.routes": "链路列表",
    "manager.newRoute": "+ 新链路",
    "manager.routeName": "链路名称",
    "manager.routeId": "链路 ID",
    "manager.saved": "已保存",
    "manager.unsaved": "有未保存的更改",
    "manager.delete": "删除链路",
    "manager.save": "保存并应用",
    "manager.routeLibraryAria": "已配置链路",
    "manager.pathAria": "可交互链路路径",
    "deploy.title": "私有探针部署",
    "deploy.help": "目标地址仅用于生成命令，不会保存到面板",
    "deploy.edge": "私有探针链路",
    "deploy.agentId": "探针 Agent ID",
    "deploy.host": "目标主机 / IP",
    "deploy.hostPlaceholder": "例如 203.0.113.10",
    "deploy.port": "目标端口",
    "deploy.interval": "采样间隔（秒）",
    "deploy.timeout": "超时（秒）",
    "deploy.generate": "生成一次性部署命令",
    "deploy.validity": "部署码 15 分钟有效且只能使用一次",
    "deploy.copy": "复制命令",
    "deploy.copied": "已复制",
    "agents.title": "已注册探针",
    "analysis.title": "链路健康",
    "nodes.title": "受监测节点",
    "error.title": "无法载入面板数据",
    "status.healthy": "健康",
    "status.warning": "关注",
    "status.degraded": "异常",
    "status.failed": "失败",
    "status.unconfigured": "未配置",
    "status.unknown": "无数据",
    "common.online": "在线",
    "common.offline": "离线",
    "common.noData": "无数据",
    "common.default": "默认",
    "common.node": "节点 {count}",
    "measurement.privateProbe": "私有探针",
    "measurement.unconfigured": "未配置的链路段",
    "measurement.reverse": "反向估算",
    "node.virtualEndpoint": "虚拟端点",
    "empty.routes": "尚未配置拓扑链路。",
    "empty.links": "暂无链路测量数据。",
    "empty.nodes": "当前链路中没有受监测节点。",
    "empty.snapshot": "暂无可用的面板快照。",
    "empty.linkUnavailable": "链路数据暂不可用。",
    "empty.nodeUnavailable": "节点数据暂不可用。",
    "link.average": "平均 {value}",
    "link.loss": "丢包",
    "updated.at": "更新于 {time}",
    "spark.empty": "暂无延迟趋势",
    "spark.collecting": "正在收集延迟趋势；当前样本 {value}",
    "spark.range": "延迟趋势从 {min} 到 {max}",
    "editor.stage.local": "本地",
    "editor.stage.relay": "中转机",
    "editor.stage.exit": "落地机",
    "editor.stage.internet": "国际网络",
    "editor.threshold.warningLatency": "延迟警告 (ms)",
    "editor.threshold.degradedLatency": "延迟异常 (ms)",
    "editor.threshold.warningLoss": "丢包警告 (%)",
    "editor.threshold.degradedLoss": "丢包异常 (%)",
    "editor.noRoutes": "暂无链路",
    "editor.selectRoute": "请选择或新建一条链路",
    "editor.segments": "{count} 段",
    "editor.editAfterStage": "编辑 {stage} 后的链路",
    "editor.tasks": "{count} 个任务",
    "editor.selectTasks": "待选择任务",
    "editor.currentMissing": "当前配置（Komari 未返回）",
    "editor.thresholdLegend": "该段健康阈值（留空使用全局默认）",
    "editor.komariNode": "Komari 节点",
    "editor.displayName": "显示名称",
    "editor.region": "地区 / 说明",
    "editor.noTasks": "Komari 未返回可用延迟任务。请先在 Komari 创建任务。",
    "editor.taskFallback": "任务 {id}",
    "editor.privateTcp": "私有 TCP 探针",
    "editor.probeEdgeId": "探针链路 ID",
    "editor.sourceAgentId": "部署在来源机上的 Agent ID",
    "editor.agentPlaceholder": "例如 relay-tokyo",
    "editor.agentHelp": "保存后，下方会为这个 Agent 生成一次性部署命令。",
    "editor.komariEstimate": "Komari 延迟任务（反向估算）",
    "editor.taskGroup": "任务组名称",
    "editor.noPrivateEdges": "没有已配置的私有探针链路",
    "editor.noAgents": "尚未注册探针；生成命令并在来源机执行后会出现在这里。",
    "editor.enabled": "已启用",
    "editor.disabled": "已停用",
    "editor.lastReport": "最近上报 {time}",
    "editor.noSamples": "暂无样本",
    "editor.enable": "启用",
    "editor.disable": "停用",
    "editor.refreshFailed": "探针状态刷新失败：{message}",
    "editor.newRoute": "新监控链路",
    "editor.chooseRelay": "选择中转机",
    "editor.chooseExit": "选择落地机",
    "editor.localNetwork": "本地网络",
    "editor.reverseEstimate": "Komari 反向估算",
    "editor.privateRelayExit": "中转 → 落地私有探针",
    "editor.privateExitInternet": "落地 → 国际网络私有探针",
    "editor.savedNotice": "链路拓扑已保存并立即应用。",
    "editor.reloadConflict": "配置已在其他窗口更新。是否丢弃当前改动并重新载入？",
    "editor.deleteConfirm": "确认删除链路“{name}”？保存后才会生效。",
    "editor.rotateConfirm": "这个 Agent 已经存在。继续会轮换旧令牌并使旧探针失效。是否继续？",
    "editor.rotationCancelled": "已取消令牌轮换",
    "editor.saveBeforeDeploy": "请先保存链路，再生成与已保存配置绑定的部署命令。",
    "editor.completeDeployFields": "请完整填写私有探针链路、Agent ID、目标主机和有效端口。",
    "editor.invalidAgentId": "Agent ID 只能包含字母、数字、点、下划线、冒号和连字符。",
    "editor.invalidHost": "目标主机必须是有效的域名、IPv4 或 IPv6 地址。",
    "editor.agentMismatch": "该链路已绑定 Agent {agent}；请在链路编辑器中修改并保存。",
    "editor.issuingCode": "正在签发一次性部署码…",
    "editor.codeExpires": "部署码将在 {time} 过期，成功执行一次后立即失效。",
    "editor.httpWarning": "当前为 HTTP，仅适合临时测试；部署码将在 {time} 过期。",
    "editor.disableConfirm": "停用 Agent {agent}？它将无法继续提交样本。",
    "editor.agentChanged": "Agent {agent} 已{state}。",
    "editor.clipboardDenied": "浏览器拒绝访问剪贴板，请手动复制命令。",
  },
  en: {
    "source.connecting": "Connecting",
    "source.live": "Komari Live",
    "source.hybrid": "Komari + Private Probes",
    "source.demo": "Animated Demo",
    "source.connected": "Connected",
    "source.error": "Connection Error",
    "actions.manageRoutes": "Manage routes",
    "actions.refresh": "Refresh",
    "language.label": "Interface language",
    "theme.switchToLight": "Switch to light mode",
    "theme.switchToDark": "Switch to dark mode",
    "stats.routes": "Active routes",
    "stats.nodes": "Nodes online",
    "stats.latency": "Mean latency",
    "stats.loss": "Mean packet loss",
    "stats.waiting": "Waiting for data",
    "stats.measuredEdges": "{count} measured edges",
    "stats.allNodesOnline": "All configured nodes online",
    "stats.nodesOffline": "{count} node(s) offline",
    "topology.title": "Routing topology",
    "topology.awaiting": "Awaiting first snapshot",
    "topology.aria": "Network overview",
    "manager.title": "Route manager",
    "manager.close": "Close",
    "manager.routes": "Route list",
    "manager.newRoute": "+ New route",
    "manager.routeName": "Route name",
    "manager.routeId": "Route ID",
    "manager.saved": "Saved",
    "manager.unsaved": "Unsaved changes",
    "manager.delete": "Delete route",
    "manager.save": "Save and apply",
    "manager.routeLibraryAria": "Configured routes",
    "manager.pathAria": "Interactive route path",
    "deploy.title": "Private probe deployment",
    "deploy.help": "Target addresses are used only to generate the command and are not saved by the dashboard",
    "deploy.edge": "Private probe edge",
    "deploy.agentId": "Probe Agent ID",
    "deploy.host": "Target host / IP",
    "deploy.hostPlaceholder": "For example, 203.0.113.10",
    "deploy.port": "Target port",
    "deploy.interval": "Interval (seconds)",
    "deploy.timeout": "Timeout (seconds)",
    "deploy.generate": "Generate one-time command",
    "deploy.validity": "Enrollment codes expire in 15 minutes and can be used once",
    "deploy.copy": "Copy command",
    "deploy.copied": "Copied",
    "agents.title": "Registered probes",
    "analysis.title": "Link health",
    "nodes.title": "Monitored nodes",
    "error.title": "Unable to load dashboard data",
    "status.healthy": "Healthy",
    "status.warning": "Watch",
    "status.degraded": "Degraded",
    "status.failed": "Failed",
    "status.unconfigured": "No task",
    "status.unknown": "No data",
    "common.online": "Online",
    "common.offline": "Offline",
    "common.noData": "No data",
    "common.default": "Default",
    "common.node": "Node {count}",
    "measurement.privateProbe": "Private probe",
    "measurement.unconfigured": "Unconfigured edge",
    "measurement.reverse": "Reverse estimate",
    "node.virtualEndpoint": "Virtual endpoint",
    "empty.routes": "No topology routes are configured.",
    "empty.links": "No link measurements are available.",
    "empty.nodes": "No monitored nodes are present in the configured routes.",
    "empty.snapshot": "No dashboard snapshot is available.",
    "empty.linkUnavailable": "Link data is unavailable.",
    "empty.nodeUnavailable": "Node data is unavailable.",
    "link.average": "avg {value}",
    "link.loss": "loss",
    "updated.at": "Updated {time}",
    "spark.empty": "No latency trend available",
    "spark.collecting": "Collecting latency trend; one sample at {value}",
    "spark.range": "Latency trend from {min} to {max}",
    "editor.stage.local": "Local",
    "editor.stage.relay": "Relay",
    "editor.stage.exit": "Exit",
    "editor.stage.internet": "Internet",
    "editor.threshold.warningLatency": "Latency warning (ms)",
    "editor.threshold.degradedLatency": "Latency degraded (ms)",
    "editor.threshold.warningLoss": "Loss warning (%)",
    "editor.threshold.degradedLoss": "Loss degraded (%)",
    "editor.noRoutes": "No routes",
    "editor.selectRoute": "Select or create a route",
    "editor.segments": "{count} segments",
    "editor.editAfterStage": "Edit the edge after {stage}",
    "editor.tasks": "{count} tasks",
    "editor.selectTasks": "Select tasks",
    "editor.currentMissing": "Current config (not returned by Komari)",
    "editor.thresholdLegend": "Edge health thresholds (leave blank for global defaults)",
    "editor.komariNode": "Komari node",
    "editor.displayName": "Display name",
    "editor.region": "Region / note",
    "editor.noTasks": "Komari returned no latency tasks. Create a task in Komari first.",
    "editor.taskFallback": "Task {id}",
    "editor.privateTcp": "Private TCP probe",
    "editor.probeEdgeId": "Probe edge ID",
    "editor.sourceAgentId": "Agent ID deployed on the source host",
    "editor.agentPlaceholder": "For example, relay-tokyo",
    "editor.agentHelp": "After saving, a one-time deployment command can be generated below.",
    "editor.komariEstimate": "Komari latency tasks (reverse estimate)",
    "editor.taskGroup": "Task group name",
    "editor.noPrivateEdges": "No private probe edges are configured",
    "editor.noAgents": "No probes are registered. They appear here after the generated command runs on a source host.",
    "editor.enabled": "Enabled",
    "editor.disabled": "Disabled",
    "editor.lastReport": "Last report {time}",
    "editor.noSamples": "No samples",
    "editor.enable": "Enable",
    "editor.disable": "Disable",
    "editor.refreshFailed": "Probe status refresh failed: {message}",
    "editor.newRoute": "New monitored route",
    "editor.chooseRelay": "Choose relay",
    "editor.chooseExit": "Choose exit",
    "editor.localNetwork": "Local network",
    "editor.reverseEstimate": "Komari reverse estimate",
    "editor.privateRelayExit": "Relay → exit private probe",
    "editor.privateExitInternet": "Exit → internet private probe",
    "editor.savedNotice": "Topology saved and applied immediately.",
    "editor.reloadConflict": "The config changed in another window. Discard local changes and reload?",
    "editor.deleteConfirm": "Delete route “{name}”? The change takes effect after saving.",
    "editor.rotateConfirm": "This Agent already exists. Continuing rotates its token and invalidates the old probe. Continue?",
    "editor.rotationCancelled": "Token rotation cancelled",
    "editor.saveBeforeDeploy": "Save the route before generating a deployment command bound to the saved config.",
    "editor.completeDeployFields": "Complete the private edge, Agent ID, target host, and valid port fields.",
    "editor.invalidAgentId": "Agent IDs may contain letters, numbers, dots, underscores, colons, and hyphens only.",
    "editor.invalidHost": "The target must be a valid hostname, IPv4 address, or IPv6 address.",
    "editor.agentMismatch": "This edge is bound to Agent {agent}; update and save it in the route editor.",
    "editor.issuingCode": "Issuing a one-time enrollment code…",
    "editor.codeExpires": "The code expires at {time} and becomes invalid after one successful use.",
    "editor.httpWarning": "HTTP is suitable for temporary testing only; the code expires at {time}.",
    "editor.disableConfirm": "Disable Agent {agent}? It will no longer be able to submit samples.",
    "editor.agentChanged": "Agent {agent} is now {state}.",
    "editor.clipboardDenied": "Clipboard access was denied. Copy the command manually.",
  },
};

function readStoredLanguage() {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_KEY);
      if (SUPPORTED_LANGUAGES.has(stored)) return stored;
    } catch {
      // Storage can be unavailable in privacy modes.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
}

let activeLanguage = readStoredLanguage();

function interpolate(template, variables) {
  return template.replace(/\{(\w+)\}/g, (match, key) => String(variables[key] ?? match));
}

export function t(key, variables = {}) {
  const template = messages[activeLanguage]?.[key] ?? messages.en[key] ?? key;
  return interpolate(template, variables);
}

export function getLanguage() {
  return activeLanguage;
}

export function getLocale() {
  return activeLanguage === "zh-CN" ? "zh-CN" : "en-US";
}

export function applyTranslations(root = typeof document !== "undefined" ? document : null) {
  if (!root) return;
  if (root.documentElement) root.documentElement.lang = activeLanguage;
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });
}

export function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.has(language) || language === activeLanguage) return;
  activeLanguage = language;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The preference still applies for the current page.
    }
  }
  applyTranslations();
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("topomari:languagechange", { detail: { language } }));
  }
}

export function initI18n() {
  applyTranslations();
  return activeLanguage;
}
