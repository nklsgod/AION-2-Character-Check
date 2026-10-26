// Gear Doctor: per-item diagnosis and character-wide findings. Pure functions, no DOM.
import { norm, same, isArcana, pieceIlvl } from "./core.js";

const slotIs = (e, names) => names.some(n => norm(e.slotPosName).replace(/ \d+$/, "").replace(/\d+$/, "") === norm(n)
  || norm(e.slotPosName).startsWith(norm(n)));
const round1 = x => Math.round(x * 10) / 10;
const sourceFor = (model, e) => model.gear.sources.find(s => slotIs(e, s.slots));
// Card type: API categoryName ("Chalice", "Parchment" …), falling back to the item name.
export const cardType = (e, it) => ["Chalice", "Parchment", "Compass", "Bell", "Mirror"]
  .find(t => same(it?.categoryName, t) || norm(e.name).includes(norm(t))) || it?.categoryName || "Card";

// Keep / replace for one piece, with the reason. Arcana are judged by grade instead.
export function itemStatus(model, e, it) {
  const g = model.gear;
  if (isArcana(e)) return { status: (it?.level ?? 0) >= model.arcana.byGrade.Unique ? "keeper" : "replace", why: "Arcana card grade" };
  const crafted = g.crafted.find(c => same(e.name, c.match));
  if (crafted) return { status: "keeper", why: `${crafted.why} — keep until ${crafted.keepUntil}`, crafted };
  const keep = g.keep.find(k => slotIs(e, k.match));
  if (keep) return { status: "keeper", why: keep.why };
  if ((it?.level ?? 0) >= g.keeperBase) return { status: "keeper", why: `item level ${it.level} base` };
  const src = sourceFor(model, e);
  return { status: "replace", why: `base ${it?.level ?? "?"} < ${g.keeperBase}`, source: src };
}

