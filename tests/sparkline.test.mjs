import test from "node:test";
import assert from "node:assert/strict";
import { renderSparkline } from "../public/sparkline.js";

const formatLatency = (value) => `${value} ms`;

test("renders an explicit collecting indicator for one latency sample", () => {
  const markup = renderSparkline([{ time: "2026-07-17T00:00:00Z", value: 13 }], "healthy", formatLatency);

  assert.match(markup, /class="sparkline\s+is-collecting"/);
  assert.match(markup, /class="spark-guide"/);
  assert.match(markup, /class="spark-point"/);
  assert.match(markup, /one sample at 13 ms/);
  assert.doesNotMatch(markup, /class="spark-area"/);
});

test("keeps the empty baseline distinct from the one-sample state", () => {
  const markup = renderSparkline([], "healthy", formatLatency);

  assert.match(markup, /No latency trend available/);
  assert.doesNotMatch(markup, /is-collecting/);
  assert.doesNotMatch(markup, /spark-point/);
});

test("renders the normal trend once two valid samples are available", () => {
  const markup = renderSparkline(
    [
      { time: "2026-07-17T00:00:00Z", value: 12 },
      { time: "2026-07-17T00:00:30Z", value: 13 },
    ],
    "warning",
    formatLatency,
  );

  assert.match(markup, /class="sparkline is-warning"/);
  assert.match(markup, /class="spark-area"/);
  assert.match(markup, /class="spark-line"/);
  assert.doesNotMatch(markup, /is-collecting/);
});

test("escapes localized labels before inserting them into SVG markup", () => {
  const hostileLabel = `Latency "fast" <script>alert('x')</script> & rising`;
  const expected = "Latency &quot;fast&quot; &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; rising";
  const labels = {
    empty: hostileLabel,
    collecting: () => hostileLabel,
    range: () => hostileLabel,
  };

  const empty = renderSparkline([], "healthy", formatLatency, labels);
  const collecting = renderSparkline([{ value: 13 }], "healthy", formatLatency, labels);
  const range = renderSparkline([{ value: 12 }, { value: 13 }], "healthy", formatLatency, labels);

  assert.ok(empty.includes(`aria-label="${expected}"`));
  assert.ok(collecting.includes(`aria-label="${expected}"`));
  assert.ok(collecting.includes(`<title>${expected}</title>`));
  assert.ok(range.includes(`aria-label="${expected}"`));
  for (const markup of [empty, collecting, range]) {
    assert.doesNotMatch(markup, /<script>/);
    assert.doesNotMatch(markup, /aria-label="[^"]*"fast"/);
  }
});
