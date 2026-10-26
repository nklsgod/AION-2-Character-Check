import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { diagnoseItem, craftedInfo } from "../public/js/doctor.js";
import { upgrades } from "../public/js/calc.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const list = nkls.equipment.equipment.equipmentList;
const by = n => list.find(e => e.slotPosName === n);
const diag = n => diagnoseItem(model, by(n), nkls.items[by(n).slotPos]);

test("Splendent Star Dragon Lord Ring (70, +12): CRAFT-UPGRADE, 78 is +8, 86 is +16 in total", () => {
  const d = diag("Ring1");
  assert.equal(d.e.name, "Splendent Star Dragon Lord Ring");
  assert.equal(d.e.enchantLevel, 12);
  assert.equal(d.label, "CRAFT-UPGRADE");
  assert.equal(d.craft.steps[0].to, 78);
  assert.equal(d.craft.steps[0].gain, 8);
  assert.equal(d.craft.steps[1].to, 86);
  assert.equal(d.craft.steps[1].total, 16);
  assert.ok(!d.actions.some(a => a.kind === "noInvest" || a.kind === "replace"), "no 'being replaced' warning on crafted gear");
  assert.match(d.actions.find(a => a.kind === "craft").text, /enhancement \+12/);
});

test("ladder override from the UI is used", () => {
  const m = { ...model, crafting: { ...model.crafting, ladderOverride: [70, 78, 86, 104] } };
  const c = craftedInfo(m, by("Ring1"), nkls.items[by("Ring1").slotPos]);
  assert.deepEqual(c.steps.map(s => s.to), [78, 86, 104]);
});

test("Aulamus Ring (not crafted) shows the drop and the craft way", () => {
  const d = diag("Ring2");
  assert.equal(d.e.name, "Aulamus Ring");
  assert.equal(d.status, "replace");
  assert.ok(d.actions.some(a => a.kind === "replace" && /Fire Temple/.test(a.text)));
  assert.ok(d.actions.some(a => a.kind === "craftAlt" && /70 → 78 → 86/.test(a.text)));
});

test("crafted steps are guaranteed gear upgrades; unknown costs are not priced", () => {
  const u = upgrades(model, { diags: list.map(e => diagnoseItem(model, e, nkls.items[e.slotPos])), ilvl: 2540, inputs: {} });
  const c = u.find(x => x.id === "craft:Ring1:78");
  assert.equal(c.random, false);
  assert.equal(c.known, false, "costs are unknown until filled in");
  assert.equal(u.find(x => x.id === "craft:Ring1:86").after, "craft:Ring1:78");
});
