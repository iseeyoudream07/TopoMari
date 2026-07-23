const DEG_TO_RAD = Math.PI / 180;
const AUTO_ROTATION_DEGREES_PER_SECOND = 2.4;
const MAX_AUTO_ROTATION_FRAME_MS = 100;
const DRAG_DEGREES_PER_PIXEL = 0.35;

export function normalizeGlobeLongitude(value) {
  const longitude = Number(value);
  if (!Number.isFinite(longitude)) return 0;
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

export function advanceGlobeLongitude(
  longitude,
  elapsedMilliseconds,
  { rotationStopped = false, reducedMotion = false, dragging = false } = {},
) {
  const current = normalizeGlobeLongitude(longitude);
  const elapsed = Math.max(0, Number(elapsedMilliseconds) || 0);
  if (rotationStopped || reducedMotion || dragging || elapsed === 0) return current;
  return normalizeGlobeLongitude(current + (elapsed / 1_000) * AUTO_ROTATION_DEGREES_PER_SECOND);
}

export function globeLongitudeForHorizontalDrag(startLongitude, deltaPixels) {
  const delta = Number(deltaPixels);
  if (!Number.isFinite(delta)) return normalizeGlobeLongitude(startLongitude);
  return normalizeGlobeLongitude(startLongitude - delta * DRAG_DEGREES_PER_PIXEL);
}

const LAND_POLYGONS = [
  [[-168, 70], [-150, 58], [-132, 55], [-125, 48], [-124, 39], [-116, 31], [-106, 23], [-97, 18], [-88, 20], [-82, 27], [-80, 36], [-66, 45], [-58, 52], [-73, 59], [-94, 66], [-120, 72], [-145, 72]],
  [[-82, 12], [-72, 9], [-61, 6], [-50, -1], [-43, -12], [-48, -27], [-57, -39], [-68, -55], [-76, -43], [-80, -20]],
  [[-18, 35], [-7, 44], [12, 56], [35, 71], [66, 73], [97, 77], [133, 70], [164, 61], [179, 51], [154, 44], [136, 35], [123, 26], [108, 18], [101, 7], [91, 10], [80, 7], [70, 20], [55, 25], [43, 34], [29, 40], [15, 36], [4, 42], [-9, 37]],
  [[-18, 34], [-4, 36], [12, 33], [28, 31], [40, 18], [51, 11], [45, -13], [34, -26], [18, -35], [5, -29], [-6, -12], [-12, 7]],
  [[111, -11], [130, -10], [153, -24], [146, -39], [126, -35], [113, -24]],
  [[-52, 60], [-42, 82], [-22, 78], [-17, 66], [-30, 59]],
  [[129, 31], [145, 44], [142, 25], [133, 24]],
];

const REGION_LOCATIONS = [
  { pattern: /(?:东京|tokyo)/i, lat: 35.6762, lng: 139.6503, code: "JP" },
  { pattern: /(?:大阪|osaka)/i, lat: 34.6937, lng: 135.5023, code: "JP" },
  { pattern: /(?:新加坡|singapore)/i, lat: 1.3521, lng: 103.8198, code: "SG" },
  { pattern: /(?:香港|hong\s*kong)/i, lat: 22.3193, lng: 114.1694, code: "HK" },
  { pattern: /(?:台北|taipei)/i, lat: 25.033, lng: 121.5654, code: "TW" },
  { pattern: /(?:首尔|seoul)/i, lat: 37.5665, lng: 126.978, code: "KR" },
  { pattern: /(?:北京|beijing)/i, lat: 39.9042, lng: 116.4074, code: "CN" },
  { pattern: /(?:上海|shanghai)/i, lat: 31.2304, lng: 121.4737, code: "CN" },
  { pattern: /(?:广州|guangzhou)/i, lat: 23.1291, lng: 113.2644, code: "CN" },
  { pattern: /(?:悉尼|sydney)/i, lat: -33.8688, lng: 151.2093, code: "AU" },
  { pattern: /(?:墨尔本|melbourne)/i, lat: -37.8136, lng: 144.9631, code: "AU" },
  { pattern: /(?:洛杉矶|los\s*angeles|\bla\b)/i, lat: 34.0522, lng: -118.2437, code: "US" },
  { pattern: /(?:圣何塞|san\s*jose)/i, lat: 37.3382, lng: -121.8863, code: "US" },
  { pattern: /(?:西雅图|seattle)/i, lat: 47.6062, lng: -122.3321, code: "US" },
  { pattern: /(?:纽约|new\s*york)/i, lat: 40.7128, lng: -74.006, code: "US" },
  { pattern: /(?:芝加哥|chicago)/i, lat: 41.8781, lng: -87.6298, code: "US" },
  { pattern: /(?:迈阿密|miami)/i, lat: 25.7617, lng: -80.1918, code: "US" },
  { pattern: /(?:多伦多|toronto)/i, lat: 43.6532, lng: -79.3832, code: "CA" },
  { pattern: /(?:伦敦|london)/i, lat: 51.5072, lng: -0.1276, code: "GB" },
  { pattern: /(?:法兰克福|frankfurt)/i, lat: 50.1109, lng: 8.6821, code: "DE" },
  { pattern: /(?:阿姆斯特丹|amsterdam)/i, lat: 52.3676, lng: 4.9041, code: "NL" },
  { pattern: /(?:巴黎|paris)/i, lat: 48.8566, lng: 2.3522, code: "FR" },
  { pattern: /(?:斯德哥尔摩|stockholm)/i, lat: 59.3293, lng: 18.0686, code: "SE" },
  { pattern: /(?:华沙|warsaw)/i, lat: 52.2297, lng: 21.0122, code: "PL" },
  { pattern: /(?:莫斯科|moscow)/i, lat: 55.7558, lng: 37.6173, code: "RU" },
  { pattern: /(?:迪拜|dubai)/i, lat: 25.2048, lng: 55.2708, code: "AE" },
  { pattern: /(?:孟买|mumbai)/i, lat: 19.076, lng: 72.8777, code: "IN" },
  { pattern: /(?:圣保罗|s[aã]o\s*paulo)/i, lat: -23.5505, lng: -46.6333, code: "BR" },
];

const COUNTRY_LOCATIONS = {
  AR: [-38.4161, -63.6167],
  AT: [47.5162, 14.5501],
  JP: [36.2048, 138.2529],
  SG: [1.3521, 103.8198],
  HK: [22.3193, 114.1694],
  MO: [22.1987, 113.5439],
  TW: [23.6978, 120.9605],
  KR: [35.9078, 127.7669],
  CN: [35.8617, 104.1954],
  BD: [23.685, 90.3563],
  BN: [4.5353, 114.7277],
  ID: [-0.7893, 113.9213],
  KH: [12.5657, 104.991],
  KZ: [48.0196, 66.9237],
  LA: [19.8563, 102.4955],
  LK: [7.8731, 80.7718],
  MM: [21.9162, 95.956],
  MN: [46.8625, 103.8467],
  MY: [4.2105, 101.9758],
  NP: [28.3949, 84.124],
  PH: [12.8797, 121.774],
  PK: [30.3753, 69.3451],
  TH: [15.87, 100.9925],
  UZ: [41.3775, 64.5853],
  VN: [14.0583, 108.2772],
  AU: [-25.2744, 133.7751],
  NZ: [-40.9006, 174.886],
  US: [39.8283, -98.5795],
  PR: [18.2208, -66.5901],
  CA: [56.1304, -106.3468],
  MX: [23.6345, -102.5528],
  CR: [9.7489, -83.7534],
  DO: [18.7357, -70.1627],
  GT: [15.7835, -90.2308],
  HN: [15.2, -86.2419],
  JM: [18.1096, -77.2975],
  NI: [12.8654, -85.2072],
  PA: [8.538, -80.7821],
  SV: [13.7942, -88.8965],
  TT: [10.6918, -61.2225],
  GB: [55.3781, -3.436],
  UK: [55.3781, -3.436],
  BE: [50.5039, 4.4699],
  BG: [42.7339, 25.4858],
  CZ: [49.8175, 15.473],
  DE: [51.1657, 10.4515],
  DK: [56.2639, 9.5018],
  EE: [58.5953, 25.0136],
  NL: [52.1326, 5.2913],
  FR: [46.2276, 2.2137],
  ES: [40.4637, -3.7492],
  GR: [39.0742, 21.8243],
  HR: [45.1, 15.2],
  HU: [47.1625, 19.5033],
  IE: [53.1424, -7.6921],
  IS: [64.9631, -19.0208],
  IT: [41.8719, 12.5674],
  CH: [46.8182, 8.2275],
  CY: [35.1264, 33.4299],
  LT: [55.1694, 23.8813],
  LU: [49.8153, 6.1296],
  LV: [56.8796, 24.6032],
  SE: [60.1282, 18.6435],
  NO: [60.472, 8.4689],
  FI: [61.9241, 25.7482],
  PL: [51.9194, 19.1451],
  PT: [39.3999, -8.2245],
  RO: [45.9432, 24.9668],
  RS: [44.0165, 21.0059],
  SI: [46.1512, 14.9955],
  SK: [48.669, 19.699],
  UA: [48.3794, 31.1656],
  RU: [61.524, 105.3188],
  TR: [38.9637, 35.2433],
  AE: [23.4241, 53.8478],
  AM: [40.0691, 45.0382],
  AZ: [40.1431, 47.5769],
  BH: [26.0667, 50.5577],
  GE: [42.3154, 43.3569],
  IL: [31.0461, 34.8516],
  KW: [29.3117, 47.4818],
  OM: [21.4735, 55.9754],
  QA: [25.3548, 51.1839],
  SA: [23.8859, 45.0792],
  IN: [20.5937, 78.9629],
  DZ: [28.0339, 1.6596],
  EG: [26.8206, 30.8025],
  ET: [9.145, 40.4897],
  GH: [7.9465, -1.0232],
  KE: [-0.0236, 37.9062],
  MA: [31.7917, -7.0926],
  NG: [9.082, 8.6753],
  SN: [14.4974, -14.4524],
  TN: [33.8869, 9.5375],
  TZ: [-6.369, 34.8888],
  UG: [1.3733, 32.2903],
  ZA: [-30.5595, 22.9375],
  BR: [-14.235, -51.9253],
  BO: [-16.2902, -63.5887],
  CL: [-35.6751, -71.543],
  CO: [4.5709, -74.2973],
  EC: [-1.8312, -78.1834],
  GY: [4.8604, -58.9302],
  PE: [-9.19, -75.0152],
  PY: [-23.4425, -58.4438],
  SR: [3.9193, -56.0278],
  UY: [-32.5228, -55.7658],
  VE: [6.4238, -66.5897],
};

const FALLBACK_LOCATIONS = [
  [35.6762, 139.6503, "JP"],
  [1.3521, 103.8198, "SG"],
  [22.3193, 114.1694, "HK"],
  [-33.8688, 151.2093, "AU"],
  [37.3382, -121.8863, "US"],
  [40.7128, -74.006, "US"],
  [50.1109, 8.6821, "DE"],
  [51.5072, -0.1276, "GB"],
  [25.2048, 55.2708, "AE"],
  [-23.5505, -46.6333, "BR"],
];

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || "node")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pointInPolygon(lng, lat, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentLng, currentLat] = polygon[current];
    const [previousLng, previousLat] = polygon[previous];
    const crosses = (currentLat > lat) !== (previousLat > lat)
      && lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng;
    if (crosses) inside = !inside;
  }
  return inside;
}

