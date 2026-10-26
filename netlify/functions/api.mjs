// Netlify Function: every /api/* request lands here (see netlify.toml).
import { handle } from "../../lib/aion.js";

export const config = { path: "/api/*" };

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  const q = Object.fromEntries(url.searchParams);
  try {
    const body = await handle(route, q, null);
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 502 });
  }
};
