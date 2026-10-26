// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findStat, same, sameTitle, ilvlBreakdown, boardPoints } from "../public/js/core.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const model = load("../public/guide/ilvl-model.json");
const nkls = load("./fixtures/nkls.json");
const statList = nkls.character.stat.statList;

test("item level from its parts matches the game (nkls: 2,540)", () => {
  const boardIds = nkls.character.daevanion.boardList.map(b => b.id);
  const r = ilvlBreakdown(model, {
    statList, equipmentList: nkls.equipment.equipment.equipmentList,
    items: nkls.items, boards: nkls.daevanionDetail, boardIds,
  });
  assert.equal(r.api, 2540);
  assert.ok(r.complete, "every item and board is in the fixture");
  assert.deepEqual(r.parts, { gear: 1428, enchant: 200, amplification: 0, stones: 128, arcana: 366, daevanion: 412 });
  assert.ok(Math.abs(r.unexplained) <= 10, `unexplained ${r.unexplained} should stay within ±10`);
});

test("Daevanion node costs: Common 1, Rare 2, Legend 3, Unique 4, Start free", () => {
  assert.equal(boardPoints(model, nkls.daevanionDetail[71]), 96);
  assert.equal(boardPoints(model, { nodeList: [{ type: "Start", grade: "None", open: 1 }, { type: "Stat", grade: "Unique", open: 1 }, { type: "Stat", grade: "Legend", open: 0 }] }), 4);
});

test("Accuracy and Critical Hit never read the item-level row (regression: both showed 2540)", () => {
  assert.equal(findStat(statList, "ItemLevel")?.value, 2540);
  assert.equal(findStat(statList, "Accuracy"), undefined, "NCSOFT doesn't send Accuracy");
  assert.equal(findStat(statList, "Critical Hit"), undefined);
  assert.equal(findStat(statList, "Crit"), undefined);
  const withEmpty = [{ type: "ItemLevel", name: "아이템레벨", value: 1810 }, { type: "", name: "", value: 7 }, { value: 3 }, { type: "Accuracy", name: "Accuracy", value: 870 }];
  assert.equal(findStat(withEmpty, "Accuracy")?.value, 870);
});

test("empty strings never match", () => {
  assert.equal(same("", "Accuracy"), false);
  assert.equal(same("아이템레벨", "Critical Hit"), false);
});

test("title names are matched tolerantly", () => {
  const owned = nkls.character.title.titleList;
  assert.ok(owned.some(o => sameTitle(o.name, "Through Hell and Back")));
  assert.ok(owned.some(o => sameTitle(o.name, "Through Heaven Back")), "old guide spelling");
  assert.ok(sameTitle("Through Hell & Back", "Through Hell and Back"));
  assert.equal(sameTitle("Saint", "Saint of Altgard"), false);
});