function buildLandPoints({ spacing = 3.4, jitter = 1.2, weight = 0.72 } = {}) {
  const points = [];
  for (let lat = -56; lat <= 82; lat += spacing) {
    const longitudeStep = Math.max(spacing, spacing / Math.max(0.45, Math.cos(lat * DEG_TO_RAD)));
    for (let lng = -178; lng <= 180; lng += longitudeStep) {
      const seed = hashText(`${lat.toFixed(1)}:${lng.toFixed(1)}`);
      const jitterLat = ((seed & 255) / 255 - 0.5) * jitter;
      const jitterLng = (((seed >>> 8) & 255) / 255 - 0.5) * jitter;
      const sampleLat = lat + jitterLat;
      const sampleLng = lng + jitterLng;
      if (LAND_POLYGONS.some((polygon) => pointInPolygon(sampleLng, sampleLat, polygon))) {
        points.push({ lat: sampleLat, lng: sampleLng, weight: weight + ((seed >>> 16) & 255) / 1200 });
      }
    }
  }
  return points;
}

const LAND_POINTS = buildLandPoints();
const LIGHT_LAND_POINTS = buildLandPoints({ spacing: 2.15, jitter: 0.65, weight: 0.9 });

function explicitLocation(node) {
  const latitude = Number(node?.latitude ?? node?.lat);
  const longitude = Number(node?.longitude ?? node?.lng ?? node?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude, code: String(node?.countryCode || node?.country_code || "").toUpperCase().slice(0, 2) };
}

