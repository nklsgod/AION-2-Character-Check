import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagnoseItem } from "../public/js/doctor.js";
import * as DL from "../public/js/deadline.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const list = nkls.equipment.equipment.equipmentList;
const ctx = { diags: list.map(e => diagnoseItem(model, e, nkls.items[e.slotPos])), ilvl: 2540, boards: nkls.daevanionDetail, boardList: nkls.character.daevanion.boardList };
const now = new Date("2026-10-26T12:00");
const rich = { membership: true, kinah: 5e6, odyle: 300, ap: 300000, trainingExp: 50000, crystals: 10, fragments: 3000, centuryroot: 750, feathers: 30, pityFireTemple: 5, pityHornDen: 10 };

test("Monte Carlo is deterministic with a seed", () => {
  const a = DL.deadline(model, ctx, rich, { now, sims: 3000, seed: 11 });
  const b = DL.deadline(model, ctx, rich, { now, sims: 3000, seed: 11 });
  assert.equal(a.sim.p, b.sim.p);
  assert.equal(a.sim.p50, b.sim.p50);
  assert.equal(a.sim.mean, b.sim.mean);
});

test("empty inputs count as 0 and are listed as missing", () => {
  const d = DL.deadline(model, ctx, { membership: true }, { now, sims: 500 });
  assert.ok(d.missing.includes("Kinah") && d.missing.includes("Abyss Feathers collected (of 36)"));
  assert.ok(!d.taken.some(l => l.id.startsWith("transmute")), "no crystals, no transmute");
  assert.ok(!d.taken.some(l => l.id === "feathers"), "unknown feathers are not counted");
});

test("transmutes: one per 7-day window, cards leave the luck pool", () => {
  const d = DL.deadline(model, ctx, { ...rich, crystals: 100, kinah: 1e8 }, { now, sims: 500 });
  const t = d.taken.filter(l => l.id.startsWith("transmute"));
  assert.equal(t.length, 2, "Oct 26 and Nov 2 fit before Nov 5");
  assert.equal(d.cards.length, 0);
  const late = DL.deadline(model, ctx, { ...rich, crystals: 100, kinah: 1e8, lastTransmute: "2026-10-25" }, { now, sims: 500 });
  assert.equal(late.taken.filter(l => l.id.startsWith("transmute")).length, 1);
});

test("classes: shop and enhancement guaranteed, grey → green probable, gear drops luck", () => {
  const d = DL.deadline(model, ctx, rich, { now, sims: 500 });
  assert.equal(d.taken.find(l => l.id === "dae:nightmare").cls, "guaranteed");
  assert.ok(d.taken.some(l => l.id.startsWith("enh:") && l.cls === "guaranteed"));
  assert.ok(d.taken.some(l => l.id.startsWith("green:") && l.cls === "probable"));
  assert.ok(!d.taken.some(l => l.id === "enh:Belt:10"), "belt is at its max (+10)");
  assert.ok(!d.taken.some(l => /craft:Ring1:(94|102)/.test(l.id)), "unknown-cost crafts only up to 86");
  assert.ok(d.taken.some(l => l.id === "craft:Ring1:86"));
  assert.ok(d.guaranteed <= d.expected - d.start + 1e-9);
});

test("membership: more cubes (second opening), Odyle bought only as needed", () => {
  const a = DL.deadline(model, ctx, rich, { now, sims: 500 });
  const b = DL.deadline(model, ctx, { ...rich, membership: false }, { now, sims: 500 });
  assert.ok(a.eff.cubes > b.eff.cubes);
  assert.equal(a.odyleBuys.wb, 0, "reward counts bind, no need for Wind Breeze buys");
});
