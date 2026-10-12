import test from "node:test";
import assert from "node:assert/strict";
import { cutoffDate } from "../scripts/songkick/sync.mjs";

test("cutoffDate is one day before the UTC date so tonight's shows in the Americas survive the 04:17 UTC run", () => {
  assert.equal(cutoffDate(new Date("2026-10-12T04:17:00Z")), "2026-10-11");
  assert.equal(cutoffDate(new Date("2026-03-01T00:00:00Z")), "2026-02-28");
  assert.equal(cutoffDate(new Date("2027-01-01T12:00:00Z")), "2026-12-31");
});