function countryCodeFromText(value) {
  const tokens = String(value || "").toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  return tokens.find((token) => COUNTRY_LOCATIONS[token]) || "";
}

export function resolveNodeLocation(node, fallbackKey = "") {
  const explicit = explicitLocation(node);
  if (explicit) return explicit;

  const geoCountryCode = String(node?.countryCode ?? node?.country_code ?? "").trim().toUpperCase();
  if (COUNTRY_LOCATIONS[geoCountryCode]) {
    const [lat, lng] = COUNTRY_LOCATIONS[geoCountryCode];
    return { lat, lng, code: geoCountryCode === "UK" ? "GB" : geoCountryCode };
  }

  const searchable = [node?.countryName, node?.region, node?.name, node?.label, node?.id].filter(Boolean).join(" ");
  const city = REGION_LOCATIONS.find((location) => location.pattern.test(searchable));
  if (city) return { lat: city.lat, lng: city.lng, code: city.code };

  const countryCode = countryCodeFromText(searchable);
  if (countryCode) {
    const [lat, lng] = COUNTRY_LOCATIONS[countryCode];
    return { lat, lng, code: countryCode === "UK" ? "GB" : countryCode };
  }

  const fallback = FALLBACK_LOCATIONS[hashText(`${node?.id || searchable}:${fallbackKey}`) % FALLBACK_LOCATIONS.length];
  return { lat: fallback[0], lng: fallback[1], code: fallback[2], inferred: true };
}

