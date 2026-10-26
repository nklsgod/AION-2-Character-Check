import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagnoseItem } from "../public/js/doctor.js";
import { expectedAttempts, rollUntil, expectedRoll, atLeastOnce, upgrades, rank, plan, odyleBudget } from "../public/js/calc.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const list = nkls.equipment.equipment.equipmentList;
const ctx = inputs => ({
  diags: list.map(e => diagnoseItem(model, e, nkls.items[e.slotPos])), ilvl: 2540, inputs,
  boards: nkls.daevanionDetail, boardList: nkls.character.daevanion.boardList,
});

test("probability helpers", () => {
  assert.equal(expectedAttempts(1), 1);
  assert.ok(Math.abs(expectedAttempts(0.5) - 2) < 1e-6, "no pity: 1/p");
  assert.ok(expectedAttempts(0.35, 0.05) < 1 / 0.35, "pity shortens it");
  assert.ok(Math.abs(expectedRoll(model, "Intermediate") - 1.65) < 1e-9, "user's expected value");
  assert.ok(Math.abs(expectedRoll(model, "Superior") - 2.65) < 1e-9);
  assert.ok(Math.abs(rollUntil(model, "Superior", "Legend").value - 3.3) < 1e-9, "reroll to ≥ Legend: 3.3");
  assert.ok(Math.abs(atLeastOnce(0.02, 28) - (1 - 0.98 ** 28)) < 1e-12);
});

test("upgrades for nkls: base Daevanion gap, Azphel tiers, card swaps", () => {
  const u = upgrades(model, ctx({ transcendenceRuns: 10 }));
  const base = u.find(x => x.id === "dae:base");
  assert.equal(base.gain.exp, 416 - 384, "Nezekan 96 + Zikel 100 + Vaizel 92 + Triniel 96 = 384");
  assert.ok(u.some(x => x.id.startsWith("dae:azphel")));
  assert.equal(u.find(x => x.id === "card:Arcana2").gain.max, 18);
  assert.ok(u.find(x => x.id === "card:Arcana2").chance.value > 0);
  const r = rank(u);
  assert.equal(r[0].random, false, "guaranteed gains first");
});

test("plan: unlimited resources take everything known; Kinah limits stone work", () => {
  const all = plan(model, upgrades(model, ctx({})), { odyle: 100000 });
  assert.ok(all.total.exp > 100);
  assert.ok(all.taken.some(t => t.id.startsWith("dae:azphel")), "Azphel tiers after an already bought tier");
  const poor = plan(model, upgrades(model, ctx({})), { kinah: 0, odyle: 0, ap: 0, trainingExp: 0 });
  assert.equal(poor.byLever.stones.exp, 0);
  assert.equal(poor.byLever.gear.exp, 0, "no cubes, no gear");
  assert.ok(poor.byLever.daevanion.exp >= 32, "shop crystals are not priced in tracked resources");
  // one option per socket group
  const ids = all.taken.map(t => t.group).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size);
});

test("Odyle budget: regen 15 per 3 h, event doubles it", () => {
  const now = new Date("2026-10-28T00:00:00");
  const a = odyleBudget(model, { odyle: 100, targetDate: "2026-11-04" }, now);
  assert.equal(a.regen, 7 * 8 * 15);
  assert.equal(a.cubes, Math.floor((100 + 840) / 40));
  const b = odyleBudget(model, { odyle: 100, targetDate: "2026-11-04", event: true }, now);
  assert.equal(b.total, 100 + 2 * 840);
});
