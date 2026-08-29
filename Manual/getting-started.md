# Getting Started

Install `retro-img-handler`, import the root registry, then import only the
platform codecs required by the application.

```ts
import { createRegistry } from "retro-img-handler";
import { spectrumPlugins } from "retro-img-handler/spectrum";
import { c64Plugins } from "retro-img-handler/c64";
import { netpbmPlugins } from "retro-img-handler/netpbm";

const registry = createRegistry([...spectrumPlugins, ...c64Plugins, ...netpbmPlugins]);
const candidates = await registry.detect(file, { filename: file.name });
const image = await registry.decode(file, { filename: file.name });
```

`detect` ranks content matches. A filename extension only increases confidence.
If two headerless layouts are equally plausible, provide `formatId`, `modeId`,
and the hints documented on the platform page.

Decoded documents keep native components and an RGBA preview. To render an
aspect-correct download, import `exportPng` from `retro-img-handler/png` and use
`aspectMode: "square"`. Native encoding never changes pixel aspect.

The repository demo accepts a file, displays detection and capability JSON,
draws the preview, and offers native and PNG downloads. When decode returns
warnings, the demo shows each readable message in a Warnings panel; expand a
message to inspect its stable warning code and JSON details. The panel is hidden
when there are no warnings. Run the demo with `npm run dev` and open
`http://127.0.0.1:4175`.

Netpbm PBM/PGM/PPM/PAM and related PFM files decode to direct sampled raster
documents rather than indexed palettes. See [Netpbm and PFM](netpbm.md) for
sample precision, preview color handling, alpha, and single-image limitations.
