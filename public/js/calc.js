// Upgrade ranking and the "path to 2,800" calculator. Pure functions, no DOM.
import { same, boardPoints } from "./core.js";
import { cardType } from "./doctor.js";
import { effectiveCubes, kinahBudget, toDate } from "./budget.js";

export const LEVERS = ["stones", "arcana", "gear", "daevanion", "enhance"];
const r1 = x => Math.round(x * 10) / 10;

// Expected tries until success when each failure adds `pity` to the chance (no level loss).
export function expectedAttempts(p0, pity = 0) {
  let e = 0, reach = 1, p = p0;
  for (let k = 0; k < 1000 && reach > 1e-9; k++) { e += reach; reach *= 1 - Math.min(1, p); p += pity; }
  return e;
}
// Rolling one stone type until the line is at least `minGrade`: chance per roll and the expected grade value then.
export function rollUntil(model, type, minGrade) {
  const odds = model.stone.types[type].odds, v = model.stone.byGrade, min = v[minGrade];
  const ok = Object.entries(odds).filter(([g]) => v[g] >= min);
  const p = ok.reduce((n, [, q]) => n + q, 0);
  return { p, rolls: p ? 1 / p : Infinity, value: p ? ok.reduce((n, [g, q]) => n + v[g] * q, 0) / p : 0 };
}
export const expectedRoll = (model, type) => Object.entries(model.stone.types[type].odds).reduce((n, [g, q]) => n + model.stone.byGrade[g] * q, 0);
// Chance of at least one hit in n tries.
export const atLeastOnce = (p, n) => 1 - Math.pow(1 - p, Math.max(0, n));

export function effort(model, cost = {}) {
  return Object.entries(cost).reduce((n, [k, v]) => n + (v || 0) / (model.effort[k] || 1), 0);
}

