import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { odyleBudget, resetsBetween, rewardCounts, effectiveCubes, transmuteDates, kinahBudget, rng } from "../public/js/budget.js";

const model = JSON.parse(readFileSync(new URL("../public/guide/ilvl-model.json", import.meta.url), "utf8"));

test("Odyle with membership, Oct 26 noon → Nov 25: regen 3,540, event 1,120, items per started week", () => {
  const o = odyleBudget(model, { membership: true }, "2026-10-26T12:00", "2026-11-25T00:00");
  assert.equal(o.parts.regen, 3540, "15 per 3 h");
  assert.equal(o.parts.event, 1120, "2 items × 40 for Oct 28 – Nov 10, not doubled regen");
  assert.equal(o.windows, 5, "this week + resets Oct 28, Nov 4, 11, 18");
  assert.equal(o.parts.windBreeze, 5 * 20 * 40);
  assert.equal(o.parts.morph, 5 * 20 * 40);
  assert.equal(o.kinah.windBreeze, 100 * 100000);
});

test("weekly limits across a reset: limits already used this week are subtracted", () => {
  const before = odyleBudget(model, { membership: true }, "2026-10-26T12:00", "2026-10-28T05:00");
  assert.equal(before.windows, 1, "no reset yet");
  const across = odyleBudget(model, { membership: true, windBreezeBoughtThisWeek: 20, morphCraftedThisWeek: 20 }, "2026-10-26T12:00", "2026-10-29T00:00");
  assert.equal(across.windows, 2);
  assert.equal(across.items.windBreeze, 20, "only the new week's 20");
  assert.deepEqual(resetsBetween(model, new Date("2026-10-26T12:00"), new Date("2026-11-05T18:00")).map(d => d.getDate()), [28, 4]);
});

test("without membership: no Wind Breeze, one cube opening per clear", () => {
  const o = odyleBudget(model, { membership: false }, "2026-10-26T12:00", "2026-11-05T18:00");
  assert.equal(o.parts.windBreeze, 0);
  assert.equal(o.cap, 560);
  assert.equal(rewardCounts(model, {}, "2026-10-26T12:00", "2026-11-05T18:00").opens, 1);
  assert.equal(rewardCounts(model, { membership: true }, "2026-10-26T12:00", "2026-11-05T18:00").opens, 2);
});

test("effective cubes: the smaller of Odyle and reward counts, and which binds", () => {
  const e = effectiveCubes(model, { membership: true, odyle: 100000 }, "2026-10-26T12:00", "2026-10-27T12:00");
  assert.equal(e.binding, "reward counts");
  assert.equal(e.cubes, (2 + 2 + 2) * 2, "1 day: Fire Temple 2 + Horn Den 2 + Transcendence 2, opened twice");
});

test("Substance Morph: craft materials cap it once entered", () => {
  const free = odyleBudget(model, {}, "2026-10-26T12:00", "2026-11-05T18:00");
  assert.equal(free.items.morph, 60, "not entered = weekly limit only (calculator): 3 weekly windows × 20");
  const mats = odyleBudget(model, { matOdyle: 100, matFine: 50, matPure: 30 }, "2026-10-26T12:00", "2026-11-05T18:00");
  assert.equal(mats.items.morph, 4, "100 Odyle / 25");
  assert.equal(odyleBudget(model, { matOdyle: 1e4, matFine: 1e4 }, "2026-10-26T12:00", "2026-11-05T18:00").items.morph, 0, "no Pure Odyle");
});

test("transmute cooldown: at most one per 7-day window", () => {
  assert.equal(transmuteDates(model, {}, "2026-10-26T12:00", "2026-11-05T18:00").length, 2);
  assert.equal(transmuteDates(model, { lastTransmute: "2026-10-25" }, "2026-10-26T12:00", "2026-11-05T18:00").length, 1, "next one Nov 1");
  assert.equal(transmuteDates(model, {}, "2026-10-26T12:00", "2026-11-02T11:00").length, 1);
});

test("Kinah: daily cap per day plus alts", () => {
  const k = kinahBudget(model, { kinah: 500000, kinahPerDayAlts: 200000 }, "2026-10-26T00:00", "2026-10-28T00:00");
  assert.equal(k.total, 500000 + 2000000 + 400000);
});

test("seeded random is repeatable", () => {
  const a = rng(42), b = rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
