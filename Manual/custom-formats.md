# Custom Format Plugins

A custom codec implements `FormatPlugin` and is passed to `createRegistry`.
Its `definition` must use `schemaVersion: 1`, a globally unique stable ID, and
JSON-safe mode definitions. `probe` should use signatures and structure before
extensions and return `null` for headerless data.

```ts
import type { FormatPlugin } from "retro-img-handler";

export const customPlugin: FormatPlugin = {
  definition: {
    schemaVersion: 1,
    id: "example.raw-1bit",
    label: "Example raw bitmap",
    platform: "Example",
    extensions: ["raw"],
    mimeTypes: ["application/octet-stream"],
    canDecode: true,
    canEncode: true,
    raw: true,
    modes: [{
      id: "mono", label: "8x8 mono", dimensions: [{ width: 8, height: 8 }],
      pixelAspect: { numerator: 1, denominator: 1 }, colorModel: "indexed",
      bitsPerPixel: 1, maxColors: 2, hardwareProfiles: ["example"],
      videoStandards: [], supportsTransparency: false,
      palette: {
        model: "monochrome", displayColorLimit: 2, storableColorEntries: 0,
        fixedColors: [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]
      },
      resolutionClass: "variable", interlaceSupport: "none"
    }]
  },
  probe: () => null,
  async decode(data, options) { /* return a documented native document */ },
  async encode(document, options) { /* return Uint8Array data */ }
};
```

Custom codecs must bounds-check before allocation, respect resource limits,
require hints rather than guess ambiguous raw layouts, preserve unknown source
sections where feasible, and provide structured warnings. A duplicate format
ID causes `DUPLICATE_FORMAT`.

Capability fields remain optional so existing schema-version-1 plugins stay
source-compatible. New plugins should describe every rule needed for target
selection or strict validation. Use `componentPrecision` variants for
profile-dependent RGB grids, `registers` for native register semantics,
`sample` for direct rasters, `displayVariants` for resolved timing/aspect
choices, and format-level `encodingVariants` for named encoder configurations.
