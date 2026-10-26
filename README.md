# Aion 2 Cleric Check

Enter your character name → the page reads your character from NCSOFT's official
character lookup and compares skills, stigmas, passives, gear lines, stats, wings,
titles and Daevanion boards with the Cleric build on
(plus a "Ready for Ludra?" check with the item-level roadmap to 2,800) at
https://aion2-guides.info/en/cleric/ (PvE, PvE with Chanter, PvP).

## Run it

```bash
npm install
npm start          # → http://localhost:3000
```

Try the UI without the live API (fake character):

```bash
npm run mock       # Windows PowerShell: $env:MOCK=1; node server.js
```

## Tests

```bash
npm test
```

`test/fixtures/nkls.json` is a real character read from the API (item level 2,540). The model has to
rebuild that number from its parts (gear, enhancement, manastones, Arcana, Daevanion) within ±10.

## Deploy on Netlify (serverless, free)

The page is static and the proxy is one Netlify Function (`netlify/functions/api.mjs`),
so no server is needed.

**Easiest:** push this folder to GitHub, then on app.netlify.com choose
"Add new site → Import an existing project" and pick the repo. `netlify.toml`
already sets `publish = "public"` and the functions folder, so no settings
to fill in. Every push redeploys.

**Or from the terminal:**

```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod      # pick "create & configure a new site"
```

`netlify dev` runs the site locally with the function, same as `npm start`.

Note: the function has no persistent cache between cold starts, so the in-memory
10-minute cache only helps while an instance stays warm. Netlify adds
`Cache-Control: max-age=300` on the responses, which covers repeat lookups.

## How it works

```
browser ──/api/search────▶ server.js / Netlify fn ──▶ api-search.plaync.com/aion2global/search/v2/character
browser ──/api/character─▶ server.js ──▶ aion2.plaync.com/api/character/info
browser ──/api/equipment─▶ server.js ──▶ aion2.plaync.com/api/character/equipment
browser ──/api/item──────▶ server.js ──▶ aion2.plaync.com/api/character/equipment/item
```

The browser cannot call plaync.com directly (CORS), so `lib/aion.js` is a small
proxy, served either by `server.js` (local Express) or by the Netlify Function. It adds the `region`/`lang` parameters, throttles to ~4 requests
per second and caches every answer for 10 minutes.

* `lib/aion.js` – the proxy logic shared by both entry points.
* `public/guide/cleric.json`, `public/guide/gladiator.json` – the build targets, transcribed
  from the guides. The page picks the file from the character's class. To add a class, copy
  one of them and add its name to `GUIDES` in `index.html`.
* `public/index.html` – the page (HTML, CSS and the UI code).
* `public/js/core.js`, `doctor.js`, `calc.js` – item-level model, Gear Doctor rules and the
  upgrade calculator as plain ES modules (no DOM), shared by the page and the tests.
* `public/guide/ilvl-model.json` – every number the model uses (stone and card values, Daevanion
  node costs, prices, drop rates, Odyle), each with its source and `confidence`
  (confirmed / inferred / unknown). Edit this when a value turns out wrong.
* `public/guide/mock-character.json` – sample API answers for `npm run mock`.

## Caveats

* The API is **unofficial**: it is what NCSOFT's own character page uses. Endpoint
  paths, parameters and field names were taken from the open-source client
  `github.com/nuriland/aion2-api` (Oct 2026). If NCSOFT renames a field the
  comparison may show "not learned" or empty lines — open the Network tab on
  https://aion2.plaync.com's character page and adjust the names in `index.html`.
* Skill names are matched by name (case/apostrophe-insensitive), so the profile
  is read in English (`lang=en-US`).
* Not affiliated with NCSOFT or aion2-guides.info.
