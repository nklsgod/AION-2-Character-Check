// Deadline mode: what has to happen to reach the target item level by a date. Pure functions, no DOM.
import { same, boardPoints } from "./core.js";
import { upgrades, rollUntil, expectedAttempts } from "./calc.js";
import { toDate, effectiveCubes, kinahBudget, transmuteDates, resetsBetween, daysBetween, odyleBudget, weeklyWindows, rng } from "./budget.js";

const r1 = x => Math.round(x * 10) / 10;
const DAY = 864e5;
const fmtDay = d => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" });

// Inputs that count as 0 when empty in deadline mode (and get listed as missing).
export const REQUIRED = [
  ["kinah", "Kinah"], ["odyle", "Odyle now"], ["ap", "Abyss Points"], ["trainingExp", "Training Arcana EXP"], ["crystals", "Mysterious Crystals"],
  ["fragments", "Nightmare fragments"], ["centuryroot", "Centuryroot"], ["feathers", "Abyss Feathers collected (of 36)"],
  ["pityFireTemple", "Fire Temple pity"], ["pityHornDen", "Horn Den pity"],
];
export const missingInputs = inp => REQUIRED.filter(([k]) => inp[k] == null || inp[k] === "").map(([, l]) => l);

// The levers for the deadline, each with a class: guaranteed / probable / luck.
export function levers(model, ctx, inp, now, end) {
  const out = [];
  const L = o => out.push({ cost: {}, ...o });
  const base = upgrades(model, { ...ctx, inputs: { ...inp, transcendenceRuns: 0 } });
  const get = p => base.filter(u => u.id.startsWith(p));

  // Guaranteed
  if (inp.feathers != null && inp.feathers < model.abyssFeathers.total)
    L({ id: "feathers", cls: "guaranteed", lever: "daevanion", label: `Collect the remaining Abyss Feathers (${inp.feathers}/${model.abyssFeathers.total})`, gain: model.abyssFeathers.total - inp.feathers, when: "monolith — any time", source: model.abyssFeathers.source });
  const dae = get("dae:base")[0];
  if (dae) {
    const N = model.daevanion.nightmareShop, S = model.daevanion.shugoShop;
    const nightmare = Math.min(N.crystals, Math.floor((inp.fragments || 0) / 300));
    const months = 1 + daysBetween(now, end).filter(d => d.getDate() === 1).length;
    const shugo = Math.min(S.crystalsPerMonth * months, Math.floor((inp.centuryroot || 0) / 50));
    const n = Math.min(dae.gain.exp, nightmare), s = Math.min(dae.gain.exp - n, shugo);
    if (n) L({ id: "dae:nightmare", cls: "guaranteed", lever: "daevanion", label: `Nightmare shop: ${n} Daevanion crystals`, gain: n, cost: { fragments: n * 300 }, when: "now" });
    if (s) L({ id: "dae:shugo", cls: "guaranteed", lever: "daevanion", label: `Shugo shop: ${s} Daevanion crystals`, gain: s, cost: { centuryroot: s * 50 }, when: months > 1 ? `now and on the 1st (${S.crystalsPerMonth}/month)` : "now" });
    if (dae.gain.exp - n - s > 0) L({ id: "dae:short", cls: "info", label: `${dae.gain.exp - n - s} more base Daevanion points need fragments / Centuryroot you haven't entered`, gain: 0 });
  }
  for (const u of get("dae:azphel")) L({ id: u.id, cls: "guaranteed", lever: "daevanion", label: u.label, gain: u.gain.exp, cost: { ap: u.cost.ap }, after: u.after, conflict: "AP: same points buy Stigma Shards", when: "now" });
  for (const u of get("enh:")) {
    const lv = +u.id.split(":").pop(), t = model.enhance.attempts[lv];
    const worst = Math.ceil((1 - t.chance) / model.enhance.pityPerFail) + 1;
    L({ id: u.id, cls: "guaranteed", lever: "enhance", label: u.label, detail: `${u.detail}; worst case ${worst} tries (pity)`, gain: 1, cost: { kinah: u.cost.kinah }, worstKinah: worst * t.kinah, after: u.after, when: "now" });
  }
  for (const u of get("card-lv:")) L({ id: u.id, cls: "guaranteed", lever: "arcana", label: u.label, detail: u.detail, gain: u.gain.exp, cost: { trainingExp: u.cost.trainingExp }, when: "now" });
  // Crafted steps: up to the keeper tier, further only when the cost is known.
  for (const u of get("craft:").filter(u => u.known || +u.id.split(":").pop() <= model.gear.keeperBase)) L({ id: u.id, cls: "guaranteed", lever: "gear", label: u.label, detail: u.detail, gain: u.gain.exp, cost: u.known ? { kinah: u.cost.kinah } : {}, unknownCost: !u.known, after: u.after, when: "as soon as you have the materials" });
  const T = model.arcana.transmute, slots = transmuteDates(model, inp, now, end);
  const legend = (ctx.diags || []).filter(d => /arcana/i.test(d.why) && d.status === "replace").map(d => ({ d, gain: model.arcana.byGrade.Unique - (d.it.level ?? 0) - (d.e.enchantLevel || 0) })).sort((a, b) => b.gain - a.gain);
  legend.forEach((c, i) => { if (i < slots.length) L({ id: `transmute:${c.d.e.slotPosName}`, cls: "guaranteed", lever: "arcana", label: `Transmute ${c.d.type} into a Unique card`, gain: c.gain, cost: { crystals: T.crystals, kinah: T.kinah, transmute: 1 }, card: c.d.e.slotPosName, date: slots[i], when: `on ${fmtDay(slots[i])} (7-day cooldown)` }); });

  // Probable: grey lines → at least green, empty sockets with Intermediate stones
  const toGreen = rollUntil(model, model.deadline.stoneToGreen.type, model.deadline.stoneToGreen.minGrade);
  const inter = model.stone.types.Intermediate.kinah;
  for (const d of ctx.diags || []) {
    if (d.status !== "keeper" || /arcana/i.test(d.why)) continue;
    if (d.craft && !model.crafting.transfer.stones && d.craft.steps.some(x => x.to <= model.gear.keeperBase)) continue; // stones would be lost
    const grey = d.stones.filter(s => s.grade === "Common");
    if (grey.length) L({ id: `green:${d.e.slotPosName}`, cls: "probable", lever: "stones", label: `${d.e.slotPosName}: ${grey.length} grey line${grey.length > 1 ? "s" : ""} → at least green`, gain: r1(grey.length * (toGreen.value - 1)), lines: grey.length,
      stones: Math.ceil(grey.length * toGreen.rolls), cost: { kinah: Math.round(grey.length * toGreen.rolls * inter), stones: Math.ceil(grey.length * toGreen.rolls) }, sim: { type: "toGreen", lines: grey.length }, when: "now" });
    if (d.empty) L({ id: `fill:${d.e.slotPosName}`, cls: "probable", lever: "stones", label: `${d.e.slotPosName}: fill ${d.empty} socket${d.empty > 1 ? "s" : ""} (Intermediate)`, gain: r1(d.empty * 1.65), cost: { kinah: d.empty * inter, stones: d.empty }, sim: { type: "fill", n: d.empty }, when: "now" });
  }

  // Luck: gear drops and Unique card drops (filled by the cube allocation)
  const gear = (ctx.diags || []).filter(d => d.status === "replace" && d.source && !/arcana/i.test(d.why)).map(d => {
    const a = d.actions.find(x => x.kind === "replace");
    return { slot: d.e.slotPosName, dungeon: d.source.name, gain: a?.gain?.exp ?? 16, vouchers: /sub|off|guard/i.test(d.e.slotPosName) ? model.gear.drops.guard.vouchers : 1, kinah: /sub|off|guard/i.test(d.e.slotPosName) ? model.gear.drops.guard.kinah : 0 };
  });
  return { list: out, gear, legend, transmuteSlots: slots };
}

