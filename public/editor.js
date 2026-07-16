const elements = {
  toggle: document.getElementById("manager-toggle"),
  panel: document.getElementById("topology-manager"),
  close: document.getElementById("manager-close"),
  notice: document.getElementById("manager-notice"),
  routeList: document.getElementById("route-list"),
  routeNew: document.getElementById("route-new"),
  routeName: document.getElementById("route-name-input"),
  routeId: document.getElementById("route-id-input"),
  path: document.getElementById("route-path-builder"),
  selection: document.getElementById("route-selection-editor"),
  dirty: document.getElementById("route-dirty-state"),
  routeDelete: document.getElementById("route-delete"),
  routeSave: document.getElementById("route-save"),
  deployEdge: document.getElementById("deploy-edge"),
  deployAgent: document.getElementById("deploy-agent"),
  deployHost: document.getElementById("deploy-host"),
  deployPort: document.getElementById("deploy-port"),
  deployInterval: document.getElementById("deploy-interval"),
  deployTimeout: document.getElementById("deploy-timeout"),
  deployGenerate: document.getElementById("deploy-generate"),
  deployStatus: document.getElementById("deploy-status"),
  commandBox: document.getElementById("deploy-command-box"),
  command: document.getElementById("deploy-command"),
  copy: document.getElementById("deploy-copy"),
  agentList: document.getElementById("agent-list"),
};

const stageNames = ["本地", "中转机", "落地机", "国际网络"];
const thresholdLabels = {
  warning_latency_ms: "延迟警告 (ms)",
  degraded_latency_ms: "延迟异常 (ms)",
  warning_loss_percent: "丢包警告 (%)",
  degraded_loss_percent: "丢包异常 (%)",
};

let bootstrap = null;
let draft = null;
let revision = "";
let csrfToken = "";
let selectedRouteIndex = 0;
let selectedKind = "node";
let selectedIndex = 0;
let isDirty = false;
let onSavedCallback = () => {};
let lastDeployEdge = "";
let noticeTimer = null;
let probeStatusTimer = null;
let probeStatusLoading = false;

const probeStatusRefreshMs = 10_000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slug(value, fallback = "route") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return normalized || fallback;
}

function showNotice(message, tone = "success") {
  clearTimeout(noticeTimer);
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = false;
  noticeTimer = setTimeout(() => {
    elements.notice.hidden = true;
  }, tone === "error" ? 9000 : 5000);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-Topology-CSRF"] = csrfToken;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function currentRoute() {
  return draft?.routes?.[selectedRouteIndex] || null;
}

function markDirty() {
  isDirty = true;
  elements.dirty.textContent = "有未保存的更改";
  elements.dirty.dataset.dirty = "true";
}

function markSaved() {
  isDirty = false;
  elements.dirty.textContent = "已保存";
  elements.dirty.dataset.dirty = "false";
}

function inventoryNode(id) {
  return (bootstrap?.nodes || []).find((node) => node.id === id);
}

function syncRoute(route) {
  route.edges.forEach((edge, index) => {
    edge.from = route.nodes[index].id;
    edge.to = route.nodes[index + 1].id;
    edge.source_uuid = index === 0 && route.nodes[index + 1]
      ? route.nodes[index + 1].id
      : route.nodes[index].id;
    if (index === 0 && !edge.probe_id) edge.measurement_direction = "reverse";
  });
}

function routeNodeLabel(node) {
  return node.label || inventoryNode(node.id)?.name || node.id;
}

function edgeLabel(edge) {
  if (edge.probe_id) return ["私有探针", edge.probe_name || edge.probe_id];
  const taskCount = Array.isArray(edge.task_ids) ? edge.task_ids.length : edge.task_id !== undefined ? 1 : 0;
  return ["Komari", taskCount ? `${taskCount} 个任务` : "待选择任务"];
}

