import test from "node:test";
import assert from "node:assert/strict";
import {
  beijingSolarTimes,
  nextBeijingSolarTransition,
  themeForBeijingInstant,
} from "../public/frontend/solar-theme.js";

test("Beijing solar mode follows seasonal sunrise and sunset", () => {
  assert.equal(themeForBeijingInstant(new Date("2026-06-21T04:00:00+08:00")), "dark");
  assert.equal(themeForBeijingInstant(new Date("2026-06-21T12:00:00+08:00")), "light");
  assert.equal(themeForBeijingInstant(new Date("2026-06-21T20:30:00+08:00")), "dark");
  assert.equal(themeForBeijingInstant(new Date("2026-12-21T07:00:00+08:00")), "dark");
  assert.equal(themeForBeijingInstant(new Date("2026-12-21T12:00:00+08:00")), "light");
  assert.equal(themeForBeijingInstant(new Date("2026-12-21T18:00:00+08:00")), "dark");
});

test("Beijing solar transitions are ordered and date-aware", () => {
  const midday = new Date("2026-07-18T12:00:00+08:00");
  const { sunrise, sunset } = beijingSolarTimes(midday);
  assert.ok(sunrise < midday);
  assert.ok(sunset > midday);
  assert.equal(nextBeijingSolarTransition(midday).getTime(), sunset.getTime());
  assert.ok(nextBeijingSolarTransition(new Date("2026-07-18T23:00:00+08:00")) > sunset);
});
