export function resolveDeploymentTarget(route, edgeIndex, inventory = []) {
  const routeNode = route?.nodes?.[Number(edgeIndex) + 1];
  const nodeId = String(routeNode?.id || "");
  if (!nodeId || ["client", "internet"].includes(nodeId) || routeNode?.type === "target") {
    return { nodeId, host: "" };
  }
  const node = (Array.isArray(inventory) ? inventory : []).find((candidate) => String(candidate?.id || "") === nodeId);
  return {
    nodeId,
    host: String(node?.targetHost || ""),
  };
}
