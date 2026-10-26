// Cleric build checks against cleric-knowledge.json. Pure functions, no DOM; every number comes from the knowledge file.
import { norm, same, sameTitle } from "./core.js";

// Line names match whole words from the start: "Attack" matches "Attack Increase" but not "PvP Attack";
// "Damage Tolerance" doesn't match "Weapon Damage Tolerance".
export const lineIs = (name, pattern) => { const n = norm(name), p = norm(pattern); return !!p && (n === p || n.startsWith(p + " ")); };
export const isPvp = name => /\bpvp\b/i.test(name || "");
const base = s => String(s || "").replace(/\s*\d+$/, "");

export function soulSlot(K, e) {
  const name = base(e.slotPosName);
  return Object.entries(K.soulBinding.slotMap).find(([k]) => norm(k) === norm(name))?.[1] ?? null;
}

// ✅ target / ➖ neutral / ❌ bad for one soul-binding stat line.
export function rateSoulLine(K, slot, line) {
  const S = K.soulBinding;
  if (S.bad.pvp && isPvp(line.name)) return { rating: "bad", why: "PvP line" };
  if (S.bad.lines.some(b => lineIs(line.name, b))) return { rating: "bad", why: "useless in PvE" };
  if ((S.targets[slot] || []).some(t => lineIs(line.name, t))) return { rating: "target", why: `target for ${slot}` };
  if (S.endgameLines.lines.some(t => lineIs(line.name, t))) return { rating: "neutral", why: "endgame roll — don't commit yet", endgame: true };
  return { rating: "neutral", why: "" };
}
// Skill lines on gear: rings follow the ring list, everything else the armor list.
export function rateSkillLine(K, slot, skill) {
  const S = K.soulBinding;
  if (S.uselessSkills.some(u => same(u, skill.name))) return { rating: "bad", why: "useless skill line" };
  if (slot === "Rings") {
    if (S.ringSkills.required.some(r => same(r, skill.name))) return { rating: "target", why: "required on rings" };
    if (S.ringSkills.then.some(r => same(r, skill.name))) return { rating: "target", why: "good ring line" };
    return { rating: "neutral", why: "" };
  }
  if (S.armorSkills.required.some(r => same(r, skill.name))) return { rating: "target", why: "armor skill target" };
  const opt = S.armorSkills.second.options.find(o => same(o.pick, skill.name));
  if (opt) return { rating: "target", why: `second armor line (${opt.by})` };
  return { rating: "neutral", why: "" };
}

export function soulBindingReport(K, e, it, status) {
  const slot = soulSlot(K, e);
  if (!slot || !it) return null;
  const lines = (it.subStats || []).map(l => ({ ...l, ...rateSoulLine(K, slot, l) }));
  const skills = (it.subSkills || []).map(k => ({ ...k, ...rateSkillLine(K, slot, k) }));
  const bad = [...lines, ...skills].filter(x => x.rating === "bad");
  const crafted = slot === "Rings" && (it.subStatCount || 0) + (it.subSkillCountMax || 0) > 0 && (it.subStatCount >= 5 || /splendent|crafted/i.test(e.name));
  // Bracelets are replaced with Ludra, so rebinding them now is wasted.
  const rebind = status === "keeper" && slot !== "Bracelets" && bad.length >= K.soulBinding.rebindAt.badLines;
  const missing = slot === "Rings" && !skills.some(k => K.soulBinding.ringSkills.required.some(r => same(r, k.name)));
  return { slot, lines, skills, bad, rebind, crafted, missingRequired: missing ? K.soulBinding.ringSkills.required : [] };
}

