import { editorApi } from "./frontend/api-client.js";
import { getLocale, t } from "./frontend/i18n.js";

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

const stageKeys = ["editor.stage.local", "editor.stage.relay", "editor.stage.exit", "editor.stage.internet"];
const thresholdLabels = {
  warning_latency_ms: "editor.threshold.warningLatency",
  degraded_latency_ms: "editor.threshold.degradedLatency",
  warning_loss_percent: "editor.threshold.warningLoss",
  degraded_loss_percent: "editor.threshold.degradedLoss",
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
let deploymentStatus = { key: "deploy.validity", variables: {} };

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

function renderDeploymentStatus() {
  elements.deployStatus.textContent = deploymentStatus.text
    ?? t(deploymentStatus.key, deploymentStatus.variables);
}

function setDeploymentStatus(key, variables = {}) {
  deploymentStatus = { key, variables };
  renderDeploymentStatus();
}

function setDeploymentStatusText(text) {
  deploymentStatus = { text };
  renderDeploymentStatus();
}

function stageName(index) {
  return stageKeys[index] ? t(stageKeys[index]) : t("common.node", { count: index + 1 });
}

function currentRoute() {
  return draft?.routes?.[selectedRouteIndex] || null;
}

function markDirty() {
  isDirty = true;
  elements.dirty.textContent = t("manager.unsaved");
  elements.dirty.dataset.dirty = "true";
}

function markSaved() {
  isDirty = false;
  elements.dirty.textContent = t("manager.saved");
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
  if (edge.probe_id) return [t("measurement.privateProbe"), edge.probe_name || edge.probe_id];
  const taskCount = Array.isArray(edge.task_ids) ? edge.task_ids.length : edge.task_id !== undefined ? 1 : 0;
  return ["Komari", taskCount ? t("editor.tasks", { count: taskCount }) : t("editor.selectTasks")];
}

function renderRouteList() {
  if (!draft?.routes?.length) {
    elements.routeList.innerHTML = `<div class="manager-empty">${escapeHtml(t("editor.noRoutes"))}</div>`;
    return;
  }
  elements.routeList.innerHTML = draft.routes
    .map((route, index) => `
      <button class="route-list-item ${index === selectedRouteIndex ? "is-active" : ""}" type="button" data-route-index="${index}">
        <strong>${escapeHtml(route.name || route.id)}</strong>
        <span>${escapeHtml(route.id)} · ${escapeHtml(t("editor.segments", { count: route.edges.length }))}</span>
      </button>`)
    .join("");
}

function renderPath() {
  const route = currentRoute();
  if (!route) {
    elements.path.innerHTML = `<div class="manager-empty">${escapeHtml(t("editor.selectRoute"))}</div>`;
    return;
  }
  const parts = [];
  route.nodes.forEach((node, index) => {
    const stage = stageName(index);
    parts.push(`
      <button type="button" class="builder-node ${selectedKind === "node" && selectedIndex === index ? "is-selected" : ""}" data-select-kind="node" data-select-index="${index}">
        <span>${escapeHtml(stage)}</span>
        <strong>${escapeHtml(routeNodeLabel(node))}</strong>
      </button>`);
    if (route.edges[index]) {
      const [type, detail] = edgeLabel(route.edges[index]);
      parts.push(`
        <button type="button" class="builder-edge ${selectedKind === "edge" && selectedIndex === index ? "is-selected" : ""}" data-select-kind="edge" data-select-index="${index}" aria-label="${escapeHtml(t("editor.editAfterStage", { stage }))}">
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
    nodes.unshift({ id: currentId, name: currentId, region: t("editor.currentMissing"), online: false });
  }
  return nodes
    .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === currentId ? "selected" : ""}>${escapeHtml(node.name)}${node.region ? ` · ${escapeHtml(node.region)}` : ""}${node.online === false ? ` · ${escapeHtml(t("common.offline"))}` : ""}</option>`)
    .join("");
}

function thresholdFields(edge) {
  const thresholds = edge.health_thresholds || {};
  return `
    <fieldset class="threshold-fieldset">
      <legend>${escapeHtml(t("editor.thresholdLegend"))}</legend>
      <div class="threshold-grid">
        ${Object.entries(thresholdLabels).map(([key, labelKey]) => `
          <label>
            <span>${escapeHtml(t(labelKey))}</span>
            <input type="number" min="0" step="0.1" data-threshold-key="${key}" value="${escapeHtml(thresholds[key] ?? "")}" placeholder="${escapeHtml(t("common.default"))}" />
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
        <span>${escapeHtml(stageName(index))}</span>
        <strong>${escapeHtml(routeNodeLabel(node))}</strong>
      </div>
      <code>${escapeHtml(node.id)}</code>
    </div>
    <div class="editor-fields">
      ${selectable ? `
        <label class="field-wide">
          <span>${escapeHtml(t("editor.komariNode"))}</span>
          <select data-node-select>${nodeOptions(node.id)}</select>
        </label>` : ""}
      <label>
        <span>${escapeHtml(t("editor.displayName"))}</span>
        <input type="text" maxlength="160" data-node-field="label" value="${escapeHtml(node.label || "")}" />
      </label>
      <label>
        <span>${escapeHtml(t("editor.region"))}</span>
        <input type="text" maxlength="160" data-node-field="region" value="${escapeHtml(node.region || "")}" />
      </label>
      <label>
        <span>${escapeHtml(t("editor.latitude"))}</span>
        <input type="number" min="-90" max="90" step="0.000001" inputmode="decimal" data-node-field="latitude" value="${escapeHtml(node.latitude ?? "")}" />
      </label>
      <label>
        <span>${escapeHtml(t("editor.longitude"))}</span>
        <input type="number" min="-180" max="180" step="0.000001" inputmode="decimal" data-node-field="longitude" value="${escapeHtml(node.longitude ?? "")}" />
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
  if (!tasks.length) return `<p class="manager-empty">${escapeHtml(t("editor.noTasks"))}</p>`;
  return `<div class="task-choice-grid">${tasks.map((task) => `
    <label class="task-choice">
      <input type="checkbox" data-task-id="${Number(task.id)}" ${selected.has(Number(task.id)) ? "checked" : ""} />
      <span><strong>${escapeHtml(task.name || t("editor.taskFallback", { id: task.id }))}</strong><small>#${escapeHtml(task.id)}${task.type ? ` · ${escapeHtml(task.type)}` : ""}</small></span>
    </label>`).join("")}</div>`;
}

function renderEdgeEditor(route, index) {
  const edge = route.edges[index];
  const from = routeNodeLabel(route.nodes[index]);
  const to = routeNodeLabel(route.nodes[index + 1]);
  if (edge.probe_id) {
    return `
      <div class="selection-title">
        <div><span>${escapeHtml(t("editor.privateTcp"))}</span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong></div>
        <code>${escapeHtml(edge.probe_id)}</code>
      </div>
      <div class="editor-fields">
        <label>
          <span>${escapeHtml(t("editor.probeEdgeId"))}</span>
          <input type="text" maxlength="128" spellcheck="false" data-edge-field="probe_id" value="${escapeHtml(edge.probe_id)}" />
        </label>
        <label>
          <span>${escapeHtml(t("editor.displayName"))}</span>
          <input type="text" maxlength="160" data-edge-field="probe_name" value="${escapeHtml(edge.probe_name || t("editor.privateTcp"))}" />
        </label>
        <label class="field-wide">
          <span>${escapeHtml(t("editor.sourceAgentId"))}</span>
          <input type="text" maxlength="128" spellcheck="false" data-edge-field="agent_id" value="${escapeHtml(edge.agent_id || "")}" placeholder="${escapeHtml(t("editor.agentPlaceholder"))}" />
          <small>${escapeHtml(t("editor.agentHelp"))}</small>
        </label>
      </div>
      ${thresholdFields(edge)}`;
  }
  return `
    <div class="selection-title">
      <div><span>${escapeHtml(t("editor.komariEstimate"))}</span><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong></div>
      <code>${escapeHtml(edge.source_uuid || edge.to)}</code>
    </div>
    <label class="field-wide standalone-field">
      <span>${escapeHtml(t("editor.taskGroup"))}</span>
      <input type="text" maxlength="160" data-edge-field="task_group_name" value="${escapeHtml(edge.task_group_name || `${t("editor.localNetwork")} · Komari`)}" />
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
    : `<option value="">${escapeHtml(t("editor.noPrivateEdges"))}</option>`;
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
    elements.agentList.innerHTML = `<div class="manager-empty">${escapeHtml(t("editor.noAgents"))}</div>`;
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
          <span class="agent-state ${agent.enabled ? "is-enabled" : ""}">${escapeHtml(t(agent.enabled ? "editor.enabled" : "editor.disabled"))}</span>
          <small>${latest ? escapeHtml(t("editor.lastReport", { time: new Date(latest).toLocaleString(getLocale()) })) : escapeHtml(t("editor.noSamples"))}</small>
        </div>
        <button type="button" class="manager-button ${agent.enabled ? "danger" : ""}" data-agent-id="${escapeHtml(agent.id)}" data-agent-enabled="${agent.enabled ? "true" : "false"}">${escapeHtml(t(agent.enabled ? "editor.disable" : "editor.enable"))}</button>
      </div>`;
  }).join("");
}

async function refreshProbeStatus({ showErrors = false } = {}) {
  if (!bootstrap || probeStatusLoading) return;
  probeStatusLoading = true;
  try {
    const payload = await editorApi.probeStatus();
    bootstrap.agents = Array.isArray(payload.agents) ? payload.agents : [];
    bootstrap.probeEdges = Array.isArray(payload.edges) ? payload.edges : [];
    renderAgents();
  } catch (error) {
    if (showErrors) showNotice(t("editor.refreshFailed", { message: error.message }), "error");
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
  const relay = candidates[0] || { id: `relay-${suffix}`, name: t("editor.chooseRelay"), region: "" };
  const exit = candidates.find((node) => node.id !== relay.id) || { id: `exit-${suffix}`, name: t("editor.chooseExit"), region: "" };
  const id = `route-${suffix}`;
  const taskIds = (bootstrap?.tasks || []).slice(0, 5).map((task) => Number(task.id));
  const route = {
    id,
    name: t("editor.newRoute"),
    nodes: [
      { id: "client", label: t("editor.localNetwork"), type: "client", region: t("editor.reverseEstimate") },
      { id: relay.id, label: relay.name, type: "server", region: relay.region || "" },
      { id: exit.id, label: exit.name, type: "server", region: exit.region || "" },
      { id: "internet", label: t("editor.stage.internet"), type: "target", region: "" },
    ],
    edges: [
      {
        from: "client",
        to: relay.id,
        source_uuid: relay.id,
        task_ids: taskIds,
        task_group_name: `${t("editor.localNetwork")} · Komari`,
        measurement_direction: "reverse",
      },
      {
        from: relay.id,
        to: exit.id,
        source_uuid: relay.id,
        probe_id: `${id}-relay-exit`,
        probe_name: t("editor.privateRelayExit"),
        agent_id: `relay-${suffix}`,
      },
      {
        from: exit.id,
        to: "internet",
        source_uuid: exit.id,
        probe_id: `${id}-exit-internet`,
        probe_name: t("editor.privateExitInternet"),
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
    const result = await editorApi.saveTopology(draft, revision, csrfToken);
    draft = clone(result.config);
    revision = result.revision;
    selectedRouteIndex = Math.min(selectedRouteIndex, draft.routes.length - 1);
    markSaved();
    renderEditor();
    showNotice(t("editor.savedNotice"), "success");
    await Promise.resolve(onSavedCallback());
  } catch (error) {
    showNotice(error.message, "error");
    if (error.status === 409 && window.confirm(t("editor.reloadConflict"))) {
      await loadBootstrap();
    }
  } finally {
    elements.routeSave.disabled = false;
  }
}

function deleteRoute() {
  const route = currentRoute();
  if (!route || draft.routes.length <= 1) return;
  if (!window.confirm(t("editor.deleteConfirm", { name: route.name }))) return;
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
    return await editorApi.createEnrollment(body, csrfToken);
  } catch (error) {
    if (error.status !== 409) throw error;
    const confirmed = window.confirm(t("editor.rotateConfirm"));
    if (!confirmed) throw new Error(t("editor.rotationCancelled"));
    return await editorApi.createEnrollment({ ...body, rotateExisting: true }, csrfToken);
  }
}

async function generateDeploymentCommand() {
  if (isDirty) {
    showNotice(t("editor.saveBeforeDeploy"), "error");
    return;
  }
  const item = selectedPrivateEdge();
  const agentId = elements.deployAgent.value.trim();
  const targetHost = elements.deployHost.value.trim();
  const targetPort = Number(elements.deployPort.value);
  const interval = Number(elements.deployInterval.value);
  const timeout = Number(elements.deployTimeout.value);
  if (!item || !agentId || !targetHost || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    showNotice(t("editor.completeDeployFields"), "error");
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(agentId)) {
    showNotice(t("editor.invalidAgentId"), "error");
    return;
  }
  if (!/^[a-zA-Z0-9_.:[\]-]+$/.test(targetHost)) {
    showNotice(t("editor.invalidHost"), "error");
    return;
  }
  if (item.edge.agent_id && item.edge.agent_id !== agentId) {
    showNotice(t("editor.agentMismatch", { agent: item.edge.agent_id }), "error");
    return;
  }
  elements.deployGenerate.disabled = true;
  setDeploymentStatus("editor.issuingCode");
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
    const expires = new Date(enrollment.expiresAt).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" });
    setDeploymentStatus(origin.startsWith("https://") ? "editor.codeExpires" : "editor.httpWarning", { time: expires });
  } catch (error) {
    setDeploymentStatusText(error.message);
    showNotice(error.message, "error");
  } finally {
    elements.deployGenerate.disabled = !privateEdges().length;
  }
}

async function toggleAgent(button) {
  const agentId = button.dataset.agentId;
  const currentlyEnabled = button.dataset.agentEnabled === "true";
  if (currentlyEnabled && !window.confirm(t("editor.disableConfirm", { agent: agentId }))) return;
  button.disabled = true;
  try {
    const result = await editorApi.setAgentEnabled(agentId, !currentlyEnabled, csrfToken);
    const index = bootstrap.agents.findIndex((agent) => agent.id === agentId);
    if (index >= 0) bootstrap.agents[index] = result.agent;
    renderAgents();
    showNotice(t("editor.agentChanged", {
      agent: agentId,
      state: t(result.agent.enabled ? "editor.enabled" : "editor.disabled"),
    }), "success");
  } catch (error) {
    showNotice(error.message, "error");
    button.disabled = false;
  }
}

function handleSelectionInput(event) {
  const route = currentRoute();
  if (!route) return;
  if (event.target.dataset.nodeField) {
    const field = event.target.dataset.nodeField;
    if (["latitude", "longitude"].includes(field)) {
      if (event.target.value === "") delete route.nodes[selectedIndex][field];
      else route.nodes[selectedIndex][field] = Number(event.target.value);
    } else {
      route.nodes[selectedIndex][field] = event.target.value;
    }
    markDirty();
    if (field === "label") {
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
    delete current.latitude;
    delete current.longitude;
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

function bindEvents({ embedded = false } = {}) {
  elements.toggle?.addEventListener("click", () => {
    elements.panel.hidden = !elements.panel.hidden;
    elements.toggle.setAttribute("aria-expanded", String(!elements.panel.hidden));
    if (!elements.panel.hidden) {
      refreshProbeStatus({ showErrors: true });
      elements.panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  elements.close?.addEventListener("click", () => {
    elements.panel.hidden = true;
    elements.toggle?.setAttribute("aria-expanded", "false");
    elements.toggle?.focus();
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
    setDeploymentStatus("deploy.validity");
  });
  elements.deployGenerate.addEventListener("click", generateDeploymentCommand);
  elements.copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements.command.textContent);
      elements.copy.textContent = t("deploy.copied");
      setTimeout(() => { elements.copy.textContent = t("deploy.copy"); }, 1800);
    } catch {
      showNotice(t("editor.clipboardDenied"), "error");
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
    if ((embedded || !elements.panel.hidden) && document.visibilityState === "visible") refreshProbeStatus();
  }, probeStatusRefreshMs);
  window.addEventListener("pagehide", () => window.clearInterval(probeStatusTimer), { once: true });
}

function syncSiteSettings(site, nextRevision) {
  if (!draft || !site) return;
  draft.site_name = site.siteName || draft.site_name;
  draft.title = site.siteName || draft.title;
  draft.description = site.description || draft.description;
  draft.auto_theme_beijing = site.autoThemeBeijing === true;
  draft.visual_theme = site.visualTheme || "topomari";
  draft.custom_theme_colors = site.customThemeColors === true;
  draft.theme_colors = {
    light_background: site.themeColors?.lightBackground || "#eeede5",
    light_accent: site.themeColors?.lightAccent || "#a7622d",
    dark_background: site.themeColors?.darkBackground || "#1c1b19",
    dark_accent: site.themeColors?.darkAccent || "#e4a35f",
  };
  draft.theme_settings = {
    background_enabled: site.themeSettings?.backgroundEnabled === true,
    background_type: site.themeSettings?.backgroundType || "image",
    light_background: site.themeSettings?.lightBackground || "",
    dark_background: site.themeSettings?.darkBackground || "",
    background_blur: site.themeSettings?.backgroundBlur ?? 0,
    background_overlay: site.themeSettings?.backgroundOverlay ?? 0,
    glass_blur: site.themeSettings?.glassBlur ?? 18,
    glass_opacity: site.themeSettings?.glassOpacity ?? 78,
    glass_border: site.themeSettings?.glassBorder ?? 18,
    corner_radius: site.themeSettings?.cornerRadius ?? 18,
  };
  draft.geo_ip_enabled = site.geoIp?.enabled === true;
  draft.geo_ip_provider = "maxmind";
  draft.geo_ip_last_updated_at = site.geoIp?.lastUpdatedAt || "";
  if (nextRevision) revision = nextRevision;
  if (bootstrap?.config) bootstrap.config = clone(draft);
}

async function loadBootstrap() {
  const payload = await editorApi.bootstrap();
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

export async function initTopologyEditor({ onSaved = () => {}, embedded = false } = {}) {
  if (!elements.panel || (!embedded && !elements.toggle)) return null;
  onSavedCallback = onSaved;
  document.addEventListener("topomari:languagechange", () => {
    if (draft) renderEditor();
    if (isDirty) markDirty();
    else markSaved();
    renderDeploymentStatus();
    if (!elements.commandBox.hidden) elements.copy.textContent = t("deploy.copy");
  });
  try {
    await loadBootstrap();
    bindEvents({ embedded });
    if (embedded) elements.panel.hidden = false;
    else elements.toggle.hidden = false;
    return {
      available: true,
      reload: loadBootstrap,
      syncSiteSettings,
    };
  } catch (error) {
    if (error.status === 404) return { available: false };
    throw error;
  }
}
