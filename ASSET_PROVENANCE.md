# Super Snake — asset provenance

Checked 2026-10-29 against the published site (billke.com, commit d03083e, index.html md5 664d83bdcce73aa3b312c800076382e7).
Updated 13u (2026-10-29): arena thumbnails regenerated, mail-logo rebuilt from its verified master, keyed (transparent) art confirmed by tool fingerprint.
How it was traced: embedded metadata in the master files (IPTC `DigitalSourceType = trainedAlgorithmicMedia`,
"Made with Google AI" credit, C2PA manifest), the build scripts that turned masters into the shipped WebP files,
pixel comparison of shipped files against masters, and the project's build notes and chat history.
The shipped WebP files themselves carry no metadata (it is dropped on conversion), so the trail runs through the masters.

Legend: **AI (verified)** = master carries Google AI IPTC/C2PA metadata. **AI (confirmed, tool fingerprint)** = transparent
master saved by Hark's image tool with `transparent_background` on. That mode strips all metadata, so these masters can't carry it;
instead they match the tool's keyed-output fingerprint, checked against a fresh test output from the same tool on 2026-10-29
(`work/ss13u_assets/gen/test_keyed_output_probe.png`): RGBA, alpha strictly 0 or 255 (no partial alpha), every transparent pixel
stored as RGB 0,0,0, no IPTC/XMP/C2PA, model output size. Script: `work/ss13u_assets/keysig.py`, results in `keysig_results.txt`.
**Code** = drawn or synthesised by project code.