function renderRouteList() {
  if (!draft?.routes?.length) {
    elements.routeList.innerHTML = '<div class="manager-empty">暂无链路</div>';
    return;
  }
  elements.routeList.innerHTML = draft.routes
    .map((route, index) => `
      <button class="route-list-item ${index === selectedRouteIndex ? "is-active" : ""}" type="button" data-route-index="${index}">
        <strong>${escapeHtml(route.name || route.id)}</strong>
        <span>${escapeHtml(route.id)} · ${route.edges.length} 段</span>
      </button>`)
    .join("");
}

function renderPath() {
  const route = currentRoute();
  if (!route) {
    elements.path.innerHTML = '<div class="manager-empty">请选择或新建一条链路</div>';
    return;
  }
  const parts = [];
  route.nodes.forEach((node, index) => {
    const stage = stageNames[index] || `节点 ${index + 1}`;
    parts.push(`
      <button type="button" class="builder-node ${selectedKind === "node" && selectedIndex === index ? "is-selected" : ""}" data-select-kind="node" data-select-index="${index}">
        <span>${escapeHtml(stage)}</span>
        <strong>${escapeHtml(routeNodeLabel(node))}</strong>
      </button>`);
    if (route.edges[index]) {
      const [type, detail] = edgeLabel(route.edges[index]);
      parts.push(`
        <button type="button" class="builder-edge ${selectedKind === "edge" && selectedIndex === index ? "is-selected" : ""}" data-select-kind="edge" data-select-index="${index}" aria-label="编辑 ${escapeHtml(stage)} 后的链路">
          <span>${escapeHtml(type)}</span>
          <small>${escapeHtml(detail)}</small>
        </button>`);
    }
  });
  elements.path.innerHTML = parts.join("");
}