export function buildRouteLinks(routes = []) {
  const links = [];
  const nodeLocations = new Map();
  for (const route of routes || []) {
    const nodes = Array.isArray(route?.nodes) ? route.nodes : [];
    const edges = Array.isArray(route?.edges) ? route.edges : [];
    nodes.forEach((node, index) => {
      const key = String(node?.id || `${route?.id || "route"}:${index}`);
      if (!nodeLocations.has(key)) nodeLocations.set(key, resolveNodeLocation(node, route?.id));
    });
    edges.forEach((edge, index) => {
      const fromNode = nodes[index];
      const toNode = nodes[index + 1];
      if (!fromNode || !toNode) return;
      const fromKey = String(fromNode.id || `${route?.id || "route"}:${index}`);
      const toKey = String(toNode.id || `${route?.id || "route"}:${index + 1}`);
      links.push({
        id: `${route?.id || "route"}:${edge?.probe_id || edge?.task?.id || index}`,
        routeId: String(route?.id || ""),
        from: { ...nodeLocations.get(fromKey), key: fromKey, label: fromNode.name || fromNode.label || fromKey },
        to: { ...nodeLocations.get(toKey), key: toKey, label: toNode.name || toNode.label || toKey },
        status: String(edge?.stats?.status || "unknown"),
      });
    });
  }
  return links;
}

function locationVector(location) {
  const lat = location.lat * DEG_TO_RAD;
  const lng = location.lng * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.sin(lng),
    y: Math.sin(lat),
    z: cosLat * Math.cos(lng),
  };
}