| Shipped path | Files | Master / source | How it became the shipped file | Origin |
|---|---|---|---|---|
| `maps/tx_*.webp` (20 arena floors) | 20 | `work/ss13d/src/tx_*.png` | `ss13d/mktex.py` (crop, seamless tile, flatten light) | AI (verified, Google AI IPTC + C2PA) |
| `maps/tx_s1royal.webp` | 1 | `work/ss13s_pass/art/src/s1_tx.png` | `ss13s_pass/art/mk_assets.py` resize | AI (verified) |
| `maps/th_*.webp` (arena thumbnails) | 28 | `work/ss13u_assets/gen/ss13u_th_{0..27}.png` (1312×816, new in 13u, each generated with its own arena floor master as the reference: arenas 0–7 `ss10/art/t_*.png`, 8–27 `ss13d/src/tx_*.png`) | `ss13u_assets/mk_thumbs.py` (centre crop 16:10, 240×150, colour matched to the arena's floor master, in-game dim veil) | AI (verified, all 28 masters Google AI IPTC + C2PA). Not referenced by the current client (picker uses `ui/ar/a*.webp` since 13h). Earlier thumbnails of unknown origin replaced. |
| `avatars/*.webp` (portraits) | 28 | `work/ss13g/av_src/av_*.png` (28) | `ss13g` build: trim, resize to WebP | AI (verified, all 28 masters) |
| `ui/ar/a1–a7, a13–a24, a26` (arena previews) | 20 | `work/ss13h/ar_src/*.png` (976×1098) | `ss13s_daily/art/mk_hires.py`, matched by pixel compare (error 0) | AI (verified) |
| `ui/ar/a0, a8–a12, a25, a27` | 8 | `work/mock14/assets/ar_{neon,dunes,jungle,snow,lava,ocean,sakura,crystal}.webp` (pixel match, error ≤3) | crops of `mock14/assets/arenas_sheet.png` | AI (verified on the sheet) |
| `ui/ar/a28` (Throne Arena) | 1 | `work/ss13s_pass/art/src/s1_arena.png` | `mk_assets.py` crop 320:360 → 640×720 (md5 identical to `ss13s_pass/assets/ui/ar/a28.webp`) | AI (verified) |
| `ui/ic/*.webp` (35 UI icons) | 35 | `work/mock14/assets/i_*.png` (256 px) cut from icon sheets `sheetA/B/C.png` (`mock14/assets/slice.py`); `sheetC_m.png` (raw) | `ss13s_daily/art/mk_hires.py` (2× redraw from masters) | AI (verified for `sheetC_m.png`, `sheetC.png` is its keyed copy); sheets A/B: AI (confirmed, tool fingerprint) |
| `ui/md/*.webp` (42 medals) | 24 | `work/ss13k/medals/medals_sheet1–4.png` (1408×768) → `ss13k/medals/out/` | sliced from sheets | AI (confirmed, tool fingerprint: all 4 sheets) |
| | 12 + 1 | `work/ss13s/art/ss13s1_{gm,w1,tu}_base.png` ("bases generated", ss13s PROGRESS); `pt_1000`, `kills_1000` existing medals | `ss13s/art/recolor.py` (hue variants g/r/p, `kills_p`) | AI (confirmed, tool fingerprint: all 3 bases; `pt_1000`/`kills_1000` come from the medal sheets above) |
| | 5 | `work/ss13s_profile/art/pt_{60,300,1000,3000,10000}.png` ("generated art", ss13s_profile STATUS) | resize | AI (confirmed, tool fingerprint: all 5) |
| `ui/p10/*.webp` (22) | 22 | data-URI images extracted by `ss13o/p13o_80_assets.py` from the build10 page; masters in `work/ss10/art/` | `tx1–7` ← `t_*.png`; `city`, `event` ← `city10/event10.png`; `logo` ← `logo10.png`; chests/coins/gems/pot/sn* ← `items10/icons10/snakes10.png` sheets | AI (verified: tx1–7, city, event); logo, chests, coins, gems, pot, snake icons: AI (confirmed, tool fingerprint: `icons10`, `items10`, `snakes10` 1408×768, `logo10` 1280×832) |
| `ui/s1/*.webp` (Season 1 pass art) | 5 | `work/ss13s_pass/art/src/s1_{arena,frame,fx,skin,trail}.png` | `mk_assets.py` despill/trim → 512 px (md5 identical to `ss13s_pass/assets/ui/s1/`) | arena: AI (verified); frame/fx/skin/trail: AI (confirmed, tool fingerprint: all 4) |
| `ui/dr/*.webp` (Daily rewards) | 10 | `work/ss13s_daily/art/gen_{coin,coins,gem,chest_closed,chest_open,crown}.png` | `ss13s_daily/art/mk_assets.py` (despill, trim, resize) | AI (confirmed, tool fingerprint: all 6 `gen_*.png`; `gen_chest_closed` 1054×1008 and `gen_chest_open` 1024×1031 are not standard model sizes, so those two were probably trimmed after generation; AUDIT.md: "new art, generated to match the wallet coin and gem"; `ref_*.png` are crops of the game's own older art used as references) |
| `ui/bg2.webp`, `ui/bn_*.webp`, `ui/story_map.webp` | 7 | `work/mock14/assets/bg2.png`, `banner_*.png`, `story_map.png` | resize / blur | AI (verified) |
| `ui/soul/assets/*.webp` | 13 | `work/soul/raw/soul_*.png` | `soul/tools/sprites.py` | AI (verified); `soul/PLAN.md`: "Art was generated for this project (no third-party IP)" |
| `ui/soul/assets/audio/*` (music + sfx) | 24 | `soul/tools/audio.py`, `music.py` | numpy → WAV → OGG/MP3 | Code (synthesised, original) |
| `og.jpg` (share image) | 1 | `work/og.jpg` | — | AI (verified) |
| `mail-logo.png` | 1 | `/workspace/super-snake-icon-pro.png` (1408×768, app-icon master) | `ss13u_assets/mk_mail_logo.py` (centre square crop → 180 px, 128-colour PNG), rebuilt in 13u | AI (verified, master Google AI IPTC + C2PA). The previous file was a 48-colour 180 px downscale of the 1024 app icon (mean pixel error ≈5/255 vs that icon), so it showed the same art. |
| `ui/fonts/*.woff2` | 5 | Google Fonts | subsets | SIL OFL 1.1 — see `ui/fonts/OFL.txt` |
| In-page vector art (snakes, food, HUD, minimap) | — | `index.html` | canvas/CSS code | Code |

## Flags — origin not fully established
1. Resolved in 13u: `maps/th_*.webp` (new AI masters) and `mail-logo.png` (rebuilt from the verified app-icon master).
2. The keyed groups (medals `ui/md`, icon sheets A/B, `ui/p10` sprites, `ui/s1` frame/fx/skin/trail, `ui/dr`) are confirmed by
   the image tool's fingerprint, not by embedded metadata, because transparent output from the tool never has metadata. The
   fingerprint is strong evidence but not cryptographic proof: a hand-made PNG keyed the same way would look the same.
   The chat journal holds only messages, not tool calls, so it can't add proof. It does show the art being made for this
   project (for example `medals_grid.png` and `super-snake-ui-icons-preview.png` posted on 2026-10-26/28).
   Nothing in these groups is still unexplained.
3. Not covered by this check: the 1024 App Store icon (`super-snake-icon-pro-1024.png`, AppIcon) has no metadata. It looks like
   a reframed square of the verified `super-snake-icon-pro.png`, but the pixels are not identical (reframed or outpainted).
4. Style references the owner supplied (`work/ref_profile/*.jpeg` — screenshots of another game's medal/profile screens,
   `work/ss13s/own/*` — his iPhone screenshots, and his "Legendary Arena" mockups) were used only as style references and are
   not shipped. A side-by-side check of the medal set against `ref_profile/medals_ref.jpeg` shows no copied designs or text.

## Country flags (build 13u botprof)
- `ui/flags/*.webp` (197, 96x72): rasterised in headless Chromium from flag-icons 7.2.3 (MIT, see THIRD_PARTY_LICENSES.md); master PNGs in `work/ss13u_botprof/flags_png/`, script `work/ss13u_botprof/rast.py`.

## Notes
- Keep the masters (`work/…` paths in the Hark workspace) as the record of origin.
- No asset from another game, stock library or font foundry other than the OFL fonts was found.

## Redesign A "STRIKE" (added 2026-10-31, `ui/sa/**`)
- `ui/sa/**/*.svg` (line icons, coin/gem marks, medals, product marks, wordmark `logo.svg`, backgrounds): drawn in code for this project (`work/ss_redesign/apply/make_assets.py`, `mklogo.py`). Original.
- `ui/sa/hero.webp`, `ui/sa/hero_rtl.webp` (mirror): from master `work/ss_redesign/art/heroA.webp`, generated for this project with Hark's image tool (AI). `ui/sa/arena.webp`: thumbnail of `work/ss_redesign/art/prevA.jpg`, redesign mockup art made during the 2026-10-31 design pass (exact tool not re-traced; treat as AI-generated until checked).
- `ui/sa/f/*.woff2`: subsets of Barlow, Barlow Condensed and Cairo (SIL OFL 1.1, see THIRD_PARTY_LICENSES.md).
