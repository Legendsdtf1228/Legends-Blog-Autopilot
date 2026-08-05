import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { dueSlots } from "../src/scheduler.js";
import { defaultSettings } from "../src/defaults.js";

test("daily creates one due slot after the configured time", () => {
  const now = DateTime.fromISO("2026-08-05T14:00:00", { zone: "America/New_York" });
  const slots = dueSlots(now, { ...defaultSettings, enabled: true, cadence: "daily", firstTime: "09:00" });
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.key, "2026-08-05:1");
});

test("twice daily does not queue the future afternoon slot", () => {
  const now = DateTime.fromISO("2026-08-05T10:00:00", { zone: "America/New_York" });
  const slots = dueSlots(now, { ...defaultSettings, enabled: true, cadence: "twice_daily", firstTime: "09:00", secondTime: "16:00" });
  assert.deepEqual(slots.map(s => s.key), ["2026-08-05:1"]);
});

test("paused autopilot creates no slots", () => {
  assert.deepEqual(dueSlots(DateTime.utc(), { ...defaultSettings, enabled: false }), []);
});
