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
const rich = { membership: true, kinah: 5e6, odyle: 300, ap: 300000, trainingExp: 50000, crystals: 10, fragments: 3000, centuryroot: 750, nightmareOpen: 50, shugoOpen: 15,
  matOdyle: 1000, matFine: 1000, matPure: 100, pityFireTemple: 5, pityHornDen: 10, "craftMat:70>78": "have", "craftMat:78>86": "have" };
const mono = { monolithStage: 3, monolithFeathers: 5, monolithMax: 9 };

test("Monte Carlo is deterministic with a seed", () => {
  const a = DL.deadline(model, ctx, rich, { now, sims: 3000, seed: 11 });
  const b = DL.deadline(model, ctx, rich, { now, sims: 3000, seed: 11 });
  assert.equal(a.sim.p, b.sim.p);
  assert.equal(a.sim.p50, b.sim.p50);
  assert.equal(a.sim.mean, b.sim.mean);
});

test("empty inputs count as 0 and are listed as missing", () => {
  const d = DL.deadline(model, ctx, { membership: true }, { now, sims: 500 });
  for (const m of ["Kinah", "Monolith stage", "Monolith max stage", "Nightmare shop buys left", "Fine Odyle", "Unspent Daevanion crystals"]) assert.ok(d.missing.includes(m), m);
  assert.ok(!d.taken.some(l => l.id.startsWith("transmute")), "no crystals, no transmute");
  assert.ok(!d.taken.some(l => l.id === "monolith"), "unknown max stage: feathers are not counted");
  assert.equal(d.eff.odyle.items.morph, 0, "no craft materials entered = no Substance Morph");
});

test("transmutes: one per 7-day window, cards leave the luck pool", () => {
  const d = DL.deadline(model, ctx, { ...rich, crystals: 100, kinah: 1e8 }, { now, sims: 500 });
  const t = d.taken.filter(l => l.id.startsWith("transmute"));
  assert.equal(t.length, 2, "Oct 26 and Nov 2 fit before Nov 5");
  assert.equal(d.cards.length, 0);
  const late = DL.deadline(model, ctx, { ...rich, crystals: 100, kinah: 1e8, lastTransmute: "2026-10-25" }, { now, sims: 500 });
  assert.equal(late.taken.filter(l => l.id.startsWith("transmute")).length, 1);
});

test("classes: shop and +10 guaranteed, +11 and up probable, grey → green probable", () => {
  const d = DL.deadline(model, ctx, { ...rich, kinah: 1e8 }, { now, sims: 500 });
  assert.equal(d.taken.find(l => l.id === "dae:nightmare").cls, "guaranteed");
  assert.equal(d.taken.find(l => l.id === "enh:Pants:10").cls, "guaranteed");
  assert.equal(d.taken.find(l => l.id === "enh:Pants:11").cls, "probable");
  assert.ok(d.taken.some(l => l.id.startsWith("green:") && l.cls === "probable"));
  assert.ok(!d.taken.some(l => l.id === "enh:Belt:10"), "belt is at its max (+10)");
  const order = id => d.taken.findIndex(l => l.id === id);
  assert.ok(order("enh:Pants:11") > order("green:Necklace"), "probable enhancement after stones");
  assert.ok(order("enh:Pants:11") > order("transmute:Arcana2"), "and after transmute");
  assert.ok(d.guaranteed <= d.expected - d.start + 1e-9);
});

test("craft ladder: only steps with materials on hand are guaranteed, the rest is blocked", () => {
  const d = DL.deadline(model, ctx, rich, { now, sims: 500 });
  assert.ok(d.taken.some(l => l.id === "craft:Ring1:86"));
  assert.ok(!d.taken.some(l => /craft:Ring1:(94|102)/.test(l.id)), "materials unknown");
  assert.match(d.blocked.find(l => l.id === "craft:Ring1:94").blocked, /materials unknown/);
  assert.equal(d.blocked.find(l => l.id === "craft:Ring1:102").blocked, "needs the step before it");
  const miss = DL.deadline(model, ctx, { ...rich, "craftMat:70>78": "missing" }, { now, sims: 500 });
  assert.ok(!miss.taken.some(l => l.id.startsWith("craft:")), "first step missing blocks the whole ladder");
  assert.match(miss.blocked.find(l => l.id === "craft:Ring1:78").blocked, /materials missing/);
});

