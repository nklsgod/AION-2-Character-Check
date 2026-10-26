// Shared proxy logic: used by server.js (local) and netlify/functions/api.mjs (Netlify).
// Hosts, paths and parameter names come from github.com/nuriland/aion2-api.

export const REGIONS = {
  eu:  { label: "Europe",        shard: "eu"  },
  nae: { label: "NA East",       shard: "nae" },
  naw: { label: "NA West",       shard: "naw" },
  la:  { label: "Latin America", shard: "la"  },
  as:  { label: "Asia / Japan",  shard: "as"  },
};
const SITE = "https://aion2.plaync.com";
const SEARCH = "https://api-search.plaync.com/aion2global/search/v2/character";
const LANG = "en-US";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let last = 0;
const GAP = 250;
const cache = new Map();

async function upstream(url) {
  const hit = cache.get(url);
  if (hit && hit.exp > Date.now()) return hit.body;
  const wait = Math.max(0, last + GAP - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise(r => setTimeout(r, wait));
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Referer: SITE + "/" } });
  if (!res.ok) throw Object.assign(new Error(`NCSOFT answered ${res.status}`), { status: 502 });
  const body = await res.json();
  cache.set(url, { body, exp: Date.now() + 10 * 60 * 1000 });
  return body;
}
const siteUrl = (p, params) => `${SITE}${p}?${new URLSearchParams({ lang: LANG, ...params })}`;
const bad = msg => Object.assign(new Error(msg), { status: 400 });

// route: "regions" | "search" | "character" | "equipment" | "item"; q: plain object of query params
export async function handle(route, q, mock) {
  if (route === "regions") return REGIONS;
  if (mock) {
    if (route === "search") return mock.search;
    mock = mock.others?.[q.characterId] || mock; // extra mock characters, keyed by characterId
    if (route === "character") return mock.character;
    if (route === "equipment") return mock.equipment;
    if (route === "item") return mock.items[q.slotPos] || {};
  }
  const shard = REGIONS[q.region]?.shard;
  if (!shard) throw bad("unknown region");
  const { serverId, characterId } = q;
  switch (route) {
    case "search": {
      const name = String(q.name || "").trim();
      if (!name) throw bad("name is required");
      const p = new URLSearchParams({ keyword: name, page: "1", size: "40", region: shard, localeInfo: LANG });
      if (q.race) p.set("race", q.race);
      // Common names have many hits; read up to 3 pages (120 rows) so an exact match isn't cut off.
      const data = await upstream(`${SEARCH}?${p}`);
      data.list ||= [];
      for (let page = 2; page <= Math.min(data.pagination?.endPage || 1, 3); page++) {
        p.set("page", String(page));
        data.list.push(...((await upstream(`${SEARCH}?${p}`)).list || []));
      }
      for (const row of data.list) {
        row.characterId = decodeURIComponent(row.characterId || "");
        row.name = String(row.name || "").replace(/<[^>]*>/g, ""); // search highlights the hit with <strong>
      }
      return data;
    }
    case "character": return upstream(siteUrl("/api/character/info", { region: shard, serverId, characterId }));
    case "equipment": return upstream(siteUrl("/api/character/equipment", { region: shard, serverId, characterId }));
    case "item": return upstream(siteUrl("/api/character/equipment/item",
      { region: shard, serverId, characterId, id: q.id, enchantLevel: q.enchantLevel, slotPos: q.slotPos }));
    default: throw Object.assign(new Error("not found"), { status: 404 });
  }
}