// Resources for the deadline (empty = 0).
export function resources(model, inp, now, end) {
  const k = kinahBudget(model, { ...inp, kinah: inp.kinah || 0 }, now, end);
  const o = odyleBudget(model, inp, now, end);
  const market = !!inp.membership;
  // Abyss time per week: 7 h, 14 h with membership — times the AP you make per hour (if entered).
  const H = model.membership.effects.abyssHours, abyssAp = (inp.apPerAbyssHour || 0) * (market ? H.with : H.without) * weeklyWindows(model, toDate(now), toDate(end));
  return {
    kinah: k.total - o.kinah.windBreeze - o.kinah.morph, ap: (inp.ap || 0) + abyssAp, abyssAp, trainingExp: inp.trainingExp || 0, crystals: inp.crystals || 0,
    fragments: inp.fragments || 0, centuryroot: inp.centuryroot || 0, transmute: Infinity,
    stones: market ? Infinity : (inp.intermediateStones || 0), market,
  };
}

const effortOf = (model, c) => (c.kinah || 0) / model.effort.kinah + (c.ap || 0) / model.effort.ap + (c.trainingExp || 0) / model.effort.trainingExp + (c.crystals || 0) / model.effort.crystals + 0.01;

// Greedy: guaranteed first, then probable, each by item level per effort; stop once the expected total reaches the target.
export function choose(model, list, res, start, target) {
  const pool = { ...res }, taken = [], ids = new Set();
  let exp = start;
  for (const cls of ["guaranteed", "probable"]) {
    const cand = list.filter(l => l.cls === cls).sort((a, b) => b.gain / effortOf(model, b.cost) - a.gain / effortOf(model, a.cost));
    let progress = true;
    while (progress) {
      progress = false;
      for (const l of cand) {
        if (ids.has(l.id) || (l.after && !ids.has(l.after) && list.some(x => x.id === l.after))) continue;
        if (exp >= target) break;
        if (Object.entries(l.cost).some(([k, v]) => v > (pool[k] ?? 0))) { l.blocked = Object.keys(l.cost).find(k => l.cost[k] > (pool[k] ?? 0)); continue; }
        Object.entries(l.cost).forEach(([k, v]) => pool[k] -= v);
        taken.push(l); ids.add(l.id); exp += l.gain; progress = true; delete l.blocked;
      }
    }
  }
  return { taken, pool, exp };
}

