import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceGlobeLongitude,
  buildRouteLinks,
  createRouteGlobe,
  globeLongitudeForHorizontalDrag,
  normalizeGlobeLongitude,
  resolveNodeLocation,
} from "../public/frontend/route-globe.js";

test("resolves explicit and region-derived globe coordinates", () => {
  assert.deepEqual(resolveNodeLocation({ latitude: 35.6762, longitude: 139.6503, countryCode: "jp" }), {
    lat: 35.6762,
    lng: 139.6503,
    code: "JP",
  });
  assert.deepEqual(resolveNodeLocation({ id: "zouter", name: "Zouter_JP" }), {
    lat: 36.2048,
    lng: 138.2529,
    code: "JP",
  });
  assert.deepEqual(resolveNodeLocation({ id: "dmit", region: "Los Angeles, US" }), {
    lat: 34.0522,
    lng: -118.2437,
    code: "US",
  });
  assert.deepEqual(resolveNodeLocation({ id: "maxmind-node", countryCode: "IN", countryName: "India" }), {
    lat: 20.5937,
    lng: 78.9629,
    code: "IN",
  });
  assert.deepEqual(resolveNodeLocation({ id: "mainland", label: "China mainland" }), {
    lat: 35.8617,
    lng: 104.1954,
    code: "CN",
  });
});

test("keeps unknown node placement deterministic", () => {
  const first = resolveNodeLocation({ id: "unknown-edge-node" }, "route-a");
  const second = resolveNodeLocation({ id: "unknown-edge-node" }, "route-a");
  assert.deepEqual(first, second);
  assert.equal(first.inferred, true);
  assert.equal(first.code, "", "fallback coordinates must not invent a country label");
});

test("builds animated globe links from route edge order and status", () => {
  const links = buildRouteLinks([
    {
      id: "tokyo-to-sydney",
      nodes: [
        { id: "tokyo", name: "Tokyo_JP" },
        { id: "sydney", region: "Sydney, AU" },
      ],
      edges: [{ probe_id: "tokyo-sydney", stats: { status: "degraded" } }],
    },
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].id, "tokyo-to-sydney:tokyo-sydney");
  assert.equal(links[0].status, "degraded");
  assert.equal(links[0].from.code, "JP");
  assert.equal(links[0].to.code, "AU");
});

test("advances automatic rotation while honoring stop, drag, and reduced-motion states", () => {
  assert.ok(Math.abs(advanceGlobeLongitude(10, 1_000) - 12.4) < 1e-9);
  assert.equal(advanceGlobeLongitude(10, 1_000, { rotationStopped: true }), 10);
  assert.equal(advanceGlobeLongitude(10, 1_000, { reducedMotion: true }), 10);
  assert.equal(advanceGlobeLongitude(10, 1_000, { dragging: true }), 10);
  assert.ok(Math.abs(advanceGlobeLongitude(179, 1_000) + 178.6) < 1e-9);
  assert.equal(normalizeGlobeLongitude(540), -180);
});

test("converts horizontal pointer movement into a wrapped globe longitude", () => {
  assert.equal(globeLongitudeForHorizontalDrag(20, 40), 6);
  assert.equal(globeLongitudeForHorizontalDrag(-175, 40), 171);
  assert.equal(globeLongitudeForHorizontalDrag(20, Number.NaN), 20);
});

function installGlobeDom(context, { reducedMotion = false } = {}) {
  const globalNames = [
    "HTMLCanvasElement",
    "IntersectionObserver",
    "MutationObserver",
    "ResizeObserver",
    "cancelAnimationFrame",
    "document",
    "getComputedStyle",
    "requestAnimationFrame",
    "window",
  ];
  const originals = new Map(globalNames.map((name) => [name, {
    exists: Object.hasOwn(globalThis, name),
    value: globalThis[name],
  }]));
  context.after(() => {
    for (const [name, original] of originals) {
      if (original.exists) globalThis[name] = original.value;
      else delete globalThis[name];
    }
  });

  const context2d = {
    arc() {},
    arcTo() {},
    beginPath() {},
    clearRect() {},
    clip() {},
    closePath() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fill() {},
    fillText() {},
    lineTo() {},
    measureText(value) { return { width: String(value).length * 6 }; },
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };

  class FakeCanvas {
    constructor() {
      this.dataset = {};
      this.height = 0;
      this.width = 0;
      this.listeners = new Map();
      this.pointerCaptures = new Set();
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchPointer(type, values = {}) {
      const event = {
        button: 0,
        clientX: 0,
        isPrimary: true,
        pointerId: 1,
        preventDefault() {},
        ...values,
      };
      for (const listener of this.listeners.get(type) || []) listener(event);
      return event;
    }

    getBoundingClientRect() {
      return { height: 330, width: 480 };
    }

    getContext() {
      return context2d;
    }

    hasPointerCapture(pointerId) {
      return this.pointerCaptures.has(pointerId);
    }

    releasePointerCapture(pointerId) {
      this.pointerCaptures.delete(pointerId);
    }

    setPointerCapture(pointerId) {
      this.pointerCaptures.add(pointerId);
    }
  }

  const observerInstances = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observerInstances.push(this);
    }

    disconnect() {
      this.disconnected = true;
    }

    observe() {}
  }

  const documentListeners = new Map();
  const root = { dataset: { theme: "light", visualTheme: "topomari" } };
  const document = {
    documentElement: root,
    visibilityState: "visible",
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || new Set();
      listeners.add(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    },
  };

  const mediaListeners = new Set();
  const media = {
    matches: reducedMotion,
    addEventListener(type, listener) {
      if (type === "change") mediaListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") mediaListeners.delete(listener);
    },
  };

  let nextFrameId = 1;
  const frames = new Map();
  globalThis.HTMLCanvasElement = FakeCanvas;
  globalThis.IntersectionObserver = FakeObserver;
  globalThis.MutationObserver = FakeObserver;
  globalThis.ResizeObserver = FakeObserver;
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia: () => media,
  };
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);

  return {
    FakeCanvas,
    documentListeners,
    frames,
    mediaListeners,
    observerInstances,
    runNextFrame(time) {
      const entry = frames.entries().next().value;
      assert.ok(entry, "expected a queued animation frame");
      const [id, callback] = entry;
      frames.delete(id);
      callback(time);
    },
  };
}