// Manastones: grade decides item level, stat decides damage.
export function rateStone(K, s) {
  const M = K.manastones;
  if (!s || s.empty) return { rating: "empty" };
  if (M.badPvp && isPvp(s.name)) return { rating: "bad", why: "PvP line on a PvE item" };
  if (s.grade === "Unique" && (lineIs(s.name, "Attack") || lineIs(s.name, "Damage Boost"))) return { rating: "lock", why: "gold Attack / Damage Boost — lock it" };
  if (M.bad.some(b => lineIs(s.name, b))) return { rating: "bad", why: "bad stat for PvE" };
  const i = M.goodOrder.findIndex(g => lineIs(s.name, g));
  if (i >= 0) return { rating: "good", why: `PvE stat #${i + 1}`, rank: i };
  return { rating: "neutral", why: "" };
}
export function stoneReport(K, stones) {
  const rated = stones.map(s => ({ ...s, ...rateStone(K, s) }));
  const attack = stones.filter(s => !s.empty && lineIs(s.name, "Attack")).reduce((n, s) => n + (parseFloat(String(s.value).replace(/[^\d.]/g, "")) || 0), 0);
  const whelps = rated.some(s => s.rating === "lock" && lineIs(s.name, "Attack"));
  const madsin = rated.some(s => s.rating === "lock" && lineIs(s.name, "Damage Boost")) || attack > K.manastones.lock.attackTotal;
  // Reroll order: lowest grade first, and at equal grade the bad stats first.
  const g = { Common: 1, Rare: 2, Legend: 3, Unique: 4 };
  const rerollOrder = rated.filter(s => !s.empty && s.rating !== "lock" && s.rating !== "good")
    .sort((a, b) => (g[a.grade] - g[b.grade]) || ((b.rating === "bad") - (a.rating === "bad")));
  return { rated, attack, done: { whelps, madsin }, rerollOrder, pvp: rated.filter(s => s.why === "PvP line on a PvE item") };
}

// Arcana: family from the name ("Chalice of Vigor"), divine stat from mainStats.
export function arcanaCheck(K, e, it) {
  const A = K.arcana;
  const type = Object.keys(A.slots).find(t => same(it?.categoryName, t) || norm(e.name).includes(norm(t)));
  if (!type) return null;
  const want = A.slots[type];
  const family = ["Vigor", "Magic"].find(f => norm(e.name).includes(norm(f))) || null;
  const stat = it?.mainStats?.[0]?.id || null;
  const skills = (it?.subSkills || []).map(k => ({ ...k, rating: A.uselessSkills.some(u => same(u, k.name)) ? "bad" : want.skills.some(w => same(w, k.name)) ? "target" : "neutral" }));
  const hit = skills.filter(k => k.rating === "target");
  return {
    slot: e.slotPosName, type, family, stat, want,
    familyOk: !want.family || want.family.includes(family),
    statOk: !want.stat || want.stat.includes(stat),
    skills, hasTarget: hit.length > 0, targetLevel: hit.reduce((n, k) => n + k.level, 0),
    targetOk: want.target ? hit.reduce((n, k) => n + k.level, 0) >= want.target : hit.length > 0,
    useless: skills.filter(k => k.rating === "bad"),
    level: e.enchantLevel || 0, maxLevel: it?.maxEnchantLevel ?? 5,
  };
}
export function arcanaSet(K, checks) {
  const vigor = checks.filter(c => c?.family === "Vigor").length, magic = checks.filter(c => c?.family === "Magic").length;
  return { vigor, magic, options: K.arcana.set.options.map(o => ({ ...o, ok: vigor >= o.min })) };
}

// Skill level from Daevanion nodes named "Skill Level Up - <skill>".
export function daevanionSkillLevels(boards) {
  const out = {};
  for (const b of Object.values(boards || {})) for (const n of b?.nodeList || [])
    if (n.open && n.type === "SkillLevel") { const k = norm(String(n.name).replace(/^skill level up\s*-\s*/i, "")); out[k] = (out[k] || 0) + 1; }
  return out;
}

// Condemnation to 20: where the levels come from and the cheapest way to the rest.
export function skillSum(K, { skillList = [], equipmentList = [], items = {}, boards = {} }, skill = K.condemnation.skill) {
  const row = skillList.find(s => same(s.name, skill));
  const total = row?.acquired ? row.skillLevel : 0;
  const dae = daevanionSkillLevels(boards)[norm(skill)] || 0;
  const lines = [];
  for (const e of equipmentList) for (const k of items[e.slotPos]?.subSkills || [])
    if (same(k.name, skill)) lines.push({ slot: e.slotPosName, item: e.name, level: k.level, card: e.slotPos >= 41, lineCount: (items[e.slotPos].subSkills || []).length,
      cardLevel: e.enchantLevel || 0, cardMax: items[e.slotPos].maxEnchantLevel ?? 5 });
  const gear = lines.reduce((n, l) => n + l.level, 0);
  const target = K.condemnation.target;
  const missing = Math.max(0, target - total);
  // Expected gain from leveling the cards that already carry the skill: each level hits one of the card's lines at random.
  const cardPaths = lines.filter(l => l.card && l.cardLevel < l.cardMax).map(l => ({
    ...l, levelsLeft: l.cardMax - l.cardLevel, expected: Math.round((l.cardMax - l.cardLevel) / Math.max(1, l.lineCount) * 10) / 10,
  }));
  return { skill, total, base: total - dae - gear, daevanion: dae, lines, gear, target, missing, cardPaths, expectedFromCards: Math.round(cardPaths.reduce((n, c) => n + c.expected, 0) * 10) / 10 };
}