// Hand out the cubes: pity vouchers (guaranteed) and random drops / card runs (luck), cube by cube to the best expected value.
export function allocateCubes(model, cubes, counts, gear, cards, pity, pDrop, pCard) {
  // With the membership's second opening, only first openings may count for pity (config flag).
  const pityStep = counts.opens > 1 && !model.odyle.secondOpen.countsForPity ? 1 / counts.opens : 1;
  const G = model.gear.drops;
  const dungeons = [...new Set(gear.map(g => g.dungeon))];
  const left = { ...Object.fromEntries(dungeons.map(d => [d, (counts.conquest[d] ?? 0) * counts.opens])), Transcendence: counts.transcendence * counts.opens };
  const state = Object.fromEntries(dungeons.map(d => [d, { cubes: 0, pity: pity[d] || 0, vouchers: 0, picks: [] }]));
  const need = Object.fromEntries(dungeons.map(d => [d, gear.filter(g => g.dungeon === d).sort((a, b) => b.gain / b.vouchers - a.gain / a.vouchers)]));
  let runs = 0;
  const value = d => {
    if (d === "Transcendence") return left.Transcendence > 0 ? cards.reduce((n, c) => n + pCard(c) * c.gain, 0) : -1;
    if (left[d] <= 0 || !need[d].length) return -1;
    const best = need[d][0];
    return best.gain * pityStep / (G.pityClaims * best.vouchers) + need[d].reduce((n, g) => n + pDrop * g.gain, 0);
  };
  for (let i = 0; i < cubes; i++) {
    const pick = [...dungeons, "Transcendence"].map(d => [d, value(d)]).sort((a, b) => b[1] - a[1])[0];
    if (!pick || pick[1] <= 0) break;
    const d = pick[0]; left[d]--;
    if (d === "Transcendence") { runs++; continue; }
    const s = state[d]; s.cubes++; s.pity += pityStep;
    if (s.pity >= G.pityClaims) { s.pity = 0; s.vouchers++; }
    const best = need[d][0];
    if (best && s.vouchers >= best.vouchers) { s.vouchers -= best.vouchers; s.picks.push(best); need[d].shift(); }
  }
  return { state, runs, unused: cubes - runs - Object.values(state).reduce((n, s) => n + s.cubes, 0), remaining: Object.values(need).flat() };
}