function nodeOptions(currentId) {
  const nodes = [...(bootstrap?.nodes || [])];
  if (currentId && !nodes.some((node) => node.id === currentId)) {
    nodes.unshift({ id: currentId, name: currentId, region: "当前配置（Komari 未返回）", online: false });
  }
  return nodes
    .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === currentId ? "selected" : ""}>${escapeHtml(node.name)}${node.region ? ` · ${escapeHtml(node.region)}` : ""}${node.online === false ? " · 离线" : ""}</option>`)
    .join("");
}

function thresholdFields(edge) {
  const thresholds = edge.health_thresholds || {};
  return `
    <fieldset class="threshold-fieldset">
      <legend>该段健康阈值（留空使用全局默认）</legend>
      <div class="threshold-grid">
        ${Object.entries(thresholdLabels).map(([key, label]) => `
          <label>
            <span>${escapeHtml(label)}</span>
            <input type="number" min="0" step="0.1" data-threshold-key="${key}" value="${escapeHtml(thresholds[key] ?? "")}" placeholder="默认" />
          </label>`).join("")}
      </div>
    </fieldset>`;
}

function renderNodeEditor(route, index) {
  const node = route.nodes[index];
  const selectable = index > 0 && index < route.nodes.length - 1;
  return `
    <div class="selection-title">
      <div>
        <span>${escapeHtml(stageNames[index] || `节点 ${index + 1}`)}</span>
        <strong>${escapeHtml(routeNodeLabel(node))}</strong>
      </div>
      <code>${escapeHtml(node.id)}</code>
    </div>
    <div class="editor-fields">
      ${selectable ? `
        <label class="field-wide">
          <span>Komari 节点</span>
          <select data-node-select>${nodeOptions(node.id)}</select>
        </label>` : ""}
      <label>
        <span>显示名称</span>
        <input type="text" maxlength="160" data-node-field="label" value="${escapeHtml(node.label || "")}" />
      </label>
      <label>
        <span>地区 / 说明</span>
        <input type="text" maxlength="160" data-node-field="region" value="${escapeHtml(node.region || "")}" />
      </label>
    </div>`;
}

function renderTaskChoices(edge) {
  const selected = new Set(
    Array.isArray(edge.task_ids)
      ? edge.task_ids.map(Number)
      : edge.task_id !== undefined
        ? [Number(edge.task_id)]
        : [],
  );
  const tasks = bootstrap?.tasks || [];
  if (!tasks.length) return '<p class="manager-empty">Komari 未返回可用延迟任务。请先在 Komari 创建任务。</p>';
  return `<div class="task-choice-grid">${tasks.map((task) => `
    <label class="task-choice">
      <input type="checkbox" data-task-id="${Number(task.id)}" ${selected.has(Number(task.id)) ? "checked" : ""} />
      <span><strong>${escapeHtml(task.name || `Task ${task.id}`)}</strong><small>#${escapeHtml(task.id)}${task.type ? ` · ${escapeHtml(task.type)}` : ""}</small></span>
    </label>`).join("")}</div>`;
}

function renderEdgeEditor(route, index) {
  const edge = route.edges[index];
  const from = routeNodeLabel(route.nodes[index]);
  const to = routeNodeLabel(route.nodes[index + 1]);
  if (edge.probe_id) {
    return `
      <div class="selection-title">
        <div><span>私有 TCP 探针</span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong></div>
        <code>${escapeHtml(edge.probe_id)}</code>
      </div>
      <div class="editor-fields">
        <label>
          <span>探针链路 ID</span>
          <input type="text" maxlength="128" spellcheck="false" data-edge-field="probe_id" value="${escapeHtml(edge.probe_id)}" />
        </label>
        <label>
          <span>显示名称</span>
          <input type="text" maxlength="160" data-edge-field="probe_name" value="${escapeHtml(edge.probe_name || "Private TCP probe")}" />
        </label>
        <label class="field-wide">
          <span>部署在来源机上的 Agent ID</span>
          <input type="text" maxlength="128" spellcheck="false" data-edge-field="agent_id" value="${escapeHtml(edge.agent_id || "")}" placeholder="例如 relay-tokyo" />
          <small>保存后，下方会为这个 Agent 生成一次性部署命令。</small>
        </label>
      </div>
      ${thresholdFields(edge)}`;
  }
  return `
    <div class="selection-title">
      <div><span>Komari 延迟任务（反向估算）</span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong></div>
      <code>${escapeHtml(edge.source_uuid || edge.to)}</code>
    </div>
    <label class="field-wide standalone-field">
      <span>任务组名称</span>
      <input type="text" maxlength="160" data-edge-field="task_group_name" value="${escapeHtml(edge.task_group_name || "本地网络 · Komari 探测")}" />
    </label>
    ${renderTaskChoices(edge)}
    ${thresholdFields(edge)}`;
}

function renderSelectionEditor() {
  const route = currentRoute();
  if (!route) {
    elements.selection.innerHTML = "";
    return;
  }
  const maximum = selectedKind === "node" ? route.nodes.length - 1 : route.edges.length - 1;
  selectedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, maximum));
  elements.selection.innerHTML = selectedKind === "node"
    ? renderNodeEditor(route, selectedIndex)
    : renderEdgeEditor(route, selectedIndex);
}

function privateEdges() {
  return (draft?.routes || []).flatMap((route, routeIndex) =>
    route.edges.flatMap((edge, edgeIndex) => edge.probe_id ? [{ route, routeIndex, edge, edgeIndex }] : []),
  );
}

function defaultAgentFor(item) {
  const sourceNode = item.route.nodes[item.edgeIndex];
  return item.edge.agent_id || slug(sourceNode.label || sourceNode.id, `agent-${item.edgeIndex + 1}`);
}

function renderDeploymentOptions() {
  const options = privateEdges();
  const previous = elements.deployEdge.value;
  elements.deployEdge.innerHTML = options.length
    ? options.map((item) => `<option value="${escapeHtml(item.edge.probe_id)}">${escapeHtml(item.route.name)} · ${escapeHtml(routeNodeLabel(item.route.nodes[item.edgeIndex]))} → ${escapeHtml(routeNodeLabel(item.route.nodes[item.edgeIndex + 1]))}</option>`).join("")
    : '<option value="">没有已配置的私有探针链路</option>';
  if (options.some((item) => item.edge.probe_id === previous)) elements.deployEdge.value = previous;
  elements.deployGenerate.disabled = !options.length;
  const selected = options.find((item) => item.edge.probe_id === elements.deployEdge.value);
  if (selected && lastDeployEdge !== selected.edge.probe_id) {
    elements.deployAgent.value = defaultAgentFor(selected);
    lastDeployEdge = selected.edge.probe_id;
  }
}

function renderAgents() {
  const agents = bootstrap?.agents || [];
  const overview = new Map((bootstrap?.probeEdges || []).map((edge) => [edge.edgeId, edge]));
  if (!agents.length) {
    elements.agentList.innerHTML = '<div class="manager-empty">尚未注册探针；生成命令并在来源机执行后会出现在这里。</div>';
    return;
  }
  elements.agentList.innerHTML = agents.map((agent) => {
    const latest = agent.allowedEdges
      .map((edgeId) => overview.get(edgeId)?.lastSeen)
      .filter(Boolean)
      .sort()
      .at(-1);
    return `
      <div class="agent-row">
        <div>
          <strong>${escapeHtml(agent.id)}</strong>
          <span>${escapeHtml(agent.allowedEdges.join(", "))}</span>
        </div>
        <div class="agent-meta">
          <span class="agent-state ${agent.enabled ? "is-enabled" : ""}">${agent.enabled ? "已启用" : "已停用"}</span>
          <small>${latest ? `最近上报 ${escapeHtml(new Date(latest).toLocaleString())}` : "暂无样本"}</small>
        </div>
        <button type="button" class="manager-button ${agent.enabled ? "danger" : ""}" data-agent-id="${escapeHtml(agent.id)}" data-agent-enabled="${agent.enabled ? "true" : "false"}">${agent.enabled ? "停用" : "启用"}</button>
      </div>`;
  }).join("");
}

async function refreshProbeStatus({ showErrors = false } = {}) {
  if (!bootstrap || probeStatusLoading) return;
  probeStatusLoading = true;
  try {
    const payload = await api(`/api/probes?t=${Date.now()}`);
    bootstrap.agents = Array.isArray(payload.agents) ? payload.agents : [];
    bootstrap.probeEdges = Array.isArray(payload.edges) ? payload.edges : [];
    renderAgents();
  } catch (error) {
    if (showErrors) showNotice(`探针状态刷新失败：${error.message}`, "error");
  } finally {
    probeStatusLoading = false;
  }
}

function renderEditor() {
  const route = currentRoute();
  renderRouteList();
  if (!route) return;
  elements.routeName.value = route.name || "";
  elements.routeId.value = route.id || "";
  elements.routeDelete.disabled = draft.routes.length <= 1;
  renderPath();
  renderSelectionEditor();
  renderDeploymentOptions();
  renderAgents();
}

function addRoute() {
  const suffix = Date.now().toString(36);
  const candidates = bootstrap?.nodes || [];
  const relay = candidates[0] || { id: `relay-${suffix}`, name: "选择中转机", region: "" };
  const exit = candidates.find((node) => node.id !== relay.id) || { id: `exit-${suffix}`, name: "选择落地机", region: "" };
  const id = `route-${suffix}`;
  const taskIds = (bootstrap?.tasks || []).slice(0, 5).map((task) => Number(task.id));
  const route = {
    id,
    name: "新监控链路",
    nodes: [
      { id: "client", label: "本地网络", type: "client", region: "Komari 反向估算" },
      { id: relay.id, label: relay.name, type: "server", region: relay.region || "" },
      { id: exit.id, label: exit.name, type: "server", region: exit.region || "" },
      { id: "internet", label: "国际网络", type: "target", region: "" },
    ],
    edges: [
      {
        from: "client",
        to: relay.id,
        source_uuid: relay.id,
        task_ids: taskIds,
        task_group_name: "本地网络 · Komari 探测",
        measurement_direction: "reverse",
      },
      {
        from: relay.id,
        to: exit.id,
        source_uuid: relay.id,
        probe_id: `${id}-relay-exit`,
        probe_name: "中转 → 落地私有探针",
        agent_id: `relay-${suffix}`,
      },
      {
        from: exit.id,
        to: "internet",
        source_uuid: exit.id,
        probe_id: `${id}-exit-internet`,
        probe_name: "落地 → 国际网络私有探针",
        agent_id: `exit-${suffix}`,
      },
    ],
  };
  draft.routes.push(route);
  selectedRouteIndex = draft.routes.length - 1;
  selectedKind = "node";
  selectedIndex = 1;
  markDirty();
  renderEditor();
}

async function saveTopology() {
  draft.routes.forEach(syncRoute);
  elements.routeSave.disabled = true;
  try {
    const result = await api("/api/editor/topology", {
      method: "PUT",
      body: { config: draft, revision },
    });
    draft = clone(result.config);
    revision = result.revision;
    selectedRouteIndex = Math.min(selectedRouteIndex, draft.routes.length - 1);
    markSaved();
    renderEditor();
    showNotice("链路拓扑已保存并立即应用。", "success");
    await Promise.resolve(onSavedCallback());
  } catch (error) {
    showNotice(error.message, "error");
    if (error.status === 409 && window.confirm("配置已在其他窗口更新。是否丢弃当前改动并重新载入？")) {
      await loadBootstrap();
    }
  } finally {
    elements.routeSave.disabled = false;
  }
}

function deleteRoute() {
  const route = currentRoute();
  if (!route || draft.routes.length <= 1) return;
  if (!window.confirm(`确认删除链路“${route.name}”？保存后才会生效。`)) return;
  draft.routes.splice(selectedRouteIndex, 1);
  selectedRouteIndex = Math.min(selectedRouteIndex, draft.routes.length - 1);
  selectedKind = "node";
  selectedIndex = 0;
  markDirty();
  renderEditor();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function selectedPrivateEdge() {
  return privateEdges().find((item) => item.edge.probe_id === elements.deployEdge.value);
}

async function requestEnrollment(body) {
  try {
    return await api("/api/editor/enrollments", { method: "POST", body });
  } catch (error) {
    if (error.status !== 409) throw error;
    const confirmed = window.confirm("这个 Agent 已经存在。继续会在部署命令执行时轮换旧令牌，旧探针随后失效。是否继续？");
    if (!confirmed) throw new Error("已取消令牌轮换");
    return await api("/api/editor/enrollments", {
      method: "POST",
      body: { ...body, rotateExisting: true },
    });
  }
}

async function generateDeploymentCommand() {
  if (isDirty) {
    showNotice("请先保存链路，再生成与已保存配置绑定的部署命令。", "error");
    return;
  }
  const item = selectedPrivateEdge();
  const agentId = elements.deployAgent.value.trim();
  const targetHost = elements.deployHost.value.trim();
  const targetPort = Number(elements.deployPort.value);
  const interval = Number(elements.deployInterval.value);
  const timeout = Number(elements.deployTimeout.value);
  if (!item || !agentId || !targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    showNotice("请完整填写私有探针链路、Agent ID、目标主机和有效端口。", "error");
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(agentId)) {
    showNotice("Agent ID 只能包含字母、数字、点、下划线、冒号和连字符。", "error");
    return;
  }
  if (!/^[a-zA-Z0-9_.:[\]-]+$/.test(targetHost)) {
    showNotice("目标主机必须是有效的域名、IPv4 或 IPv6 地址。", "error");
    return;
  }
  if (item.edge.agent_id && item.edge.agent_id !== agentId) {
    showNotice(`该链路已绑定 Agent ${item.edge.agent_id}；请在链路编辑器中修改并保存。`, "error");
    return;
  }
  elements.deployGenerate.disabled = true;
  elements.deployStatus.textContent = "正在签发一次性部署码…";
  try {
    const enrollment = await requestEnrollment({
      agentId,
      edgeId: item.edge.probe_id,
      rotateExisting: false,
    });
    const origin = window.location.origin.replace(/\/$/, "");
    const args = [
      "--server-url", origin,
      "--enrollment-code", enrollment.code,
      "--target-host", targetHost,
      "--target-port", String(targetPort),
      "--interval", String(Math.min(3600, Math.max(5, interval || 30))),
      "--timeout", String(Math.min(60, Math.max(1, timeout || 5))),
    ];
    if (origin.startsWith("http://")) args.push("--allow-http");
    const command = `curl -fsSL ${shellQuote(`${origin}/agent/install.sh`)} | sudo bash -s -- ${args.map(shellQuote).join(" ")}`;
    elements.command.textContent = command;
    elements.commandBox.hidden = false;
    const expires = new Date(enrollment.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    elements.deployStatus.textContent = origin.startsWith("https://")
      ? `部署码将在 ${expires} 过期，成功执行一次后立即失效。`
      : `当前为 HTTP，仅适合临时测试；部署码将在 ${expires} 过期。`;
  } catch (error) {
    elements.deployStatus.textContent = error.message;
    showNotice(error.message, "error");
  } finally {
    elements.deployGenerate.disabled = !privateEdges().length;
  }
}

async function toggleAgent(button) {
  const agentId = button.dataset.agentId;
  const currentlyEnabled = button.dataset.agentEnabled === "true";
  if (currentlyEnabled && !window.confirm(`停用 Agent ${agentId}？它将无法继续提交样本。`)) return;
  button.disabled = true;
  try {
    const result = await api("/api/editor/agents/action", {
      method: "POST",
      body: { agentId, enabled: !currentlyEnabled },
    });
    const index = bootstrap.agents.findIndex((agent) => agent.id === agentId);
    if (index >= 0) bootstrap.agents[index] = result.agent;
    renderAgents();
    showNotice(`Agent ${agentId} 已${result.agent.enabled ? "启用" : "停用"}。`, "success");
  } catch (error) {
    showNotice(error.message, "error");
    button.disabled = false;
  }
}

function handleSelectionInput(event) {
  const route = currentRoute();
  if (!route) return;
  if (event.target.dataset.nodeField) {
    route.nodes[selectedIndex][event.target.dataset.nodeField] = event.target.value;
    markDirty();
    if (event.target.dataset.nodeField === "label") {
      renderPath();
      renderRouteList();
    }
  }
  if (event.target.dataset.edgeField) {
    const edge = route.edges[selectedIndex];
    const key = event.target.dataset.edgeField;
    if (event.target.value.trim()) edge[key] = event.target.value.trim();
    else delete edge[key];
    markDirty();
    renderPath();
    renderDeploymentOptions();
  }
  if (event.target.dataset.thresholdKey) {
    const edge = route.edges[selectedIndex];
    edge.health_thresholds ||= {};
    const key = event.target.dataset.thresholdKey;
    if (event.target.value === "") delete edge.health_thresholds[key];
    else edge.health_thresholds[key] = Number(event.target.value);
    if (!Object.keys(edge.health_thresholds).length) delete edge.health_thresholds;
    markDirty();
  }
}

function handleSelectionChange(event) {
  const route = currentRoute();
  if (!route) return;
  if (event.target.matches("[data-node-select]")) {
    const node = inventoryNode(event.target.value);
    const current = route.nodes[selectedIndex];
    current.id = event.target.value;
    if (node) {
      current.label = node.name;
      current.region = node.region || "";
    }
    syncRoute(route);
    const privateEdge = route.edges[selectedIndex] || route.edges[selectedIndex - 1];
    if (privateEdge?.probe_id && !privateEdge.agent_id) {
      privateEdge.agent_id = slug(current.label || current.id, `agent-${selectedIndex}`);
    }
    markDirty();
    renderEditor();
    return;
  }
  if (event.target.matches("[data-task-id]")) {
    const edge = route.edges[selectedIndex];
    edge.task_ids = [...elements.selection.querySelectorAll("[data-task-id]:checked")].map((input) => Number(input.dataset.taskId));
    delete edge.task_id;
    delete edge.task_name;
    edge.measurement_direction = "reverse";
    markDirty();
    renderPath();
  }
}

function bindEvents() {
  elements.toggle.addEventListener("click", () => {
    elements.panel.hidden = !elements.panel.hidden;
    elements.toggle.setAttribute("aria-expanded", String(!elements.panel.hidden));
    if (!elements.panel.hidden) {
      refreshProbeStatus({ showErrors: true });
      elements.panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  elements.close.addEventListener("click", () => {
    elements.panel.hidden = true;
    elements.toggle.setAttribute("aria-expanded", "false");
    elements.toggle.focus();
  });
  elements.routeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route-index]");
    if (!button) return;
    selectedRouteIndex = Number(button.dataset.routeIndex);
    selectedKind = "node";
    selectedIndex = 0;
    renderEditor();
  });
  elements.routeNew.addEventListener("click", addRoute);
  elements.routeName.addEventListener("input", () => {
    currentRoute().name = elements.routeName.value;
    markDirty();
    renderRouteList();
  });
  elements.routeId.addEventListener("input", () => {
    currentRoute().id = elements.routeId.value.trim();
    markDirty();
    renderRouteList();
  });
  elements.path.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-kind]");
    if (!button) return;
    selectedKind = button.dataset.selectKind;
    selectedIndex = Number(button.dataset.selectIndex);
    renderPath();
    renderSelectionEditor();
  });
  elements.selection.addEventListener("input", handleSelectionInput);
  elements.selection.addEventListener("change", handleSelectionChange);
  elements.routeSave.addEventListener("click", saveTopology);
  elements.routeDelete.addEventListener("click", deleteRoute);
  elements.deployEdge.addEventListener("change", () => {
    lastDeployEdge = "";
    renderDeploymentOptions();
    elements.commandBox.hidden = true;
  });
  elements.deployGenerate.addEventListener("click", generateDeploymentCommand);
  elements.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements.command.textContent);
      elements.copy.textContent = "已复制";
      setTimeout(() => { elements.copy.textContent = "复制命令"; }, 1800);
    } catch {
      showNotice("浏览器拒绝访问剪贴板，请手动复制命令。", "error");
    }
  });
  elements.agentList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-agent-id]");
    if (button) toggleAgent(button);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  probeStatusTimer = window.setInterval(() => {
    if (!elements.panel.hidden && document.visibilityState === "visible") refreshProbeStatus();
  }, probeStatusRefreshMs);
  window.addEventListener("pagehide", () => window.clearInterval(probeStatusTimer), { once: true });
}

async function loadBootstrap() {
  const payload = await api(`/api/editor/bootstrap?t=${Date.now()}`);
  bootstrap = payload;
  draft = clone(payload.config);
  revision = payload.revision;
  csrfToken = payload.csrfToken;
  selectedRouteIndex = Math.min(selectedRouteIndex, draft.routes.length - 1);
  selectedKind = "node";
  selectedIndex = 0;
  lastDeployEdge = "";
  markSaved();
  renderEditor();
}

export async function initTopologyEditor({ onSaved = () => {} } = {}) {
  if (!elements.toggle || !elements.panel) return;
  onSavedCallback = onSaved;
  try {
    await loadBootstrap();
    bindEvents();
    elements.toggle.hidden = false;
  } catch (error) {
    if (error.status !== 404) console.warn(`Topology editor unavailable: ${error.message}`);
  }
}
