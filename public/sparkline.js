const WIDTH = 130;
const HEIGHT = 36;
const PADDING = 3;

function toneClass(status) {
  if (status === "failed" || status === "degraded") return "is-danger";
  return status === "warning" ? "is-warning" : "";
}

function latencyValues(history) {
  return (history || []).map((point) => {
    if (point?.value === null || point?.value === undefined || point?.value === "") return null;
    return Number.isFinite(Number(point.value)) ? Number(point.value) : null;
  });
}

function escapeMarkup(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSparkline(history, status, formatLatency = (value) => `${value} ms`, labels = {}) {
  const values = latencyValues(history);
  const valid = values.filter((value) => value !== null);
  const tone = toneClass(status);

  if (!valid.length) {
    const label = escapeMarkup(labels.empty || "No latency trend available");
    return `<svg class="sparkline ${tone}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}"><path class="grid-line" d="M0 30H130"/></svg>`;
  }

  if (valid.length === 1) {
    const value = valid[0];
    const pointX = WIDTH - PADDING;
    const pointY = HEIGHT / 2;
    const label = escapeMarkup(labels.collecting?.(formatLatency(value)) || `Collecting latency trend; one sample at ${formatLatency(value)}`);
    return `
    <svg class="sparkline ${tone} is-collecting" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}">
      <title>${label}</title>
      <path class="grid-line" d="M0 30H130"/>
      <path class="spark-guide" d="M${PADDING} ${pointY}H${pointX}"/>
      <circle class="spark-point" cx="${pointX}" cy="${pointY}" r="3"/>
    </svg>`;
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = Math.max(1, max - min);
  const denominator = Math.max(1, values.length - 1);
  const points = values
    .map((value, index) => {
      if (value === null) return null;
      const x = PADDING + (index / denominator) * (WIDTH - PADDING * 2);
      const y = HEIGHT - PADDING - ((value - min) / range) * (HEIGHT - PADDING * 2 - 5);
      return [x, y];
    })
    .filter(Boolean);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)[0].toFixed(1)} ${HEIGHT - PADDING} L${points[0][0].toFixed(1)} ${HEIGHT - PADDING} Z`;
  const label = escapeMarkup(labels.range?.(formatLatency(min), formatLatency(max)) || `Latency trend from ${formatLatency(min)} to ${formatLatency(max)}`);
  return `
    <svg class="sparkline ${tone}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}">
      <path class="grid-line" d="M0 30H130"/>
      <path class="spark-area" d="${area}"/>
      <path class="spark-line" d="${line}"/>
    </svg>`;
}