// Monte Carlo over the probable and luck levers. Returns P(target) and the spread.
export function simulate(model, plan, n = 10000, seed = 1) {
  const R = rng(seed), G = model.gear.drops;
  const tg = model.stone.types[model.deadline.stoneToGreen.type].odds, pGreen = tg.Rare + (tg.Legend || 0), pLegendGivenGreen = (tg.Legend || 0) / pGreen;
  const io = model.stone.types.Intermediate.odds, vals = model.stone.byGrade;
  const totals = new Float64Array(n), luckHits = new Uint16Array(n);
  for (let k = 0; k < n; k++) {
    let t = plan.start + plan.guaranteed, hits = 0;
    for (const l of plan.probable) {
      if (l.sim?.type === "toGreen") for (let j = 0; j < l.sim.lines; j++) t += R() < pLegendGivenGreen ? 2 : 1;
      if (l.sim?.type === "fill") for (let j = 0; j < l.sim.n; j++) { const x = R(); t += x < io.Common ? vals.Common : x < io.Common + io.Rare ? vals.Rare : vals.Legend; }
    }
    // random gear drops on top of the pity picks
    for (const [d, s] of Object.entries(plan.cubes.state)) {
      const pool = plan.cubes.remaining.filter(g => g.dungeon === d).map(g => g.gain);
      for (let c = 0; c < s.cubes && pool.length; c++) for (let j = pool.length - 1; j >= 0; j--) if (R() < G.perItemPerCube) { t += pool[j]; pool.splice(j, 1); hits++; }
    }
    const cards = plan.cards.map(c => ({ ...c }));
    for (let r = 0; r < plan.cubes.runs && cards.length; r++) for (let j = cards.length - 1; j >= 0; j--) if (R() < cards[j].p) { t += cards[j].gain; cards.splice(j, 1); hits++; }
    totals[k] = t; luckHits[k] = hits;
  }
  const sorted = Array.from(totals).sort((a, b) => a - b);
  const pct = q => sorted[Math.min(n - 1, Math.floor(q * n))];
  const reach = sorted.filter(x => x >= plan.target).length / n;
  const hitDist = Array.from(luckHits);
  return { p: reach, p10: pct(.1), p50: pct(.5), p90: pct(.9), mean: sorted.reduce((a, b) => a + b, 0) / n, max: sorted[n - 1], hitsAtLeast: h => hitDist.filter(x => x >= h).length / n };
}

