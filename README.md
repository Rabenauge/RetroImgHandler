# RetroImgHandler

`retro-img-handler` 0.3.1 is a TypeScript library for decoding, validating,
converting, previewing, and encoding native retro-computer graphics in modern
web applications and Web Workers.

Supported families include Amiga OCS/ECS/AGA ILBM and Raw planar images,
Commodore 64 Koala/Art Studio/Doodle and Raw graphics memory, ZX Spectrum
48K/128K SCR, Atari ST/STE DEGAS/NEOchrome/Raw planes, Atari 8-bit ANTIC/GTIA
graphics, Netpbm PBM/PGM/PPM/PAM, and related PFM. Codec families are explicit
imports, so a web application only bundles the formats it uses.

## C64 border metadata

Configured C64 conversion accepts `ConversionOptions.c64.borderColorCode` as an
integer VIC-II code from 0 through 15. When supplied, the decoded result retains
the separate code in `metadata.c64BorderColorCode` and one-byte
`components.border`. It is not bitmap or Multicolor shared-background data.
Omitting the option adds no border component and preserves the classic
Koala, Art Studio, and Doodle byte layouts unchanged.

```ts
import { createRegistry } from "retro-img-handler";
import { amigaPlugins } from "retro-img-handler/amiga";

const registry = createRegistry(amigaPlugins);
const document = await registry.decode(file, { filename: file.name });
const encoded = await registry.encode(document, { compression: "byterun1" });
```

See [Manual/index.md](Manual/index.md) for setup, API contracts, custom plugins,
conversion rules, and browser-demo instructions. Detailed native-format guides
cover [Amiga indexed ILBM and Raw planar export](Manual/platforms/amiga.md),
[C64 containers and Raw memory](Manual/platforms/c64.md),
[Spectrum SCR](Manual/platforms/spectrum.md),
[Atari ST/STE](Manual/platforms/atari-st.md),
[Atari 8-bit](Manual/platforms/atari-8bit.md), and
[Netpbm/PFM](Manual/netpbm.md).

## Local development

```sh
npm install
npm run dev
npm run check
```

The demo is served by Vite at `http://127.0.0.1:4175`. The package is ESM-only,
targets ES2022, and has no runtime dependencies.

## Acknowledgments

This project was built in collaboration with OpenAI Codex.