test("monolith: feathers are guaranteed (time only), 4 Azphel crystals per stage", () => {
  const d = DL.deadline(model, ctx, { ...rich, ...mono }, { now, sims: 500 });
  const m = d.taken.find(l => l.id === "monolith");
  assert.equal(m.cls, "guaranteed");
  assert.equal(m.gain, 24, "6 stages × 4");
  assert.match(m.label, /115 Abyss Feathers in Reshanta/, "6 × 20 − 5");
  assert.ok(!d.missing.includes("Monolith max stage"));
  assert.ok(DL.mustHappen(model, d).some(x => x.id === "monolith"));
});

test("unspent crystals: spent first; Ariel only with the board unlocked", () => {
  const d = DL.deadline(model, ctx, { ...rich, invDaevanion: 3, invAzphel: 2, invAriel: 5, arielFragments: 250 }, { now, sims: 500 });
  const m = DL.mustHappen(model, d);
  assert.equal(m[0].id, "spend:crystals");
  assert.equal(m[0].gain, 5, "3 Daevanion + 2 Azphel, Ariel locked");
  assert.ok(d.info.some(i => i.id === "ariel:locked" && /7 Ariel/.test(i.label)), "5 + 250/100");
  const open = { ...ctx, boardList: [...ctx.boardList, { id: 99, name: "Ariel" }] };
  assert.equal(DL.deadline(model, open, { ...rich, invAriel: 5, arielFragments: 250 }, { now, sims: 500 }).taken.find(l => l.id === "spend:crystals").gain, 7);
});

test("shops: open buys cap the Daevanion crystals", () => {
  const oct = DL.deadline(model, ctx, { ...rich, nightmareOpen: 4, shugoOpen: 2, centuryroot: 1e5, date: "2026-10-31T18:00" }, { now, sims: 500 });
  assert.equal(oct.taken.find(l => l.id === "dae:nightmare").gain, 4);
  assert.equal(oct.taken.find(l => l.id === "dae:shugo").gain, 2, "no 1st of the month before Oct 31");
  const nov = DL.deadline(model, ctx, { ...rich, nightmareOpen: 0, shugoOpen: 2, centuryroot: 1e5 }, { now, sims: 500 });
  assert.ok(!nov.taken.some(l => l.id === "dae:nightmare"), "shop bought out");
  assert.equal(nov.taken.find(l => l.id === "dae:shugo").gain, 17, "2 left now + 15 on Nov 1");
});

test("Transcendence: stored counts per dungeon, cards only from their dungeon", () => {
  const d = DL.deadline(model, ctx, { ...rich, counts: { "Deus Research Base": 5 } }, { now, sims: 500 });
  assert.equal(d.eff.counts.transcendence["Deus Research Base"], 5);
  assert.equal(d.eff.counts.transcendence["Shattered Arkanis"], 0);
  for (const c of d.cards) for (const dun of Object.keys(c.p)) assert.ok(model.arcana.drops.stage4.cardTypes[dun].includes(c.type));
  for (const [dun, n] of Object.entries(d.cubes.runs)) if (n) assert.ok(d.cards.some(c => c.p[dun]), `${dun} runs only when a card can drop there`);
});

test("AP use: Stigma Shards skip the Azphel crystals and keep the AP", () => {
  const c = DL.compareAp(model, ctx, { ...rich, ap: 3e6 }, { now, sims: 500 });
  assert.ok(c.azphel.taken.some(l => l.id.startsWith("dae:azphel")));
  assert.ok(!c.stigma.taken.some(l => l.id.startsWith("dae:azphel")));
  assert.ok(c.stigma.apLeft > c.azphel.apLeft);
  assert.ok(c.stigma.expected <= c.azphel.expected);
  assert.equal(c.shards, null, "rate unknown in the config");
});

test("membership: more cubes (second opening), Odyle bought only as needed", () => {
  const a = DL.deadline(model, ctx, rich, { now, sims: 500 });
  const b = DL.deadline(model, ctx, { ...rich, membership: false }, { now, sims: 500 });
  assert.ok(a.eff.cubes > b.eff.cubes);
  assert.equal(a.odyleBuys.wb, 0, "reward counts bind, no need for Wind Breeze buys");
});

test("membership: without is never ahead of with", () => {
  const cases = [rich, { membership: true }, { ...rich, kinah: 0 }, { ...rich, date: "2026-10-28T12:00" }, { ...rich, ...mono, ap: 3e6 }, { ...rich, apUse: "stigma", matPure: 0 }];
  for (const inp of cases) {
    const c = DL.compareMembership(model, ctx, inp, { now, sims: 1000 });
    assert.ok(c.without.expected <= c.with.expected, `expected: ${c.without.expected} > ${c.with.expected}`);
    assert.ok(c.without.sim.p <= c.with.sim.p);
    assert.equal(c.with.membership, true);
    assert.equal(c.without.membership, false);
  }
});
