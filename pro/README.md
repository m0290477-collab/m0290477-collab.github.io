# Super Snake Pro (preview at /pro/)

Premium 3D build of Super Snake. The root game (`/index.html`) is untouched.

- `index.html`, `css/app.css` — UI shell (no external fonts/CDNs; everything self-hosted)
- `js/sim.js` — shared fixed-step simulation (used by the browser AND the online server)
- `js/render3d.js` — Three.js r169 renderer (self-hosted in `js/vendor/`, MIT licence in `THREE-LICENSE.txt`)
- `js/render2d.js` — Canvas 2D fallback (no WebGL / very slow devices)
- `js/game.js` — loop, modes (Classic, Time Attack, Survival, Zen, Online), effects, auto quality
- `js/net.js` — online client: prediction + reconciliation for your snake, interpolation for others, instant self-reported death
- `js/store.js` — local accounts (PBKDF2), read-only migration from the day-1 saves, progression, missions, achievements
- `server/index.js` — Cloudflare Worker + Durable Object `super-snake-online` (deployed separately; this copy is the source)

Storage keys used by Pro: `ssp-acc`, `ssp-guest`, `ssp-set`, `ssp-cur`, `ssp-rem`. Day-1 keys (`ss-acc`, `ss-lang`) are only read.
