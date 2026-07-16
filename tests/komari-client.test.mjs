import test from "node:test";
import assert from "node:assert/strict";
import { KomariClient } from "../lib/komari-client.mjs";

test("retries Komari PostgreSQL ping queries without task_id", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("task_id=")) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Failed to fetch ping records: ERROR: operator does not exist: text ->> unknown (SQLSTATE 42883)",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          records: [{ task_id: 1, time: "2026-07-16T01:00:00Z", value: 59 }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const client = new KomariClient({ baseUrl: "https://status.example.com/" });
  const payload = await client.getPingRecords({ uuid: "node-a", taskId: 1, hours: 1 });
  assert.equal(payload.records[0].value, 59);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /task_id=1/);
  assert.doesNotMatch(urls[1], /task_id=/);
});
