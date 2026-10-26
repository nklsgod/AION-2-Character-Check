// Pure logic shared by the page and the tests (no DOM here).

export const norm = s => String(s ?? "").toLowerCase().replace(/[’'`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const same = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

// Stats: exact type/name first; fuzzy only if nothing matches exactly, and never the item-level row
// (its name is Korean, "아이템레벨", which normalizes to an empty string).
export const findStat = (list, n) => {
  const k = norm(n);
  if (!k) return undefined;
  return list.find(s => norm(s.type) === k || norm(s.name) === k)
    || list.find(s => norm(s.type) !== "itemlevel" && (norm(s.type).startsWith(k) || norm(s.name).startsWith(k)))
    || list.find(s => norm(s.type) !== "itemlevel" && (same(s.type, n) || same(s.name, n)));
};

// Titles: guides and transcripts misspell them, so compare without filler words and through known aliases.
const TITLE_ALIASES = { "through heaven back": "through hell back" };
const titleKey = s => { const k = norm(s).replace(/\b(and|of|the)\b/g, " ").replace(/\s+/g, " ").trim(); return TITLE_ALIASES[k] || k; };
export const sameTitle = (a, b) => { const x = titleKey(a), y = titleKey(b); return !!x && x === y; };

export const isArcana = e => e.slotPos >= 41 || /arcana/i.test(e.slotPosName || "");

// Item level of one equipped piece: base + enhancement + amplification + manastones.
// `item` is the /api/item answer; null while it hasn't arrived.
export function pieceIlvl(model, e, item) {
  const stones = (item?.magicStoneStat || []).reduce((n, m) => n + (model.stone.byGrade[m.grade] ?? 0), 0);
  const enchant = (e.enchantLevel || 0) * model.item.enchant.perLevel;
  const amp = (e.exceedLevel || 0) * model.item.amplification.perLevel;
  const base = item?.level ?? 0;
  return { base, enchant, amp, stones, total: base + enchant + amp + stones };
}

// Daevanion points spent on one board = sum of the cost of every open node (the Start node is free).
export function boardPoints(model, board) {
  return (board?.nodeList || []).filter(n => n.open && n.type !== "Start")
    .reduce((n, x) => n + (model.daevanion.nodeCost[x.grade] ?? 1), 0) * model.daevanion.perPoint;
}

// The whole breakdown. `boards` maps boardId → /api/daevanion answer (missing ones are reported, not guessed).
export function ilvlBreakdown(model, { statList = [], equipmentList = [], items = {}, boards = {}, boardIds = [] }) {
  const parts = { gear: 0, enchant: 0, amplification: 0, stones: 0, arcana: 0, daevanion: 0 };
  const missingItems = [];
  for (const e of equipmentList) {
    const it = items[e.slotPos];
    if (!it || it.failed) { missingItems.push(e.slotPosName); continue; }
    const p = pieceIlvl(model, e, it);
    if (isArcana(e)) parts.arcana += p.base + p.enchant;
    else { parts.gear += p.base; parts.enchant += p.enchant; }
    parts.amplification += p.amp; parts.stones += p.stones;
  }
  const missingBoards = boardIds.filter(id => !boards[id]);
  for (const id of boardIds) if (boards[id]) parts.daevanion += boardPoints(model, boards[id]);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const api = findStat(statList, "ItemLevel")?.value ?? null;
  const complete = !missingItems.length && !missingBoards.length;
  return { parts, total, api, unexplained: api == null ? null : api - total, complete, missingItems, missingBoards };
}