// The whole deadline answer.
export function deadline(model, ctx, inp, { now = new Date(), sims = model.deadline.sims, seed = 1 } = {}) {
  now = toDate(now);
  const end = toDate(inp.date || model.deadline.defaultDate), target = +(inp.target || model.deadline.defaultTarget);
  const start = ctx.ilvl ?? 0;
  const lv = levers(model, ctx, inp, now, end);
  const eff = effectiveCubes(model, inp, now, end);
  const stage = start >= model.arcana.drops.stage4.fromIlvl ? model.arcana.drops.stage4 : model.arcana.drops.stage3;
  const pAny = 1 - stage.bosses.reduce((n, p) => n * (1 - p), 1);
  const cardsOf = skip => lv.legend.filter(c => !skip.has(c.d.e.slotPosName)).map(c => {
    const dun = Object.entries(stage.cardTypes).find(([, t]) => t.includes(c.d.type));
    return { slot: c.d.e.slotPosName, type: c.d.type, gain: c.gain, p: dun ? pAny / dun[1].length : 0 };
  });
  const pity = { "Fire Temple": inp.pityFireTemple || 0, "Ferocious Horn Den": inp.pityHornDen || 0 };
  const alloc = cards => allocateCubes(model, eff.cubes, eff.counts, lv.gear, cards, pity, model.gear.drops.perItemPerCube, c => c.p);
  // Buy Odyle items only for cubes that will actually be opened: Substance Morph (cheaper) first, then Wind Breeze.
  const buys = a => {
    const used = eff.cubes - a.unused, E = model.odyle.itemEnergy, o = eff.odyle;
    let extra = Math.max(0, used * E - (o.parts.stock + o.parts.regen + o.parts.event));
    const morph = Math.min(o.items.morph, Math.ceil(extra / E)); extra -= morph * E;
    const wb = Math.min(o.items.windBreeze, Math.max(0, Math.ceil(extra / E)));
    return { morph, wb, kinah: morph * model.odyle.substanceMorph.kinahEach + wb * model.odyle.windBreeze.kinahEach };
  };
  const firstBuys = buys(alloc(cardsOf(new Set())));
  const res = resources(model, inp, now, end);
  res.kinah += eff.odyle.kinah.windBreeze + eff.odyle.kinah.morph - firstBuys.kinah;
  const ch = choose(model, lv.list, res, start, target);
  const guaranteed = r1(ch.taken.filter(l => l.cls === "guaranteed").reduce((n, l) => n + l.gain, 0));
  const probable = ch.taken.filter(l => l.cls === "probable");
  const probableExp = r1(probable.reduce((n, l) => n + l.gain, 0));

  // cubes: transmuted cards leave the luck pool
  const cards = cardsOf(new Set(ch.taken.filter(l => l.card).map(l => l.card)));
  const cubes = alloc(cards);
  const odyleBuys = buys(cubes);
  const pityPicks = Object.values(cubes.state).flatMap(s => s.picks);
  const pityGain = r1(pityPicks.reduce((n, g) => n + g.gain, 0));
  const guardKinah = pityPicks.reduce((n, g) => n + g.kinah, 0);
  const guaranteedTotal = r1(guaranteed + pityGain);

  const plan = { start, target, guaranteed: guaranteedTotal, probable, cubes, cards };
  const sim = simulate(model, plan, sims, seed);
  const luckExp = r1(sim.mean - start - guaranteedTotal - probableExp);
  const luckMax = r1(cubes.remaining.filter(g => (cubes.state[g.dungeon]?.cubes || 0) > 0).reduce((n, g) => n + g.gain, 0) + (cubes.runs ? cards.reduce((n, c) => n + c.gain, 0) : 0));
  const V = model.deadline.verdict;
  const verdict = sim.p >= V.likely ? "likely" : sim.p >= V.possible ? "possible with luck" : "unrealistic";

  // How many luck items have to land to close the gap after guaranteed + expected.
  const gap = r1(target - (start + guaranteedTotal + probableExp));
  let needHits = 0, acc = 0, closable = true;
  const luckGains = [...cubes.remaining.filter(g => cubes.state[g.dungeon]?.cubes).map(g => g.gain), ...(cubes.runs ? cards.map(c => c.gain) : [])].sort((a, b) => b - a);
  if (gap > 0) { for (const g of luckGains) { if (acc >= gap) break; acc += g; needHits++; } closable = acc >= gap; }

  // Conflicts
  const spent = cat => ch.taken.reduce((n, l) => n + (l.lever === cat || (cat === "transmute" && l.cost.transmute) ? (l.cost.kinah || 0) : 0), 0);
  const conflicts = [];
  const az = ch.taken.filter(l => l.id.startsWith("dae:azphel"));
  if (az.length) conflicts.push(`AP: ${az.reduce((n, l) => n + l.cost.ap, 0).toLocaleString()} on Azphel crystals — the same points buy Stigma Shards (real damage).`);
  conflicts.push(`Kinah: stones ${Math.round(spent("stones")).toLocaleString()} · enhancement ${Math.round(spent("enhance")).toLocaleString()} · transmute ${Math.round(spent("transmute")).toLocaleString()}${guardKinah ? ` · guard ${guardKinah.toLocaleString()}` : ""} · Odyle items ${odyleBuys.kinah.toLocaleString()} (${odyleBuys.morph} Substance Morph, ${odyleBuys.wb} Wind Breeze) — of ${Math.round(res.kinah + firstBuys.kinah).toLocaleString()} until the date.`);
  const ft = cubes.state["Fire Temple"]?.cubes || 0, hd = cubes.state["Ferocious Horn Den"]?.cubes || 0;
  conflicts.push(`Odyle: ${eff.cubes} cubes (${eff.binding} is the limit) → Fire Temple ${ft} · Horn Den ${hd} · Transcendence ${cubes.runs}${cubes.unused ? ` · ${cubes.unused} unused` : ""}.`);

  return {
    now, end, target, start, verdict, sim, missing: missingInputs(inp),
    guaranteed: guaranteedTotal, expected: r1(start + guaranteedTotal + probableExp + Math.max(0, luckExp)), withLuck: r1(start + guaranteedTotal + probableExp + luckMax),
    gap, needHits, closable, luckSum: r1(luckGains.reduce((a, b) => a + b, 0)), pNeedHits: needHits && closable ? sim.hitsAtLeast(needHits) : closable ? 1 : 0, luckItems: luckGains.length, odyleBuys,
    taken: ch.taken, blocked: lv.list.filter(l => !ch.taken.includes(l) && (l.cls === "guaranteed" || l.cls === "probable")), info: lv.list.filter(l => l.cls === "info"),
    cubes, pityPicks, eff, conflicts, cards, guardKinah, transmuteSlots: lv.transmuteSlots, res,
  };
}