// Titles: equipped title per slot vs. the best-in-slot chain, names resolved for the character's faction.
export function titleCheck(K, profile, titleList = []) {
  const T = K.titles, fac = T.factionNames[profile?.raceName] || null;
  const resolve = n => fac ? n.replace("{faction}", fac) : n;
  const anyFaction = n => Object.values(T.factionNames).map(f => n.replace("{faction}", f));
  return Object.entries(T.slots).map(([slot, chain]) => {
    const eq = titleList.find(t => norm(t.equipCategory) === norm(slot));
    const names = chain.map(c => resolve(c.name));
    const rank = eq ? chain.findIndex(c => (fac ? [resolve(c.name)] : anyFaction(c.name)).some(n => sameTitle(n, eq.name))) : -1;
    return { slot, equipped: eq?.name ?? null, effects: eq?.equipStatList?.map(s => s.desc) ?? [], rank, best: names[0], chain: chain.map((c, i) => ({ ...c, name: names[i] })),
      faction: fac, ok: rank === 0, fallback: rank > 0, offList: !!eq && rank < 0, owned: eq ? `${eq.ownedCount}/${eq.totalCount}` : null };
  });
}

export function daevanionWarnings(K, boards) {
  const D = K.daevanion, open = Object.values(boards || {}).flatMap(b => (b?.nodeList || []).filter(n => n.open));
  return D.avoid.map(a => ({ ...a, count: open.filter(n => lineIs(n.name, a.match)).length })).filter(a => a.count);
}

export function stigmaPreset(K, skillList = []) {
  const eq = skillList.filter(s => s.equip && /stigma|^dp$/i.test(s.category || "")).map(s => s.name);
  const fits = list => list.every(x => Array.isArray(x) ? x.some(y => eq.some(n => same(n, y))) : eq.some(n => same(n, x)));
  const match = Object.entries(K.stigmas.presets).find(([, list]) => fits(list))?.[0] ?? null;
  return { equipped: eq, match };
}

