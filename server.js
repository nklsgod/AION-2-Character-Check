// Local dev server. On Netlify, netlify/functions/api.mjs does the same job.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { handle } from "./lib/aion.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const mock = process.env.MOCK === "1"
  ? JSON.parse(readFileSync(path.join(__dirname, "public", "guide", "mock-character.json"), "utf8")) : null;

app.get("/api/:route", async (req, res) => {
  try { res.json(await handle(req.params.route, req.query, mock)); }
  catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});
app.use(express.static(path.join(__dirname, "public")));
app.listen(PORT, () => console.log(`Aion 2 Cleric Check → http://localhost:${PORT}${mock ? "  (MOCK mode)" : ""}`));
