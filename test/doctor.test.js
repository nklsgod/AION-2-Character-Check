import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagnoseItem, itemStatus, cardLight, findings } from "../public/js/doctor.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const list = nkls.equipment.equipment.equipmentList;
const bySlot = name => list.find(e => e.slotPosName === name);
const diag = name => { const e = bySlot(name); return diagnoseItem(model, e, nkls.items[e.slotPos]); };

test("keep / replace rules", () => {
  assert.equal(diag("Torso").status, "keeper", "86 base");
  assert.equal(diag("Shoulder").status, "replace", "70 base");
  assert.equal(diag("Ring1").status, "keeper", "crafted Splendent Star Dragon Lord Ring is upgraded by transfer-craft");
  assert.equal(diag("Ring1").label, "CRAFT-UPGRADE");
  assert.equal(diag("Belt").status, "keeper");
  assert.equal(diag("Bracelet2").status, "keeper", "bracelets wait for Ludra");
  assert.equal(diag("Arcana2").status, "replace", "Legend card");
});

test("replacement names the right dungeon and piece", () => {
  const guard = diag("SubHand").actions.find(a => a.kind === "replace");
  assert.match(guard.text, /Nuakum Guard \(Ferocious Horn Den/);
  assert.match(guard.text, /3 vouchers \+ 2M Kina/);
  assert.match(diag("Earring2").actions.find(a => a.kind === "replace").text, /Enraged Kromede Earrings \(Fire Temple/);
  assert.equal(diag("SubHand").actions.find(a => a.kind === "replace").gain.min, 16 - 8, "+16 base minus the 8 item level of stones that are lost");
});

test("Arcana: Legend → Unique is +20 minus lost card levels", () => {
  const a = diag("Arcana2").actions.find(x => x.kind === "arcana");
  assert.equal(a.gain.exp, 18);
  assert.match(a.text, /Shattered Arkanis/, "Parchment comes from Arkanis");
});

test("stones: grey lines on keepers are reroll actions, the gold Attack line is locked", () => {
  const n = diag("Necklace");
  assert.equal(n.parts.stones, 4);
  assert.equal(n.actions.find(a => a.kind === "reroll").gain.exp, 9.2, "4 × (3.3 − 1)");
  assert.ok(diag("Ring2").actions.some(a => a.kind === "lock"));
  assert.equal(cardLight(diag("Belt")), "green");
});

test("findings are sorted by impact and include the Ludra stats", () => {
  const diags = list.map(e => diagnoseItem(model, e, nkls.items[e.slotPos]));
  const f = findings(model, { diags, ilvl: 2540, stats: [{ name: "Accuracy", value: null, min: 1000 }] });
  assert.ok(f.length > 3);
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].impact >= f[i].impact);
  assert.ok(f.some(x => /below item level 86/.test(x.title)));
  assert.ok(f.some(x => /Accuracy: unknown/.test(x.title)));
});