// Doctor findings from the build checks. impact: same scale as doctor.js (≈ item level, fixed weights for damage items).
export function buildFindings(K, d) {
  const out = [], add = (impact, title, why, action, gain, source) => out.push({ impact, title, why, action, gain, source });
  for (const t of d.titles || []) {
    if (t.slot === "Attack" && !t.ok && !t.fallback) add(9, `Attack title: “${t.equipped || "none"}”`, `Not on the attack-title list (${t.chain.map(c => c.name).join(" → ")}).`, `Equip ${t.chain[1].name} (${t.chain[1].effect}) until ${t.best}.`, "PvE damage", K.titles.source);
  }
  const rb = (d.soul || []).filter(r => r?.rebind);
  if (rb.length) add(5 + rb.length, `${rb.length} kept piece${rb.length > 1 ? "s" : ""} with ${K.soulBinding.rebindAt.badLines}+ bad soul-binding lines`, `Lines like ${[...new Set(rb.flatMap(r => r.bad.map(b => b.name)))].slice(0, 5).join(", ")} do nothing in PvE.`,
    `${rb.map(r => `${r.slot} → ${(K.soulBinding.targets[r.slot] || ["skill targets"]).join("/")}`).join("; ")}. ${K.soulBinding.rerollTools.text}`, "damage", K.soulBinding.source);
  const noReq = (d.soul || []).filter(r => r?.missingRequired?.length && r.status !== "replace");
  if (noReq.length) add(5, `${noReq.length} ring${noReq.length > 1 ? "s" : ""} you keep without ${noReq[0].missingRequired.join("/")}`, "Condemnation is the required ring skill line.",
    `Roll it once your cards can reach 20 — rings come last.${noReq.some(r => r.crafted) ? " " + K.soulBinding.ringSkills.craftedNote : ""}`, "Condemnation level", K.soulBinding.ringSkills.source);
  const pvp = (d.stones || []).filter(s => s.report.pvp.length && s.status === "keeper");
  if (pvp.length) add(4, `PvP manastones on ${pvp.length} PvE piece${pvp.length > 1 ? "s" : ""}`, "PvP lines do nothing in PvE.", `Reroll first at equal grade: ${pvp.map(s => `${s.slot} (${s.report.pvp.map(x => x.name).join(", ")})`).join("; ")}.`, "damage", K.manastones.source);
  const locks = (d.stones || []).flatMap(s => s.report.rated.filter(x => x.rating === "lock").map(x => `${s.slot} ${x.name} ${x.value}`));
  if (locks.length) add(3, `Lock ${locks.length} gold Attack/Damage Boost line${locks.length > 1 ? "s" : ""}`, "Stop criterion (Whelps): a gold Attack line on the piece.", `Lock before rerolling: ${locks.join(", ")}.`, "keeps damage", K.manastones.source);
  for (const a of d.arcana || []) {
    if (!a) continue;
    if (!a.familyOk || !a.statOk) add(5, `${a.type}: ${a.family || "?"} (${a.stat || "?"})`, `Guide wants ${a.want.family.join(" or ")}${a.want.stat ? ` (${a.want.stat.join("/")})` : ""}.`, `Swap for a ${a.want.family[0]} ${a.type} when one drops.`, "set / stat", K.arcana.source);
    if (!a.hasTarget) add(6, `${a.type}: no ${a.want.skills.join(" / ")} line`, a.want.note, "Keep looking — or transmute (one skill).", "skill levels", K.arcana.source);
    if (a.hasTarget && !a.targetOk) add(3, `${a.type}: ${a.want.skills[0]} +${a.targetLevel} of +${a.want.target}`, a.want.note, "Card levels on this card raise it at random — Training Arcana here first.", "skill levels", K.arcana.source);
    if (a.useless.length) add(1.5, `${a.type}: ${a.useless.length} useless skill line${a.useless.length > 1 ? "s" : ""}`, `${a.useless.map(u => u.name).join(", ")} — card levels can land there.`, "Prefer cards without them when you swap.", "skill levels", K.arcana.source);
  }
  const c = d.condemnation;
  if (c && c.missing) add(12, `${c.skill} ${c.total} → ${c.target}`, `${K.condemnation.share}. Now: base ${c.base} + Daevanion ${c.daevanion} + gear/cards ${c.gear} (${c.lines.map(l => `${l.slot} +${l.level}`).join(", ") || "none"}).`,
    `${c.cardPaths.length ? `Level ${c.cardPaths.map(p => `${p.slot} (+${p.levelsLeft} levels ≈ +${p.expected})`).join(", ")} first; ` : ""}then a Parchment with ${c.skill}, a ring line last.`, `+${c.missing} levels`, K.condemnation.source);
  const pr = d.stigmaLevels?.find(s => same(s.name, "Prayer of Amplification"));
  if (pr && pr.lvl < 20) add(14, `Prayer of Amplification ${pr.lvl} → 20`, K.stigmas.priority[1].note + " — second stigma to max.", "Stigma Shards.", "+15% Attack at 20", K.stigmas.source);
  for (const s of d.stats || []) if (s.value != null && s.min != null && s.value < s.min) add(10, `${s.name} ${s.value} → ${s.min.toLocaleString()}`, s.why, `Cheapest sources: ${K.stats.accuracySources.slice(0, 3).join(", ")}.`, "Ludra check", K.stats.source);
  if (d.consumablesMissing?.length && d.ilvl >= (d.raidIlvl ?? 2800) - 200) add(2, `${d.consumablesMissing.length} raid consumables not ready`, "Ludra pulls go better with every buff up.", `${d.consumablesMissing.join(", ")} — ${K.consumables.note}`, "damage", K.consumables.source);
  for (const w of d.daevanionWarnings || []) add(1, `Daevanion: ${w.count} “${w.match}” node${w.count > 1 ? "s" : ""} open`, w.why, "Next reset: route around them.", "points", K.daevanion.source);
  return out;
}