// Everything the item card shows: parts, stones, soul binding, status and concrete actions with ilvl gains.
export function diagnoseItem(model, e, it) {
  if (!it || it.failed) return null;
  const parts = pieceIlvl(model, e, it);
  const st = itemStatus(model, e, it);
  const sockets = Math.max(it.magicStoneSlotCount || 0, (it.magicStoneStat || []).length);
  const stones = Array.from({ length: sockets }, (_, i) => {
    const m = (it.magicStoneStat || []).find(x => x.slotPos === i);
    return m ? { ...m, ilvl: model.stone.byGrade[m.grade] ?? 0 } : { empty: true, ilvl: 0 };
  });
  const empty = stones.filter(s => s.empty).length;
  const rolls = model.stone.rolls;
  const actions = [];
  const act = (level, text, gain, kind) => actions.push({ level, text, gain, kind });

  if (isArcana(e)) {
    const type = cardType(e, it), max = it.maxEnchantLevel ?? model.arcana.maxLevel[it.grade] ?? 5;
    if (st.status === "replace") {
      const gain = model.arcana.byGrade.Unique - (it.level ?? 0) - (e.enchantLevel || 0);
      act("red", `${it.grade} card → Unique: +${gain} item level (+${model.arcana.byGrade.Unique - (it.level ?? 0)} grade, −${e.enchantLevel || 0} card levels lost). From ${model.arcana.sources[type] || "Transcendence"}.`, { min: gain, exp: gain, max: gain + 5 }, "arcana");
    }
    if ((e.enchantLevel || 0) < max) act("yellow", `Card level +${e.enchantLevel || 0} of +${max}: +${max - (e.enchantLevel || 0)} item level, each level raises a random skill line by 1.`, { min: max - (e.enchantLevel || 0), exp: max - (e.enchantLevel || 0), max: max - (e.enchantLevel || 0) }, "arcanaLevel");
    return { e, it, parts, ...st, stones, empty, actions, type };
  }

  if (st.status === "replace") {
    const target = model.gear.keeperBase;
    const gross = target - (it.level ?? 0), lost = parts.stones;
    const src = st.source;
    const note = src?.note?.[e.slotPosName] ? ` ${src.note[e.slotPosName]}.` : "";
    const piece = Object.entries(model.gear.pieceNames || {}).find(([k]) => slotIs(e, [k]))?.[1] || e.slotPosName;
    if (src) act("red", `Replace: ${src.drops} ${piece} (${src.name}, pity after ${src.pityClaims} claims) → +${gross} item level base. Enhancement transfers, the ${lost} item level of stones is lost until you re-socket.${note}`,
      { min: gross - lost, exp: gross - lost + round1(sockets * rolls.expectedPerRoll.Intermediate), max: gross + sockets * 4 - lost }, "replace");
    else act("red", `Below item level ${target}: replace when you can.`, { min: 0, exp: 0, max: gross }, "replace");
    act("grey", `Being replaced — no more stones${(e.enchantLevel || 0) >= model.gear.maxUsefulEnchant ? "" : ` or enhancing past +${model.gear.maxUsefulEnchant}`} on this piece.`, null, "noInvest");
    if (empty) act("grey", `${empty} empty socket${empty > 1 ? "s" : ""}: only cheap Lesser stones here (≈ +${round1(empty * rolls.expectedPerRoll.Lesser)}), the piece is being replaced.`, { min: empty, exp: round1(empty * rolls.expectedPerRoll.Lesser), max: empty * 2 }, "fillCheap");
  } else {
    if (empty) act("red", `${empty} empty socket${empty > 1 ? "s" : ""} → Superior manastones: ≈ +${round1(empty * rolls.expectedPerRoll.Superior)} item level.`, { min: empty * 2, exp: round1(empty * rolls.expectedPerRoll.Superior), max: empty * 4 }, "fill");
    // Grey (Common) lines are worth rerolling; green (Rare) is fine per Fubgun — optional.
    for (const [grade, level, kind, label] of [["Common", "yellow", "reroll", "grey"], ["Rare", "grey", "rerollOptional", "green"]]) {
      const low = stones.filter(s => !s.empty && s.grade === grade);
      if (!low.length) continue;
      const gain = round1(low.reduce((n, s) => n + Math.max(0, rolls.rerollToLegend.expectedIlvl - s.ilvl), 0));
      act(level, `${low.length} ${label} line${low.length > 1 ? "s" : ""} (${low.map(s => `${s.name} ${s.value}`).join(", ")}) → reroll to Legend or better: ≈ +${gain} item level, about ${low.length * rolls.rerollToLegend.rollsPerLine} rolls${grade === "Rare" ? " (optional — 1–2 green lines per piece are fine)" : ""}.`, { min: 0, exp: gain, max: low.reduce((n, s) => n + 4 - s.ilvl, 0) }, kind);
    }
  }
  for (const s of stones) if (s.grade === "Unique" && /attack/i.test(s.name) && !/pvp/i.test(s.name)) act("green", `Lock the gold ${s.name} ${s.value} line (build priority).`, null, "lock");

  const subMax = it.subStatCount || 0, subs = (it.subStats || []).length, rate = parseFloat(it.soulBindRate ?? "100");
  if (subMax && !subs) act("red", "Soul binding missing — no soul-binding lines rolled.", null, "soulMissing");
  else if (st.status === "keeper" && subMax && subs < subMax) act("grey", `Soul binding ${subs}/${subMax} lines rolled.`, null, "soulLines");
  if (st.status === "keeper" && subMax && rate < 100) act("grey", `Soul binding at ${rate}% — bind further, but only on lines you keep (a new line resets its %).`, null, "soulRate");
  return { e, it, parts, ...st, stones, empty, actions };
}

// Traffic light for the card: worst action wins.
export const cardLight = d => !d ? "grey" : d.actions.some(a => a.level === "red") ? "red" : d.actions.some(a => a.level === "yellow") ? "yellow" : "green";

// Where a skill's level comes from on gear and cards: [{ slot, item, level }]
export function skillLineSources(equipmentList, items, skill) {
  const out = [];
  for (const e of equipmentList) for (const k of items[e.slotPos]?.subSkills || [])
    if (same(k.name, skill)) out.push({ slot: e.slotPosName, item: e.name, level: k.level });
  return out;
}