// Must-happen list: guaranteed and probable steps, cube plan, and the luck requirement.
export function mustHappen(model, D) {
  const items = [];
  const fmtK = n => n >= 1e6 ? r1(n / 1e6) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
  const cost = c => [c.kinah && fmtK(c.kinah) + " Kinah", c.ap && fmtK(c.ap) + " AP", c.trainingExp && fmtK(c.trainingExp) + " EXP", c.crystals && c.crystals + " crystals", c.fragments && c.fragments + " fragments", c.centuryroot && c.centuryroot + " Centuryroot", c.stones && c.stones + " Intermediate stones"].filter(Boolean).join(" + ") || "—";
  for (const l of D.taken) items.push({ id: l.id, cls: l.cls, text: l.label, gain: l.gain, cost: l.unknownCost ? "materials and Kinah unknown — get them" : cost(l.cost), when: l.when || "now", warn: l.conflict });
  const pD = model.gear.drops.perItemPerCube;
  for (const [d, s] of Object.entries(D.cubes.state)) if (s.cubes) {
    const luck = D.cubes.remaining.filter(g => g.dungeon === d), exp = r1(luck.reduce((n, g) => n + (1 - Math.pow(1 - pD, s.cubes)) * g.gain, 0));
    items.push({ id: `cubes:${d}`, cls: s.picks.length ? "guaranteed" : "luck", text: `${d}: open ${s.cubes} cubes${s.picks.length ? ` — pity buys ${s.picks.map(p => p.slot).join(", ")}` : ""}${luck.length ? `; ${Math.round((1 - Math.pow(1 - pD, s.cubes)) * 100)}% per missing piece (${luck.map(g => g.slot).join(", ")}) to drop` : ""}`,
      gain: r1(s.picks.reduce((n, p) => n + p.gain, 0)), expected: r1(s.picks.reduce((n, p) => n + p.gain, 0) + exp), cost: `${s.cubes * model.gear.drops.odylePerCube} Odyle`, when: "spread over the days" });
  }
  if (D.cubes.runs) items.push({ id: "cubes:Transcendence", cls: "luck", text: `Transcendence: ${D.cubes.runs} runs for ${D.cards.map(c => `a Unique ${c.type} (${Math.round((1 - Math.pow(1 - c.p, D.cubes.runs)) * 100)}%)`).join(" / ")}`, gain: 0,
    expected: r1(D.cards.reduce((n, c) => n + (1 - Math.pow(1 - c.p, D.cubes.runs)) * c.gain, 0)), cost: `${D.cubes.runs * model.gear.drops.odylePerCube} Odyle`, when: "spread over the days" });
  if (D.gap > 0 && D.closable) items.push({ id: "luck", cls: "luck", text: `At least ${D.needHits} lucky drop${D.needHits > 1 ? "s" : ""} (gear or Unique card) of ${D.luckItems} possible`, gain: D.gap, cost: `P(≥${D.needHits}) = ${Math.round(D.pNeedHits * 100)}%`, when: "by the date" });
  else if (D.gap > 0) items.push({ id: "luck", cls: "impossible", text: `Even if every lucky drop lands (+${D.luckSum}), ${r1(D.gap - D.luckSum)} item level are still missing`, gain: D.gap, cost: "more resources or a later date", when: "—" });
  return items;
}

