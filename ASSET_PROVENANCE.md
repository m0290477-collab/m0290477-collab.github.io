# Super Snake — asset provenance

Checked 2026-10-29 against the published site (billke.com, commit d03083e, index.html md5 664d83bdcce73aa3b312c800076382e7).
How it was traced: embedded metadata in the master files (IPTC `DigitalSourceType = trainedAlgorithmicMedia`,
"Made with Google AI" credit, C2PA manifest), the build scripts that turned masters into the shipped WebP files,
pixel comparison of shipped files against masters, and the project's build notes and chat history.
The shipped WebP files themselves carry no metadata (it is dropped on conversion), so the trail runs through the masters.

Legend: **AI (verified)** = master carries Google AI IPTC/C2PA metadata. **AI (inferred)** = build notes say the art was
generated with Hark's image tool and/or the master has the image model's typical output size (1024², 1408×768, 1376×768),
but the kept copy has no metadata (it was keyed/recoloured). **Code** = drawn or synthesised by project code.

| Shipped path | Files | Master / source | How it became the shipped file | Origin |
|---|---|---|---|---|
| `maps/tx_*.webp` (20 arena floors) | 20 | `work/ss13d/src/tx_*.png` | `ss13d/mktex.py` (crop, seamless tile, flatten light) | AI (verified, Google AI IPTC + C2PA) |
| `maps/tx_s1royal.webp` | 1 | `work/ss13s_pass/art/src/s1_tx.png` | `ss13s_pass/art/mk_assets.py` resize | AI (verified) |
| `maps/th_*.webp` (arena thumbnails) | 28 | `work/ss13d/maps/` | no generator script found; look like renders of the arena floors | **Unknown — see flags** |
| `avatars/*.webp` (portraits) | 28 | `work/ss13g/av_src/av_*.png` (28) | `ss13g` build: trim, resize to WebP | AI (verified, all 28 masters) |
| `ui/ar/a1–a7, a13–a24, a26` (arena previews) | 20 | `work/ss13h/ar_src/*.png` (976×1098) | `ss13s_daily/art/mk_hires.py`, matched by pixel compare (error 0) | AI (verified) |
| `ui/ar/a0, a8–a12, a25, a27` | 8 | `work/mock14/assets/ar_{neon,dunes,jungle,snow,lava,ocean,sakura,crystal}.webp` (pixel match, error ≤3) | crops of `mock14/assets/arenas_sheet.png` | AI (verified on the sheet) |
| `ui/ar/a28` (Throne Arena) | 1 | `work/ss13s_pass/art/src/s1_arena.png` | `mk_assets.py` crop 320:360 → 640×720 (md5 identical to `ss13s_pass/assets/ui/ar/a28.webp`) | AI (verified) |
| `ui/ic/*.webp` (35 UI icons) | 35 | `work/mock14/assets/i_*.png` (256 px) cut from icon sheets `sheetA/B/C.png`; `sheetC_m.png` (raw) | `ss13s_daily/art/mk_hires.py` (2× redraw from masters) | AI (verified for `sheetC_m.png`; sheets A/B are keyed copies → inferred) |
| `ui/md/*.webp` (42 medals) | 24 | `work/ss13k/medals/medals_sheet1–4.png` (1408×768) → `ss13k/medals/out/` | sliced from sheets | AI (inferred: generator output size, no metadata kept) |
| | 12 + 1 | `work/ss13s/art/ss13s1_{gm,w1,tu}_base.png` ("bases generated", ss13s PROGRESS); `pt_1000`, `kills_1000` existing medals | `ss13s/art/recolor.py` (hue variants g/r/p, `kills_p`) | AI (inferred) |
| | 5 | `work/ss13s_profile/art/pt_{60,300,1000,3000,10000}.png` ("generated art", ss13s_profile STATUS) | resize | AI (inferred) |
| `ui/p10/*.webp` (22) | 22 | data-URI images extracted by `ss13o/p13o_80_assets.py` from the build10 page; masters in `work/ss10/art/` | `tx1–7` ← `t_*.png`; `city`, `event` ← `city10/event10.png`; `logo` ← `logo10.png`; chests/coins/gems/pot/sn* ← `items10/icons10/snakes10.png` sheets | AI (verified: tx1–7, city, event); AI (inferred: logo, chests, coins, gems, pot, snake icons — 1408×768 / 1280×832 keyed sheets) |
| `ui/s1/*.webp` (Season 1 pass art) | 5 | `work/ss13s_pass/art/src/s1_{arena,frame,fx,skin,trail}.png` | `mk_assets.py` despill/trim → 512 px (md5 identical to `ss13s_pass/assets/ui/s1/`) | arena: AI (verified); frame/fx/skin/trail: AI (inferred, green-screen keyed, no metadata) |
| `ui/dr/*.webp` (Daily rewards) | 10 | `work/ss13s_daily/art/gen_{coin,coins,gem,chest_closed,chest_open,crown}.png` | `ss13s_daily/art/mk_assets.py` (despill, trim, resize) | AI (inferred: AUDIT.md "new art, generated to match the wallet coin and gem"; `ref_*.png` are crops of the game's own older art used as references) |
| `ui/bg2.webp`, `ui/bn_*.webp`, `ui/story_map.webp` | 7 | `work/mock14/assets/bg2.png`, `banner_*.png`, `story_map.png` | resize / blur | AI (verified) |
| `ui/soul/assets/*.webp` | 13 | `work/soul/raw/soul_*.png` | `soul/tools/sprites.py` | AI (verified); `soul/PLAN.md`: "Art was generated for this project (no third-party IP)" |
| `ui/soul/assets/audio/*` (music + sfx) | 24 | `soul/tools/audio.py`, `music.py` | numpy → WAV → OGG/MP3 | Code (synthesised, original) |
| `og.jpg` (share image) | 1 | `work/og.jpg` | — | AI (verified) |
| `mail-logo.png` | 1 | `work/ss13n/mail-logo.png` | — | no metadata; inferred derived from the app icon art (not verified) |
| `ui/fonts/*.woff2` | 5 | Google Fonts | subsets | SIL OFL 1.1 — see `ui/fonts/OFL.txt` |
| In-page vector art (snakes, food, HUD, minimap) | — | `index.html` | canvas/CSS code | Code |

## Flags — origin not fully established
1. `maps/th_*.webp` (28 arena thumbnails): no generator script or master found. They are most likely in-game renders of the
   AI arena floors, but this is not proven.
2. `mail-logo.png`: no metadata or build script found.
3. AI (inferred) groups above — medals (`ui/md`), most `ui/p10` sprites, `ui/s1` frame/fx/skin/trail, `ui/dr`, icon sheets A/B:
   the build notes and image sizes point to Hark's image tool, but the kept masters were processed and lost the AI metadata.
   No sign of third-party or stock art was found for any of them.
4. Style references the owner supplied (`work/ref_profile/*.jpeg` — screenshots of another game's medal/profile screens,
   `work/ss13s/own/*` — his iPhone screenshots, and his "Legendary Arena" mockups) were used only as style references and are
   not shipped. A side-by-side check of the medal set against `ref_profile/medals_ref.jpeg` shows no copied designs or text.

## Notes
- Keep the masters (`work/…` paths in the Hark workspace) as the record of origin.
- No asset from another game, stock library or font foundry other than the OFL fonts was found.
