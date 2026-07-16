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