// Character-wide findings for the Doctor box, sorted by impact (expected item level, or a fixed weight for build items).
// in: { diags, ilvl, target, stigmas: [{ name, lvl, target }], mainSkill: { name, lvl, target, sources }, stats: [{ name, value, min }], azphel: { points, shopMax } }
export function findings(model, input) {
  const { diags = [], ilvl = 0, target = 2800 } = input;
  const out = [];
  const add = (impact, title, why, action, gain) => out.push({ impact, title, why, action, gain });
  const sumExp = list => Math.round(list.reduce((n, a) => n + (a.gain?.exp || 0), 0) * 10) / 10;
  const byKind = kind => diags.flatMap(d => d.actions.filter(a => a.kind === kind).map(a => ({ ...a, d })));
  const names = list => [...new Set(list.map(a => a.d.e.slotPosName))].join(", ");

  const fill = byKind("fill");
  if (fill.length) add(sumExp(fill), `${fill.reduce((n, a) => n + a.d.empty, 0)} empty manastone sockets on pieces you keep`, "Empty sockets are free item level and stats.", `Socket Superior manastones: ${names(fill)}.`, `≈ +${sumExp(fill)} item level`);
  const repl = byKind("replace");
  if (repl.length) add(sumExp(repl), `${repl.length} piece${repl.length > 1 ? "s" : ""} below item level ${model.gear.keeperBase}`, "Every 70 → 86 swap is +16 base; enhancement transfers.", `Replace ${names(repl)} (Horn Den for armor and guard, Fire Temple for weapon and jewellery).`, `≈ +${sumExp(repl)} item level after re-socketing`);
  const cards = byKind("arcana");
  if (cards.length) add(sumExp(cards), `${cards.length} Arcana card${cards.length > 1 ? "s" : ""} below Unique`, "Each Unique card is 80 item level; Legend is 60.", cards.map(a => `${a.d.type}: ${a.text.split("From ")[1] || "Transcendence"}`).join(" "), `≈ +${sumExp(cards)} item level`);
  const rr = byKind("reroll");
  if (rr.length) add(sumExp(rr), `Grey manastone lines on ${rr.length} piece${rr.length > 1 ? "s" : ""} you keep`, "A grey line is 1 item level; Legend and Unique are 3–4. About 2 rolls per line.", `Reroll on ${names(rr)}.`, `≈ +${sumExp(rr)} item level`);
  const ro = byKind("rerollOptional");
  if (ro.length) add(sumExp(ro) / 3, `Green manastone lines on ${ro.length} piece${ro.length > 1 ? "s" : ""}`, "Green is 2 item level — fine to keep; reroll only if you're close to a threshold.", `Optional: ${names(ro)}.`, `≈ +${sumExp(ro)} item level`);
  const lv = byKind("arcanaLevel");
  if (lv.length) add(sumExp(lv) * 0.8, "Arcana cards not at max level", "Each card level is +1 item level and +1 to a random skill line; EXP moves 100% into a better card later.", `Level ${lv.map(a => a.d.type).join(", ")} with Training Arcana.`, `+${sumExp(lv)} item level`);
  const soul = byKind("soulMissing");
  if (soul.length) add(8 * soul.length, "Soul binding missing", "No soul-binding lines means no bonus stats on that piece.", `Soul-bind ${names(soul)}.`, "Combat Power");
  const waste = diags.filter(d => d.status === "replace" && !/arcana/i.test(d.why) && (d.parts.stones > 0 || (d.e.enchantLevel || 0) > model.gear.maxUsefulEnchant));
  if (waste.length) add(3, "Resources on pieces you'll replace", "Stones are lost when the piece is swapped; enhancing past +11 costs a lot for 1 item level.",
    `Don't add more to ${waste.map(d => `${d.e.slotPosName} (${d.parts.stones} from stones, +${d.e.enchantLevel})`).join(", ")}.`, "saves Kina");

  for (const s of input.stigmas || []) if (s.lvl < s.target) add(15, `${s.name} ${s.lvl} → ${s.target}`, "A priority stigma for this build — stigmas are the biggest source of real damage.", "Stigma Shards (Nightmare and Shugo shops, Abyss Points).", "damage");
  const m = input.mainSkill;
  if (m && m.lvl < m.target) {
    const from = m.sources.length ? m.sources.map(s => `${s.slot} +${s.level}`).join(", ") : "none on gear yet";
    add(12, `${m.name} ${m.lvl} → ${m.target}`, `Your main damage skill. Lines on gear and cards now: ${from}.`, `${m.target - m.lvl} more from a Chalice/Parchment line, a ring line or card levels (each card level raises one of its lines).`, "damage");
  }
  for (const s of input.stats || []) {
    if (s.value == null) add(6, `${s.name}: unknown`, "NCSOFT doesn't send it, but Ludra checks it.", `Type it in under Stats (Ludra needs ${s.min.toLocaleString()}).`, "Ludra check");
    else if (s.value < s.min) add(10, `${s.name} ${s.value} → ${s.min.toLocaleString()}`, "Ludra entry check.", "Manastone and soul-binding lines.", "Ludra check");
  }
  const az = input.azphel;
  if (az && az.points < az.shopMax) add(2, `Azphel: ${az.points} points, the Abyss shop sells up to ${az.shopMax}`, "Pure item level for PvE — the Abyss Points are usually better spent on Stigma Shards.", "Only if you need raw item level for an entry check.", `up to +${az.shopMax - az.points} item level`);
  if (ilvl < target) out.forEach(f => f.gap = target - ilvl);
  out.forEach(f => f.impact = Math.round(f.impact * 10) / 10);
  return out.sort((a, b) => b.impact - a.impact);
}
