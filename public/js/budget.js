// Time-based budgets: Odyle, Kinah, reward counts, weekly resets, transmute cooldowns. Pure functions.
const HOUR = 36e5, DAY = 24 * HOUR;
export const toDate = s => s instanceof Date ? s : new Date(String(s).length <= 10 ? s + "T00:00:00" : s);

// Weekly resets (Wednesday) strictly after `now` and before `end`.
export function resetsBetween(model, now, end) {
  const R = model.odyle.weeklyReset, out = [];
  const d = new Date(now); d.setHours(R.hour, 0, 0, 0);
  while (d.getDay() !== R.weekday || d <= now) d.setDate(d.getDate() + 1), d.setHours(R.hour, 0, 0, 0);
  for (; d < end; d.setDate(d.getDate() + 7)) out.push(new Date(d));
  return out;
}
// Weekly windows that overlap [now, end): the current one plus one per reset.
export const weeklyWindows = (model, now, end) => 1 + resetsBetween(model, now, end).length;

// Calendar days (local) from now's day up to the day before `end`, as Date objects at 00:00.
export function daysBetween(now, end) {
  const out = [], d = new Date(now); d.setHours(0, 0, 0, 0);
  for (; d < end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

// Odyle energy until `end`. inp: { odyle, membership, morph, event, windBreezeBoughtThisWeek, morphCraftedThisWeek, matOdyle, matFine, matPure }
export function odyleBudget(model, inp, now, end) {
  const O = model.odyle, E = O.itemEnergy;
  now = toDate(now); end = toDate(end);
  const hours = Math.max(0, (end - now) / HOUR);
  const regen = Math.floor(hours / 3) * O.regen.per3h;
  const windows = weeklyWindows(model, now, end);
  const wb = inp.membership ? Math.max(0, windows * O.windBreeze.itemsPerWeek - (inp.windBreezeBoughtThisWeek || 0)) : 0;
  const M = O.substanceMorph.materials, mats = [["matOdyle", M.odyle], ["matFine", M.fine], ["matPure", M.pure]];
  // Craft materials limit Substance Morph once any of them is entered (not entered = no limit).
  const byMats = mats.some(([k]) => inp[k] != null) ? Math.min(...mats.map(([k, n]) => Math.floor((inp[k] || 0) / n))) : Infinity;
  const morph = inp.morph === false ? 0 : Math.min(byMats, Math.max(0, windows * O.substanceMorph.itemsPerWeek - (inp.morphCraftedThisWeek || 0)));
  const from = toDate(O.event.from), to = toDate(O.event.to);
  const eventDays = inp.event === false ? 0 : daysBetween(now, end).filter(d => d >= from && d <= to).length;
  const event = eventDays * O.event.itemsPerDay;
  const parts = { stock: inp.odyle || 0, regen, windBreeze: wb * E, morph: morph * E, event: event * E };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    days: Math.round(hours / 24 * 10) / 10, windows, parts, total,
    items: { windBreeze: wb, morph, event }, morphByMats: byMats,
    kinah: { windBreeze: wb * O.windBreeze.kinahEach, morph: morph * O.substanceMorph.kinahEach },
    cap: inp.membership ? O.regen.cap.membership : O.regen.cap.base,
    cubes: Math.floor(total / E),
  };
}

// Reward counts until `end`; each clear opens the cube once, twice with membership.
// Transcendence: stored counts per dungeon, the daily regen is one shared pool.
export const TRANSCENDENCE = ["Deus Research Base", "Shattered Arkanis"];
export function rewardCounts(model, inp, now, end) {
  const C = model.odyle.rewardCounts;
  now = toDate(now); end = toDate(end);
  const days = Math.max(0, (end - now) / DAY);
  const conquest = Object.fromEntries(C.conquest.dungeons.map(d => [d, (inp.counts?.[d] || 0) + Math.floor(days * C.conquest.perDay)]));
  const transcendence = { ...Object.fromEntries(TRANSCENDENCE.map(d => [d, inp.counts?.[d] || 0])), shared: Math.floor(days * C.transcendence.perDay) };
  const exploration = weeklyWindows(model, now, end) * C.exploration.perWeek;
  const opens = inp.membership && model.odyle.secondOpen.membershipOnly ? 2 : 1;
  return { conquest, transcendence, exploration, opens };
}

// Cubes you can actually open: Odyle and reward counts both limit it. Reports which one binds.
export function effectiveCubes(model, inp, now, end) {
  const o = odyleBudget(model, inp, now, end), c = rewardCounts(model, inp, now, end);
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const byCounts = (sum(c.conquest) + sum(c.transcendence)) * c.opens;
  return { odyle: o, counts: c, byOdyle: o.cubes, byCounts, cubes: Math.min(o.cubes, byCounts), binding: o.cubes <= byCounts ? "Odyle" : "reward counts" };
}

// Kinah until `end`: stock + daily cap per day + optional income from alts.
export function kinahBudget(model, inp, now, end) {
  const days = Math.max(0, (toDate(end) - toDate(now)) / DAY);
  return { stock: inp.kinah || 0, earned: Math.floor(days * model.kinah.dailyCap), alts: Math.floor(days * (inp.kinahPerDayAlts || 0)), get total() { return this.stock + this.earned + this.alts; } };
}

// Transmute dates: first one now (or when the cooldown from the last one ends), then every N days, before `end`.
export function transmuteDates(model, inp, now, end) {
  const cd = model.arcana.transmute.cooldownDays * DAY;
  now = toDate(now); end = toDate(end);
  let t = inp.lastTransmute ? new Date(Math.max(+now, +toDate(inp.lastTransmute) + cd)) : new Date(now);
  const out = [];
  for (; t < end; t = new Date(+t + cd)) out.push(t);
  return out;
}

// Seeded PRNG (mulberry32) so simulations are repeatable in tests.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
