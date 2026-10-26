import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as B from "../public/js/build.js";
import { diagnoseItem } from "../public/js/doctor.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const K = load("../public/guide/cleric-knowledge.json");
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const list = nkls.equipment.equipment.equipmentList, items = nkls.items;
const bySlot = n => list.find(e => e.slotPosName === n);

test("titles: faction names, slot and fallback (nkls is Asmodian)", () => {
  const t = Object.fromEntries(B.titleCheck(K, nkls.character.profile, nkls.character.title.titleList).map(x => [x.slot, x]));
  assert.equal(t.Attack.equipped, "Guardian of Altgard");
  assert.equal(t.Attack.rank, 1, "fallback behind Unbound by Genus");
  assert.equal(t.Defense.ok, true, "Saint of Altgard is best in slot");
  assert.equal(t.Etc.rank, 1, "Through Hell and Back until Empty Closet");
});

test("titles: Elyos get Verteron, and the other faction's name doesn't count", () => {
  const ely = B.titleCheck(K, { raceName: "Elyos" }, [{ name: "Guardian of Verteron", equipCategory: "Attack" }, { name: "Saint of Altgard", equipCategory: "Defense" }]);
  assert.equal(ely[0].rank, 1);
  assert.equal(ely[0].chain[1].name, "Guardian of Verteron");
  assert.equal(ely[1].offList, true, "Altgard title on an Elyos is not the Elyos name");
  const none = B.titleCheck(K, { raceName: "Asmodians" }, [{ name: "Nice to Meet You", equipCategory: "Attack" }]);
  assert.equal(none[0].rank, 2);
});

test("soul binding: target / neutral / bad and the rebind rule", () => {
  const S = slot => B.soulBindingReport(K, bySlot(slot), items[bySlot(slot).slotPos], diagnoseItem(model, bySlot(slot), items[bySlot(slot).slotPos]).status);
  const gloves = S("Gloves");
  assert.equal(gloves.lines.find(l => l.name === "Combat Speed").rating, "target");
  assert.equal(gloves.lines.find(l => l.name === "Natural MP Regen").rating, "bad");
  assert.equal(gloves.rebind, true);
  assert.equal(S("Shoulder").rebind, false, "replace items are never rebound");
  assert.equal(S("Bracelet1").rebind, false, "bracelets wait for Ludra");
  assert.equal(B.rateSoulLine(K, "Greaves", { name: "Weapon Damage Tolerance" }).rating, "neutral", "word match, not substring");
  assert.equal(B.rateSoulLine(K, "Greaves", { name: "Damage Tolerance" }).rating, "target");
  assert.equal(B.rateSoulLine(K, "Mace", { name: "PvP Attack" }).rating, "bad");
  assert.ok(B.rateSoulLine(K, "Breastplate", { name: "Accuracy" }).endgame, "Whelps: endgame line, don't commit yet");
  assert.deepEqual(S("Ring1").missingRequired, ["Condemnation"]);
  assert.equal(S("Helmet").skills.find(k => k.name === "Empyrean Lords' Benediction").rating, "bad");
});

test("manastones: gold Attack locks, PvP and bad stats go first at equal grade", () => {
  const r = B.stoneReport(K, items[bySlot("Ring2").slotPos].magicStoneStat);
  assert.ok(r.rated.some(s => s.rating === "lock" && s.name === "Attack"));
  assert.ok(r.done.whelps);
  const g = B.stoneReport(K, items[bySlot("SubHand").slotPos].magicStoneStat);
  assert.equal(g.pvp.length, 2, "PvP Evasion and PvP Attack on the guard");
});

test("Condemnation: 18 = base 10 + Daevanion 4 + weapon 1 + Chalice 2 + Parchment 1", () => {
  const c = B.skillSum(K, { skillList: nkls.equipment.skill.skillList, equipmentList: list, items, boards: nkls.daevanionDetail });
  assert.equal(c.total, 18);
  assert.equal(c.daevanion, 4);
  assert.equal(c.gear, 4);
  assert.equal(c.base, 10);
  assert.equal(c.missing, 2);
  assert.equal(c.cardPaths[0].slot, "Arcana1", "Chalice first");
});

test("Arcana checker on nkls: families and stats fit, useless lines flagged, Bell below +3", () => {
  const a = Object.fromEntries(list.filter(e => e.slotPos >= 41).map(e => { const c = B.arcanaCheck(K, e, items[e.slotPos]); return [c.type, c]; }));
  for (const c of Object.values(a)) { assert.ok(c.familyOk, c.type); assert.ok(c.statOk, c.type); assert.ok(c.hasTarget, c.type); }
  assert.deepEqual(a.Chalice.useless.map(u => u.name), ["Empyrean Lords' Benediction", "Heal Block"]);
  assert.equal(a.Bell.targetOk, false);
  assert.deepEqual(B.arcanaSet(K, Object.values(a)).vigor, 2);
});

test("Daevanion: 25 Max MP nodes open; stigma preset is 'no Chanter'", () => {
  assert.equal(B.daevanionWarnings(K, nkls.daevanionDetail)[0].count, 25);
  assert.equal(B.stigmaPreset(K, nkls.equipment.skill.skillList).match, "noChanter");
});