function slerp(start, end, progress) {
  const dot = Math.min(1, Math.max(-1, start.x * end.x + start.y * end.y + start.z * end.z));
  const angle = Math.acos(dot);
  if (angle < 0.0001) return { ...start };
  const denominator = Math.sin(angle);
  const startWeight = Math.sin((1 - progress) * angle) / denominator;
  const endWeight = Math.sin(progress * angle) / denominator;
  return {
    x: start.x * startWeight + end.x * endWeight,
    y: start.y * startWeight + end.y * endWeight,
    z: start.z * startWeight + end.z * endWeight,
  };
}

function focusLongitude(links) {
  const uniqueLocations = new Map();
  links.flatMap((link) => [link.from, link.to]).forEach((location) => {
    uniqueLocations.set(location.key || `${location.lat}:${location.lng}`, location);
  });
  const locations = [...uniqueLocations.values()];
  if (!locations.length) return -100;
  return locations
    .map((candidate) => ({
      lng: candidate.lng,
      score: locations.reduce((score, location) => {
        const visibility = Math.cos((location.lng - candidate.lng) * DEG_TO_RAD);
        return score + Math.max(0, visibility);
      }, 0),
    }))
    .sort((left, right) => right.score - left.score)[0].lng;
}

function roundedRect(context, x, y, width, height, radius) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, resolvedRadius);
  context.arcTo(x + width, y + height, x, y + height, resolvedRadius);
  context.arcTo(x, y + height, x, y, resolvedRadius);
  context.arcTo(x, y, x + width, y, resolvedRadius);
  context.closePath();
}

function readPalette(canvas) {
  const styles = getComputedStyle(canvas);
  const value = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    light: document.documentElement.dataset.theme !== "dark",
    text: value("--globe-text", "#f8fafc"),
    muted: value("--globe-muted", "#94a3b8"),
    cyan: value("--globe-cyan", "#38bdf8"),
    green: value("--globe-green", "#34d399"),
    amber: value("--globe-amber", "#fbbf24"),
    rose: value("--globe-rose", "#fb7185"),
    unknown: value("--globe-unknown", "#94a3b8"),
    labelBackground: value("--globe-label-bg", "rgba(4, 10, 20, 0.9)"),
    labelBorder: value("--globe-label-border", "rgba(148, 210, 236, 0.32)"),
    surfaceHighlight: value("--globe-surface-highlight", "rgba(35, 52, 72, 0.9)"),
    surfaceMiddle: value("--globe-surface-middle", "rgba(8, 15, 27, 0.97)"),
    surfaceEdge: value("--globe-surface-edge", "rgba(2, 6, 14, 0.99)"),
    landNear: value("--globe-land-near", "#f8fafc"),
    landFar: value("--globe-land-far", "#94a3b8"),
    glowInner: value("--globe-glow-inner", "rgba(56, 189, 248, 0.05)"),
    glowOuter: value("--globe-glow-outer", "rgba(125, 211, 252, 0)"),
    rimStart: value("--globe-rim-start", "rgba(186, 230, 253, 0.32)"),
    rimMiddle: value("--globe-rim-middle", "rgba(125, 211, 252, 0.95)"),
    rimEnd: value("--globe-rim-end", "rgba(14, 165, 233, 0.18)"),
  };
}