// Every upgrade we can price for this character.
// ctx: { equipmentList, items, diags, boards, boardList, ilvl, inputs: { pityFireTemple, pityHornDen, transcendenceRuns } }
export function upgrades(model, ctx) {
  const { diags = [], inputs = {} } = ctx;
  const out = [];
  const up = o => out.push({ random: false, known: true, cost: {}, ...o });
  const inter = model.stone.types.Intermediate.kinah, sup = model.stone.types.Superior.kinah;

  for (const d of diags) {
    const e = d.e, slot = e.slotPosName;
    if (d.status === "keeper" && !/arcana/i.test(d.why)) {
      if (d.empty) {
        const ei = expectedRoll(model, "Intermediate"), es = expectedRoll(model, "Superior");
        up({ id: `fill-i:${slot}`, group: `fill:${slot}`, lever: "stones", label: `${slot}: fill ${d.empty} socket${d.empty > 1 ? "s" : ""} (Intermediate)`, gain: { min: d.empty, exp: r1(d.empty * ei), max: d.empty * 3 }, cost: { kinah: d.empty * inter }, random: true, time: "now" });
        up({ id: `fill-s:${slot}`, group: `fill:${slot}`, lever: "stones", label: `${slot}: fill ${d.empty} socket${d.empty > 1 ? "s" : ""} (Superior)`, detail: "Fubgun keeps Superior stones for item-level-102 gear.", gain: { min: d.empty * 2, exp: r1(d.empty * es), max: d.empty * 4 }, cost: { kinah: d.empty * sup }, random: true, time: "now" });
      }
      for (const [grade, minGrade] of [["Common", "Legend"], ["Rare", "Legend"]]) {
        const lines = d.stones.filter(s => s.grade === grade);
        if (!lines.length) continue;
        const now = model.stone.byGrade[grade];
        const ri = rollUntil(model, "Intermediate", minGrade), rs = rollUntil(model, "Superior", minGrade);
        const tag = grade === "Common" ? "grey" : "green";
        up({ id: `reroll-i:${grade}:${slot}`, group: `reroll:${grade}:${slot}`, lever: "stones", label: `${slot}: reroll ${lines.length} ${tag} line${lines.length > 1 ? "s" : ""} to blue (Intermediate)`, detail: `about ${Math.round(ri.rolls)} rolls per line (${Math.round(ri.p * 100)}% blue)`,
          gain: { min: 0, exp: r1(lines.length * (ri.value - now)), max: lines.length * (ri.value - now) }, cost: { kinah: Math.round(lines.length * ri.rolls * inter) }, random: true, time: "now" });
        up({ id: `reroll-s:${grade}:${slot}`, group: `reroll:${grade}:${slot}`, lever: "stones", label: `${slot}: reroll ${lines.length} ${tag} line${lines.length > 1 ? "s" : ""} to blue+ (Superior)`, detail: `about ${Math.round(rs.rolls)} rolls per line`,
          gain: { min: 0, exp: r1(lines.length * (rs.value - now)), max: lines.length * (4 - now) }, cost: { kinah: Math.round(lines.length * rs.rolls * sup) }, random: true, time: "now" });
      }
      // Enhancement steps we have prices for
      const tbl = model.enhance.attempts;
      for (let lv = e.enchantLevel || 0; tbl[lv] && lv < (d.it.maxEnchantLevel ?? Infinity); lv++) {
        const a = expectedAttempts(tbl[lv].chance, model.enhance.pityPerFail);
        up({ id: `enh:${slot}:${lv}`, lever: "enhance", label: `${slot}: +${lv} → +${lv + 1}`, detail: `${Math.round(tbl[lv].chance * 100)}% per try, about ${r1(a)} tries${lv >= model.gear.maxUsefulEnchant ? " — past +11 is expensive for 1 item level" : ""}`,
          gain: { min: 1, exp: 1, max: 1 }, cost: { kinah: Math.round(a * tbl[lv].kinah) }, random: true, time: "now", after: lv > (e.enchantLevel || 0) ? `enh:${slot}:${lv - 1}` : null });
      }
      if ((e.enchantLevel || 0) < model.amplification.needs && /main|sub|weapon|guard|off/i.test(slot) && (d.it.level ?? 0) >= model.gear.keeperBase)
        up({ id: `amp:${slot}`, lever: "enhance", label: `${slot}: +15 Amp 2`, detail: "Needs +15 first (cost from +13 unknown), then Amp 1 (66%, 6 stones, ~600k) and Amp 2 (9 stones, ~900k). Not counted in the calculator.", gain: { min: 10, exp: 10, max: 10 }, cost: { kinah: 1500000 }, random: true, known: false, time: "weeks" });
    }
    if (d.craft) d.craft.steps.forEach((x, i) => up({ id: `craft:${slot}:${x.to}`, lever: "gear", label: `${slot}: transfer-craft ${x.from} → ${x.to}`, detail: `${x.names.join(" / ")}; 100% success; Kinah ${x.cost?.kinah?.toLocaleString() ?? "unknown"}, materials ${x.cost?.materials?.map(m => m.name).join(", ") || "unknown"}`,
      gain: { min: x.gain, exp: x.gain, max: x.gain }, cost: x.known ? { kinah: x.cost.kinah } : {}, known: x.known, craft: true, time: "now", after: i ? `craft:${slot}:${x.from}` : null }));
    if (d.status === "replace" && d.actions.some(a => a.kind === "replace")) {
      const a = d.actions.find(x => x.kind === "replace");
      const src = d.source, isGuard = /sub|off|guard/i.test(slot);
      up({ id: `gear:${slot}`, lever: "gear", label: `${slot} → item level ${model.gear.keeperBase}`, detail: a.text, dungeon: src?.name, guard: isGuard,
        gain: a.gain, cost: isGuard ? { kinah: model.gear.drops.guard.kinah } : {}, cubes: (isGuard ? model.gear.drops.guard.vouchers : 1) * model.gear.drops.pityClaims, time: "cubes" });
    }
    if (/arcana/i.test(d.why)) {
      const type = d.type, lvl = e.enchantLevel || 0;
      const grade = d.it.grade, max = d.it.maxEnchantLevel ?? model.arcana.maxLevel[grade];
      const table = model.arcana.exp[grade];
      if (table && lvl < max) {
        const exp = table.slice(lvl, max).reduce((a, b) => a + b, 0);
        up({ id: `card-lv:${slot}`, lever: "arcana", label: `${type}: level +${lvl} → +${max}`, detail: `${exp.toLocaleString()} EXP; each level +1 to a random skill line`, gain: { min: max - lvl, exp: max - lvl, max: max - lvl }, cost: { trainingExp: exp }, time: "now" });
      }
      if (d.status === "replace") {
        const stage = (ctx.ilvl ?? 0) >= model.arcana.drops.stage4.fromIlvl ? "stage4" : "stage3";
        const S = model.arcana.drops[stage];
        const dungeon = Object.entries(S.cardTypes).find(([, t]) => t.includes(type));
        const pAny = 1 - S.bosses.reduce((n, p) => n * (1 - p), 1);
        const p = dungeon ? pAny / dungeon[1].length : 0;
        const n = inputs.transcendenceRuns ?? 10;
        const chance = atLeastOnce(p, n);
        const gain = model.arcana.byGrade.Unique - (d.it.level ?? 0) - lvl;
        up({ id: `card:${slot}`, lever: "arcana", label: `${type}: ${grade} → Unique`, detail: dungeon ? `${dungeon[0]} (${stage === "stage4" ? "Transcendence 4" : "Transcendence 3"}): ${r1(p * 100)}% per run for a Unique ${type}; ${Math.round(chance * 100)}% in ${n} runs` : "Unique Chalice only from Transcendence 4",
          gain: { min: 0, exp: r1(gain * chance), max: gain }, cost: { runs: n }, random: true, chance: { p, n, value: chance }, time: "runs" });
      }
    }
  }

  // Daevanion
  const bl = ctx.boardList || [], boards = ctx.boards || {};
  const base = bl.filter(b => !/azphel|ariel/i.test(b.name)), haveAll = base.every(b => boards[b.id]);
  if (haveAll && base.length) {
    const pts = base.reduce((n, b) => n + boardPoints(model, boards[b.id]), 0);
    const left = model.daevanion.baseCap.points - pts;
    if (left > 0) up({ id: "dae:base", lever: "daevanion", label: `Daevanion: ${pts} of ${model.daevanion.baseCap.points} base points`, detail: `Buy the rest in the Shugo shop (${model.daevanion.shugoShop.crystalsPerMonth}/month, ${model.daevanion.shugoShop.cost}) and the Nightmare shop (${model.daevanion.nightmareShop.crystals}, ${model.daevanion.nightmareShop.cost}); sealed dungeons give +2 each.`,
      gain: { min: left, exp: left, max: left }, cost: { shop: 1 }, time: "days" });
  }
  const az = bl.find(b => same(b.name, "Azphel"));
  if (az && boards[az.id]) {
    let have = boardPoints(model, boards[az.id]);
    const { crystals, apEach } = model.daevanion.azphelShop;
    let prev = null;
    crystals.forEach((n, i) => {
      const left = Math.max(0, Math.min(n, crystals.slice(0, i + 1).reduce((a, b) => a + b, 0) - have));
      if (left) up({ id: `dae:azphel:${i}`, lever: "daevanion", label: `Azphel crystals tier ${i + 1}: ${left} × ${apEach[i].toLocaleString()} AP`, detail: "PvP board — pure item level for PvE; Abyss Points are usually better spent on Stigma Shards.", gain: { min: left, exp: left, max: left }, cost: { ap: left * apEach[i] }, time: "now", after: prev });
      if (left) prev = `dae:azphel:${i}`;
    });
  }
  if (!bl.some(b => same(b.name, "Ariel")) && (ctx.ilvl ?? 0) >= 2500)
    up({ id: "dae:ariel", lever: "daevanion", label: "Ariel board (Krao Cave / Draupnir Hard)", detail: `${model.daevanion.ariel.from}; ${model.daevanion.ariel.fragmentsPerCrystal} fragments = 1 crystal, max ${model.daevanion.ariel.maxPerDungeon} per dungeon. Runs and energy not priced.`, gain: { min: 0, exp: 30, max: 60 }, cost: { runs: 10 }, random: true, known: false, time: "weeks" });

  for (const u of out) { u.effort = r1(effort(model, u.cost) + (u.cubes ? u.cubes * model.gear.drops.odylePerCube / model.effort.odyle : 0)); u.ratio = u.effort ? u.gain.exp / u.effort : u.gain.exp * 100; }
  return out;
}