test("globe controller rotates, remains draggable while stopped, preserves its view, and cleans up", (context) => {
  const dom = installGlobeDom(context);
  const canvas = new dom.FakeCanvas();
  const globe = createRouteGlobe(canvas);
  const firstRoutes = [{
    id: "tokyo-to-sydney",
    nodes: [
      { id: "tokyo", name: "Tokyo_JP" },
      { id: "sydney", region: "Sydney, AU" },
    ],
    edges: [{ probe_id: "tokyo-sydney", stats: { status: "healthy" } }],
  }];

  globe.update(firstRoutes);
  dom.runNextFrame(0);
  const focusedLongitude = Number(canvas.dataset.viewLongitude);
  dom.runNextFrame(1_000);
  assert.notEqual(Number(canvas.dataset.viewLongitude), focusedLongitude);

  globe.setRotationStopped(true);
  dom.runNextFrame(2_000);
  const stoppedLongitude = Number(canvas.dataset.viewLongitude);
  dom.runNextFrame(3_000);
  assert.equal(Number(canvas.dataset.viewLongitude), stoppedLongitude);
  assert.equal(canvas.dataset.rotationStopped, "true");

  canvas.dispatchPointer("pointerdown", { clientX: 100, pointerId: 7 });
  canvas.dispatchPointer("pointermove", { clientX: 140, pointerId: 7 });
  const draggedLongitude = Number(canvas.dataset.viewLongitude);
  assert.notEqual(draggedLongitude, stoppedLongitude);
  assert.equal(canvas.dataset.dragging, "true");
  assert.equal(canvas.hasPointerCapture(7), true);
  canvas.dispatchPointer("pointerup", { clientX: 140, pointerId: 7 });
  assert.equal(canvas.dataset.dragging, "false");
  assert.equal(canvas.hasPointerCapture(7), false);

  const beforeKeyboard = Number(canvas.dataset.viewLongitude);
  canvas.dispatchPointer("keydown", { key: "ArrowRight" });
  const keyboardLongitude = Number(canvas.dataset.viewLongitude);
  assert.notEqual(keyboardLongitude, beforeKeyboard);

  globe.update([{
    id: "new-york-to-london",
    nodes: [
      { id: "new-york", region: "New York, US" },
      { id: "london", region: "London, GB" },
    ],
    edges: [{ probe_id: "new-york-london", stats: { status: "healthy" } }],
  }]);
  assert.equal(Number(canvas.dataset.viewLongitude), keyboardLongitude);

  globe.destroy();
  assert.equal(dom.frames.size, 0);
  assert.equal(dom.mediaListeners.size, 0);
  assert.equal(dom.documentListeners.get("visibilitychange")?.size || 0, 0);
  assert.ok(dom.observerInstances.every((observer) => observer.disconnected));
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "keydown"]) {
    assert.equal(canvas.listeners.get(type)?.size || 0, 0);
  }
});

test("reduced-motion mode does not schedule continuous animation but manual drag still redraws", (context) => {
  const dom = installGlobeDom(context, { reducedMotion: true });
  const canvas = new dom.FakeCanvas();
  const globe = createRouteGlobe(canvas);
  assert.equal(dom.frames.size, 0);

  const originalLongitude = Number(canvas.dataset.viewLongitude);
  canvas.dispatchPointer("pointerdown", { clientX: 20, pointerId: 4 });
  canvas.dispatchPointer("pointermove", { clientX: 60, pointerId: 4 });
  canvas.dispatchPointer("pointerup", { clientX: 60, pointerId: 4 });
  assert.notEqual(Number(canvas.dataset.viewLongitude), originalLongitude);
  assert.equal(dom.frames.size, 0);

  globe.destroy();
});