// Day-by-day plan: cubes, Kinah, shop buys, weekly-reset actions, transmutes.
export function dailyPlan(model, D, inp) {
  const days = daysBetween(D.now, D.end), resets = resetsBetween(model, D.now, D.end).map(d => d.toDateString());
  const share = Object.entries(D.cubes.state).map(([d, s]) => [d, s.cubes]).concat([["Transcendence", D.cubes.runs]]).filter(([, n]) => n);
  const total = share.reduce((n, [, c]) => n + c, 0) || 1;
  const perDay = D.eff.cubes / Math.max(1, days.length);
  const kinahNow = D.taken.filter(l => !l.date && l.cost.kinah).reduce((n, l) => n + l.cost.kinah, 0);
  return days.map((d, i) => {
    const ev = [];
    const c = Math.round(perDay * (i + 1)) - Math.round(perDay * i);
    if (c) ev.push(`${c} cubes: ${share.map(([n, x]) => `${n} ${Math.max(0, Math.round(c * x / total))}`).join(", ")}`);
    if (i === 0 && kinahNow) ev.push(`Kinah: ${Math.round(kinahNow / 1e3).toLocaleString()}k on stones, enhancement and shop steps (as far as the stock allows)`);
    if (i === 0) for (const l of D.taken.filter(l => l.lever === "daevanion")) ev.push(l.label);
    const weeks = resets.length + 1, mb = Math.ceil(D.odyleBuys.morph / weeks), wbb = Math.ceil(D.odyleBuys.wb / weeks);
    if ((resets.includes(d.toDateString()) || i === 0) && (mb || wbb)) ev.push(`${i === 0 ? "This week" : "Weekly reset"}: ${mb ? `craft ${mb} Odyle items via Substance Morph` : ""}${mb && wbb ? ", " : ""}${wbb ? `buy ${wbb} at the Wind Breeze Merchant` : ""}`);
    if (d.getDate() === 1) ev.push(`Shugo shop: ${model.daevanion.shugoShop.crystalsPerMonth} new Daevanion crystals`);
    for (const l of D.taken.filter(l => l.date && l.date.toDateString() === d.toDateString())) ev.push(l.label);
    const evd = toDate(model.odyle.event.from), evt = toDate(model.odyle.event.to);
    if (inp.event !== false && d >= evd && d <= evt) ev.push(`Event mail: ${model.odyle.event.itemsPerDay} Odyle items (claim within ${model.odyle.event.mailExpiresDays} days)`);
    return { date: d, label: fmtDay(d), events: ev };
  });
}

// First date where P(target) reaches each threshold (fewer simulations per step).
export function earliestDates(model, ctx, inp, { now = new Date(), maxDays = 60, sims = 1500, seed = 1 } = {}) {
  const out = {};
  const base = toDate(inp.date || model.deadline.defaultDate);
  for (let i = 1; i <= maxDays && Object.keys(out).length < model.deadline.earliest.length; i++) {
    const d = new Date(+base + i * DAY);
    const r = deadline(model, ctx, { ...inp, date: d.toISOString() }, { now, sims, seed });
    for (const q of model.deadline.earliest) if (!out[q] && r.sim.p >= q) out[q] = d;
  }
  return out;
}