// Guaranteed first, then item level per effort.
export const rank = list => [...list].sort((a, b) => (a.random - b.random) || (b.ratio - a.ratio));

// Greedy plan: walk the ranked list, take what the resources pay for. Unentered resources count as unlimited.
export function plan(model, list, inp, levers = LEVERS, now = new Date()) {
  const end = toDate(inp.targetDate || model.deadline.defaultDate);
  const cubesInfo = effectiveCubes(model, inp, now, end), odyle = cubesInfo.odyle;
  const buys = odyle.kinah.windBreeze + odyle.kinah.morph;
  const pool = {
    kinah: inp.kinah == null ? Infinity : kinahBudget(model, inp, now, end).total - buys,
    ap: inp.ap == null ? Infinity : inp.ap,
    trainingExp: inp.trainingExp == null ? Infinity : inp.trainingExp,
    runs: Infinity, shop: Infinity, crystals: Infinity,
  };
  const pity = { "Fire Temple": inp.pityFireTemple || 0, "Ferocious Horn Den": inp.pityHornDen || 0 };
  let cubes = cubesInfo.cubes; // Odyle on hand not entered = 0, regen still counts
  const taken = [], groups = new Set(), ids = new Set();
  for (const u of rank(list)) {
    if (!u.known || !levers.includes(u.lever) || (u.group && groups.has(u.group)) || (u.after && !ids.has(u.after))) continue;
    const need = u.cubes ? Math.max(0, u.cubes - (pity[u.dungeon] || 0)) : 0;
    if (need > cubes || Object.entries(u.cost).some(([k, v]) => v > (pool[k] ?? Infinity))) continue;
    Object.entries(u.cost).forEach(([k, v]) => pool[k] -= v);
    if (u.cubes) { cubes -= need; pity[u.dungeon] = Math.max(0, (pity[u.dungeon] || 0) - u.cubes); }
    taken.push(u); ids.add(u.id); if (u.group) groups.add(u.group);
  }
  const byLever = Object.fromEntries(LEVERS.map(l => [l, { min: 0, exp: 0, max: 0, n: 0 }]));
  for (const u of taken) { const b = byLever[u.lever]; b.min += u.gain.min; b.exp += u.gain.exp; b.max += u.gain.max; b.n++; }
  for (const b of Object.values(byLever)) { b.min = r1(b.min); b.exp = r1(b.exp); b.max = r1(b.max); }
  const sum = k => r1(Object.values(byLever).reduce((n, b) => n + b[k], 0));
  return { taken, byLever, total: { min: sum("min"), exp: sum("exp"), max: sum("max") }, odyle, cubes: cubesInfo, left: { ...pool, cubes } };
}