export function createRouteGlobe(canvas, { countElement = null, nodeCountElement = null } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;

  let links = [];
  let nodes = [];
  let centerLongitude = -25;
  let hasFocusedRoutes = false;
  let frame = 0;
  let visible = true;
  let destroyed = false;
  let rotationStopped = false;
  let activePointerId = null;
  let dragStartX = 0;
  let dragStartLongitude = centerLongitude;
  let lastAnimationTime = null;
  let palette = readPalette(canvas);
  let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  canvas.dataset.rotationStopped = "false";
  canvas.dataset.dragging = "false";

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(performance.now());
  }

  function projectVector(vector, metrics, altitude = 0) {
    const longitude = metrics.longitude * DEG_TO_RAD;
    const tilt = 12 * DEG_TO_RAD;
    const rotatedX = vector.x * Math.cos(longitude) - vector.z * Math.sin(longitude);
    const rotatedZ = vector.x * Math.sin(longitude) + vector.z * Math.cos(longitude);
    const tiltedY = vector.y * Math.cos(tilt) - rotatedZ * Math.sin(tilt);
    const tiltedZ = vector.y * Math.sin(tilt) + rotatedZ * Math.cos(tilt);
    const scale = metrics.radius * (1 + altitude);
    return {
      x: metrics.centerX + rotatedX * scale,
      y: metrics.centerY - tiltedY * scale,
      z: tiltedZ,
      visible: tiltedZ > -Math.max(0.04, altitude * 0.8),
    };
  }

  function projectLocation(location, metrics, altitude = 0) {
    return projectVector(locationVector(location), metrics, altitude);
  }

  function drawGlobe(metrics) {
    const glow = context.createRadialGradient(
      metrics.centerX,
      metrics.centerY,
      metrics.radius * 0.78,
      metrics.centerX,
      metrics.centerY,
      metrics.radius * 1.14,
    );
    glow.addColorStop(0, "rgba(56, 189, 248, 0)");
    glow.addColorStop(0.72, palette.glowInner);
    glow.addColorStop(1, palette.glowOuter);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(metrics.centerX, metrics.centerY, metrics.radius * 1.16, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.shadowColor = palette.cyan;
    context.shadowBlur = palette.light ? 18 : 24;
    const globeFill = context.createRadialGradient(
      metrics.centerX - metrics.radius * 0.34,
      metrics.centerY - metrics.radius * 0.32,
      metrics.radius * 0.08,
      metrics.centerX,
      metrics.centerY,
      metrics.radius,
    );
    globeFill.addColorStop(0, palette.surfaceHighlight);
    globeFill.addColorStop(0.52, palette.surfaceMiddle);
    globeFill.addColorStop(1, palette.surfaceEdge);
    context.fillStyle = globeFill;
    context.beginPath();
    context.arc(metrics.centerX, metrics.centerY, metrics.radius, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.arc(metrics.centerX, metrics.centerY, metrics.radius - 1, 0, Math.PI * 2);
    context.clip();
    const landPoints = palette.light ? LIGHT_LAND_POINTS : LAND_POINTS;
    for (const point of landPoints) {
      const projected = projectLocation(point, metrics);
      if (projected.z <= 0.015) continue;
      const alpha = palette.light ? 0.65 + projected.z * 0.35 : 0.24 + projected.z * 0.68;
      context.globalAlpha = alpha;
      context.fillStyle = projected.z > 0.65 ? palette.landNear : palette.landFar;
      context.beginPath();
      context.arc(
        projected.x,
        projected.y,
        point.weight * (palette.light ? 0.95 + projected.z * 0.7 : 0.68 + projected.z * 0.52),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
    context.globalAlpha = 1;

    const rim = context.createLinearGradient(
      metrics.centerX - metrics.radius,
      metrics.centerY - metrics.radius,
      metrics.centerX + metrics.radius,
      metrics.centerY + metrics.radius,
    );
    rim.addColorStop(0, palette.rimStart);
    rim.addColorStop(0.45, palette.rimMiddle);
    rim.addColorStop(1, palette.rimEnd);
    context.strokeStyle = rim;
    context.lineWidth = 1.25;
    context.beginPath();
    context.arc(metrics.centerX, metrics.centerY, metrics.radius, 0, Math.PI * 2);
    context.stroke();
  }

  function statusColor(status) {
    if (status === "healthy") return palette.green;
    if (status === "warning" || status === "unconfigured") return palette.amber;
    if (status === "degraded" || status === "failed") return palette.rose;
    return palette.cyan;
  }

  function arcPoint(link, progress, metrics) {
    const start = locationVector(link.from);
    const end = locationVector(link.to);
    const vector = slerp(start, end, progress);
    const dot = Math.min(1, Math.max(-1, start.x * end.x + start.y * end.y + start.z * end.z));
    const distance = Math.acos(dot);
    const altitude = Math.sin(Math.PI * progress) * Math.min(0.24, 0.07 + distance * 0.09);
    return projectVector(vector, metrics, altitude);
  }

  function drawArc(link, index, metrics, time) {
    const color = statusColor(link.status);
    const points = Array.from({ length: 49 }, (_, pointIndex) => arcPoint(link, pointIndex / 48, metrics));
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1.15;
    context.globalAlpha = link.status === "failed" ? 0.72 : 0.58;
    context.shadowColor = color;
    context.shadowBlur = 8;
    context.setLineDash([4, 6]);
    context.lineDashOffset = reducedMotion.matches ? 0 : -((time * 0.018 + index * 5) % 10);
    context.beginPath();
    let drawing = false;
    for (const point of points) {
      if (!point.visible) {
        drawing = false;
        continue;
      }
      if (!drawing) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
      drawing = true;
    }
    context.stroke();
    context.restore();

    const progress = reducedMotion.matches ? 0.58 : ((time / (2600 + index * 170) + index * 0.23) % 1);
    const packet = arcPoint(link, progress, metrics);
    if (!packet.visible) return;
    context.save();
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 15;
    context.globalAlpha = 0.95;
    context.beginPath();
    context.arc(packet.x, packet.y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawNode(node, index, metrics, time) {
    const point = projectLocation(node, metrics, 0.012);
    if (!point.visible) return;
    const pulse = reducedMotion.matches ? 0.45 : (Math.sin(time / 520 + index * 1.8) + 1) / 2;
    context.save();
    context.strokeStyle = palette.green;
    context.globalAlpha = 0.14 + pulse * 0.16;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(point.x, point.y, 5 + pulse * 4, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = palette.green;
    context.shadowColor = palette.green;
    context.shadowBlur = 12;
    context.beginPath();
    context.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
    context.fill();
    context.restore();

    if (!node.code || metrics.width < 360 || index > 8) return;
    const label = node.code.slice(0, 2);
    context.save();
    context.font = '700 9px "Arimo", sans-serif';
    const labelWidth = Math.max(24, context.measureText(label).width + 12);
    const labelX = point.x + 7;
    const labelY = point.y - 16;
    roundedRect(context, labelX, labelY, labelWidth, 17, 5);
    context.fillStyle = palette.labelBackground;
    context.fill();
    context.strokeStyle = palette.labelBorder;
    context.lineWidth = 0.8;
    context.stroke();
    context.fillStyle = palette.text;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, labelX + labelWidth / 2, labelY + 8.5);
    context.restore();
  }

  function draw(time = 0) {
    if (destroyed) return;
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    if (width <= 1 || height <= 1) return;
    context.clearRect(0, 0, width, height);
    const radius = Math.max(92, Math.min(width * 0.405, height * 0.445));
    const metrics = {
      width,
      height,
      radius,
      centerX: width * (width > 520 ? 0.57 : 0.52),
      centerY: height * 0.53,
      longitude: centerLongitude,
    };
    drawGlobe(metrics);
    links.forEach((link, index) => drawArc(link, index, metrics, time));
    nodes.forEach((node, index) => drawNode(node, index, metrics, time));
    canvas.dataset.ready = "true";
    canvas.dataset.viewLongitude = centerLongitude.toFixed(2);
  }

  function animate(time) {
    frame = 0;
    if (destroyed || !visible || document.visibilityState === "hidden") {
      lastAnimationTime = null;
      return;
    }
    if (lastAnimationTime !== null) {
      centerLongitude = advanceGlobeLongitude(
        centerLongitude,
        Math.min(MAX_AUTO_ROTATION_FRAME_MS, Math.max(0, time - lastAnimationTime)),
        {
          rotationStopped,
          reducedMotion: reducedMotion.matches,
          dragging: activePointerId !== null,
        },
      );
    }
    lastAnimationTime = time;
    draw(time);
    if (!reducedMotion.matches) frame = requestAnimationFrame(animate);
  }

  function scheduleFrame() {
    if (destroyed || frame || !visible || document.visibilityState === "hidden") return;
    if (reducedMotion.matches) draw(performance.now());
    else frame = requestAnimationFrame(animate);
  }

  function update(routes = []) {
    links = buildRouteLinks(routes);
    const focusedLongitude = focusLongitude(links);
    canvas.dataset.focusLongitude = focusedLongitude.toFixed(2);
    if (!hasFocusedRoutes && links.length > 0) {
      centerLongitude = normalizeGlobeLongitude(focusedLongitude);
      hasFocusedRoutes = true;
      lastAnimationTime = null;
    }
    const uniqueNodes = new Map();
    links.forEach((link) => {
      uniqueNodes.set(link.from.key, link.from);
      uniqueNodes.set(link.to.key, link.to);
    });
    nodes = [...uniqueNodes.values()];
    if (countElement) countElement.textContent = String(links.length);
    if (nodeCountElement) nodeCountElement.textContent = String(nodes.length);
    canvas.dataset.links = String(links.length);
    scheduleFrame();
  }

  function setRotationStopped(value) {
    const nextValue = value === true;
    if (rotationStopped === nextValue) return;
    rotationStopped = nextValue;
    canvas.dataset.rotationStopped = String(rotationStopped);
    lastAnimationTime = null;
    scheduleFrame();
  }

  function startPointerDrag(event) {
    if (destroyed || activePointerId !== null || event.isPrimary === false) return;
    if (event.button !== undefined && event.button !== 0) return;
    activePointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartLongitude = centerLongitude;
    canvas.dataset.dragging = "true";
    lastAnimationTime = null;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; dragging still works while the pointer remains over the canvas.
    }
    event.preventDefault?.();
  }

  function movePointerDrag(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    centerLongitude = globeLongitudeForHorizontalDrag(dragStartLongitude, event.clientX - dragStartX);
    canvas.dataset.viewLongitude = centerLongitude.toFixed(2);
    scheduleFrame();
    event.preventDefault?.();
  }

  function finishPointerDrag(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    const pointerId = activePointerId;
    activePointerId = null;
    canvas.dataset.dragging = "false";
    lastAnimationTime = null;
    try {
      if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture?.(pointerId);
    } catch {
      // Pointer capture may already have been released by pointerup or pointercancel.
    }
    scheduleFrame();
    event.preventDefault?.();
  }

  function handleKeyboard(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    centerLongitude = normalizeGlobeLongitude(centerLongitude + (event.key === "ArrowLeft" ? -8 : 8));
    canvas.dataset.viewLongitude = centerLongitude.toFixed(2);
    lastAnimationTime = null;
    scheduleFrame();
    event.preventDefault?.();
  }

  canvas.addEventListener("pointerdown", startPointerDrag);
  canvas.addEventListener("pointermove", movePointerDrag);
  canvas.addEventListener("pointerup", finishPointerDrag);
  canvas.addEventListener("pointercancel", finishPointerDrag);
  canvas.addEventListener("lostpointercapture", finishPointerDrag);
  canvas.addEventListener("keydown", handleKeyboard);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersectionObserver = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting !== false;
    if (visible) {
      lastAnimationTime = null;
      scheduleFrame();
    } else {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastAnimationTime = null;
    }
  }, { rootMargin: "80px" });
  intersectionObserver.observe(canvas);
  const themeObserver = new MutationObserver(() => {
    palette = readPalette(canvas);
    scheduleFrame();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-visual-theme", "style"],
  });
  const visibilityListener = () => {
    lastAnimationTime = null;
    if (document.visibilityState === "hidden") {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    scheduleFrame();
  };
  const motionListener = () => {
    lastAnimationTime = null;
    scheduleFrame();
  };
  document.addEventListener("visibilitychange", visibilityListener);
  reducedMotion.addEventListener?.("change", motionListener);
  resize();
  scheduleFrame();

  return {
    setRotationStopped,
    update,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      const pointerId = activePointerId;
      activePointerId = null;
      canvas.dataset.dragging = "false";
      if (pointerId !== null) {
        try {
          if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture?.(pointerId);
        } catch {
          // The browser may already have released capture while the component is being removed.
        }
      }
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", startPointerDrag);
      canvas.removeEventListener("pointermove", movePointerDrag);
      canvas.removeEventListener("pointerup", finishPointerDrag);
      canvas.removeEventListener("pointercancel", finishPointerDrag);
      canvas.removeEventListener("lostpointercapture", finishPointerDrag);
      canvas.removeEventListener("keydown", handleKeyboard);
      document.removeEventListener("visibilitychange", visibilityListener);
      reducedMotion.removeEventListener?.("change", motionListener);
    },
  };
}
