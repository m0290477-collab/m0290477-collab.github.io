# Super Snake — third-party licenses

The game code (index.html, ios-bridge.js, server and realtime worker) is original to the project and contains no bundled
third-party JavaScript libraries. Third-party components:

## Web (billke.com) and iOS app

| Component | Version | License | Where | Notice |
|---|---|---|---|---|
| Baloo 2 (ExtraBold; Latin + Devanagari subsets) | 1.700 | SIL Open Font License 1.1 | `ui/fonts/baloo2-800.woff2`, `ui/fonts/b2-dev-800.woff2` | Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2) |
| Baloo Bhaijaan 2 (ExtraBold; Arabic subset) | 1.701 | SIL Open Font License 1.1 | `ui/fonts/bb2-ar-800.woff2` | Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2) |
| Nunito | 3.602 | SIL Open Font License 1.1 | `ui/fonts/nunito.woff2` | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) |
| Cairo (Arabic subset) | 3.130 | SIL Open Font License 1.1 | `ui/fonts/cairo-ar.woff2` | Copyright 2009 The Cairo Project Authors (https://github.com/Gue3bara/Cairo) |

Full font license text: `ui/fonts/OFL.txt`.

## iOS app only (m0290477-collab/super-snake-ios)

| Component | Version | License | Source |
|---|---|---|---|
| @capacitor/core, @capacitor/ios, @capacitor/cli | 8.6.0 | MIT | https://github.com/ionic-team/capacitor |
| capacitor-swift-pm (Capacitor + Cordova Swift packages) | 8.6.0 | MIT | https://github.com/ionic-team/capacitor-swift-pm |
| @capacitor/app | 8.1.2 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/browser | 8.0.5 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/haptics | 8.0.2 | MIT | https://github.com/ionic-team/capacitor-haptics |
| @capacitor/preferences | 8.0.1 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/splash-screen | 8.0.2 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/status-bar | 8.0.4 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capgo/native-purchases | 8.9.6 | MPL-2.0 | https://github.com/Cap-go/capacitor-native-purchases |

MIT notice (Capacitor): Copyright (c) 2017-present Drifty Co. Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

MPL-2.0 (@capgo/native-purchases): used unmodified as a dependency. MPL-2.0 is file-level copyleft: if files of that
package are modified, those files must stay under MPL-2.0 and their source must be made available. The full license text
ships in `node_modules/@capgo/native-purchases/LICENSE` and at https://mozilla.org/MPL/2.0/.

## Services (not bundled code)
Supabase (database/auth), Cloudflare Workers (realtime server), GitHub Pages (hosting), Stripe Checkout (web only, hidden in
the iOS app), Apple StoreKit (iOS), Open-Meteo (weather API, https://open-meteo.com).

Art and audio origin: see `ASSET_PROVENANCE.md`.

## Open-Meteo weather data (CC BY 4.0)
The optional "Real weather & time" setting reads current conditions from the Open-Meteo API (https://open-meteo.com/).
Open-Meteo data is licensed under Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).
Attribution shown in the game since build 13u: "Weather data by Open-Meteo.com" with a link, in Settings › More › Credits,
next to the weather line on the home screen, and under the Real weather setting. Only a coarse location (about 10 km) is sent; nothing is stored by the game.

## flag-icons (MIT)
Country flag pictures in `ui/flags/*.webp` (197 files, build 13u botprof) are rasterised from flag-icons 7.2.3 (https://github.com/lipis/flag-icons), 4x3 SVGs.
The flag skins' textures in `ui/ssfl/*.webp` (197 files, 256x192, build 13u phase 2 "flags": flag wrapped on the snake body and card icons) are rasterised from the same flag-icons 7.2.3 4x3 SVGs, MIT License, Copyright (c) 2013 Panayiotis Lipiridis; licence text in `ui/ssfl/LICENSE-flag-icons.txt`.
MIT License. Copyright (c) 2013 Panayiotis Lipiridis. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## Acknowledgement (idea only, no code used)
The in-game snake body smoothing ("coiling test": each drawn segment is dragged by the one in front of it at a fixed spacing) is our own
implementation of an idea described by Andrey Ugolnik (Worms Zone) at https://www.ugolnik.info/worms-zone and in his prototype
https://github.com/reybits/wormaria (GPL-3.0). No source code from that project is included in Super Snake.
