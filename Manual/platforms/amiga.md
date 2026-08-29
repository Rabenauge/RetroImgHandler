# Amiga OCS/ECS/AGA

RetroImgHandler exposes two native Amiga containers through `amigaPlugins`:
`amigaIlbmPlugin` reads and writes self-describing IFF `FORM ILBM` files, while
`amigaRawPlanarPlugin` reads and writes headerless planar bytes accompanied by
explicit hints. Use ILBM when the receiving application understands IFF. Use
Raw when an engine, demo, or hardware loader expects planes at a known address
and already has separate metadata and palette data.

## Prepare indexed artwork

Before export, decide which actual Amiga display is the target. This determines
the available colors and their component grid; choosing only “Amiga” is not
enough.

| Mode ID | Chipset and resolution | Display colors | Stored palette | Component grid |
| --- | --- | ---: | ---: | --- |
| `ocs-indexed` | OCS/ECS Lowres | 32 | 32 | RGB444, components 0, 17, …, 255 |
| `ocs-hires-indexed` | OCS/ECS Hires | 16 | 16 | RGB444 |
| `ocs-ehb` | OCS/ECS Lowres Extra Half-Brite | 64 | 32 bases | RGB444 bases; entries 32–63 are exact half intensity |
| `ecs-superhires-indexed` | ECS SuperHires | 4 | 4 | RGB222, components 0, 85, 170, 255 |
| `aga-indexed` | AGA Lowres | 256 | 256 | RGB888 |
| `aga-hires-indexed` | AGA Hires | 256 | 256 | RGB888 |
| `aga-superhires-indexed` | AGA SuperHires | 256 | 256 | RGB888 |

The legacy IDs `ocs-indexed`, `ocs-ehb`, and `aga-indexed` mean the Lowres
variants. HAM6 and HAM8 remain available for existing workflows, but the steps
below concentrate on independently indexed artwork.

The nominal page widths are 320 for Lowres, 640 for Hires, and 1280 for
SuperHires. PAL pages are 256 lines non-laced or 512 lines Laced; NTSC pages are
200 or 400 lines. Bitmap dimensions may be smaller than the nominal page. OCS
and ECS outputs accept 1–4096 pixels on each axis; AGA accepts 1–16384, subject
to parser resource limits.

Transparency is binary. A Strict source must contain only alpha 0 or 255. Auto
conversion thresholds alpha below 128 to transparent and alpha 128 or above to
opaque. A final one-bit mask plane is written only when at least one pixel is
transparent, so fully opaque art does not pay for an unused mask.

## Choose chipset, resolution, and timing

Build a target with the native container and mode, then set `displayProfile`.
Choose `hardware` (`ocs`, `ecs`, or `aga`), `videoStandard` (`pal` or `ntsc`),
and `interlaced`. The hardware must agree with the selected mode for authored
native data. `interlaced: true` selects Laced timing; it does not resample the
image or double its bitmap height.

```ts
const target = {
  formatId: "amiga.ilbm",
  modeId: "ocs-hires-indexed",
  displayProfile: {
    hardware: "ocs",
    videoStandard: "pal",
    interlaced: false
  }
};
```

Use PAL or NTSC according to the destination machine or project, not according
to the computer doing the export. Use Laced only when the consuming display
setup expects it. The selection controls the positive BMHD aspect/page bytes
and the CAMG resolution/LACE flags. It does not crop or stretch authored pixels.

## Strict versus Auto conversion

Use `registry.analyze(image, target)` first when the source is intended to be
hardware-ready. Strict analysis catches too many stored/display colors, palette
components outside the selected RGB grid, indices that cannot be represented,
incompatible plane metadata, dimensions outside the mode range, malformed EHB
derived entries, and non-binary alpha. Fixing these findings preserves exact
artist choices.

Use `registry.convert(image, target, { dither: "none" })` when deliberate
automatic adaptation is wanted. Auto prepares the size, quantizes palette
components to the selected hardware grid, chooses a deterministic palette, and
maps pixels without adding dithering. For EHB it scores a base color together
with its half-bright derivative, stores up to 32 bases, and can map pixels to
either half. The absence of synthetic dithering is intentional: existing pixel
clusters and artist-authored patterns stay intact.

```ts
const registry = createRegistry(amigaPlugins);
const analysis = registry.analyze(source, target);
if (!analysis.valid) {
  const converted = await registry.convert(source, target, { dither: "none" });
  // Review converted.document.preview before encoding.
}
```

For example, an OCS Hires title screen may use at most 16 RGB444 colors. A
source component value of 25 is off-grid: Auto maps it to the nearest expanded
4-bit value, while Strict reports it. An ECS SuperHires status panel has only
four RGB222 entries, so a richly shaded source needs an artist-designed palette
or a carefully reviewed Auto result. For an EHB painting, include the bright
base if its dark counterpart should be produced as the derived half; supplying
64 native entries requires entries 32–63 to be exact halves of entries 0–31.

## Export an ILBM file

1. Register `amigaIlbmPlugin` or `amigaPlugins` and select an indexed target.
2. Set chipset, PAL/NTSC, and Laced timing as described above.
3. Analyze native indexed art, or Auto-convert RGBA with `dither: "none"`.
4. Review the converted preview, especially EHB assignments and binary edges.
5. Encode with `compression: "none"` for predictable direct BODY bytes, or
   `compression: "byterun1"` for row-scoped compression.
6. Save `EncodeResult.data` as `.iff`, `.ilbm`, or `.lbm` according to the host
   application’s convention.

```ts
const encoded = await registry.encode(document, {
  compression: "byterun1"
});
```

Unknown IFF chunks are preserved by default. Pass `preserveUnknown: false` only
when dropping them is intended. CRNG/CCRT/DRNG cycling chunks and
PCHG/CTBL/SHAM raster palettes are preserved but not animated or rendered;
warnings make that limitation visible. When decoding ambiguous compatible
files, pass an explicit display profile when the exact chipset/timing matters.

## Implement an independent ILBM reader

Every multibyte integer is big-endian. The file starts with `FORM`, a 32-bit
FORM payload size, and the type `ILBM`. It then contains IFF chunks: a four-byte
ID, 32-bit data size, data, and a pad byte when the data size is odd. The pad is
not included in the chunk size.

The chunks used for a raster are:

- `BMHD`: required 20-byte bitmap header describing geometry and storage.
- `CMAP`: RGB888 triplets in register order. OCS/ECS values still occupy full
  bytes on disk; their hardware precision is represented by the value grid.
  EHB stores only its 32 base triplets.
- `CAMG`: one 32-bit Amiga display-mode value. RetroImgHandler uses HIRES
  `0x8000`, SUPERHIRES `0x0020`, LACE `0x0004`, HAM `0x0800`, and HALFBRITE
  `0x0080` as applicable.
- `BODY`: uncompressed or ByteRun1 planar rows, including an optional mask.

BMHD fields and byte offsets are:

| Offset | Size | Field | Meaning emitted/consumed here |
| ---: | ---: | --- | --- |
| 0 | 2 | `w` | bitmap width |
| 2 | 2 | `h` | bitmap height |
| 4 | 2 | `x` | signed origin x; encoder writes 0 |
| 6 | 2 | `y` | signed origin y; encoder writes 0 |
| 8 | 1 | `nPlanes` | color planes, excluding a mask |
| 9 | 1 | `masking` | 0 none, 1 final mask plane |
| 10 | 1 | `compression` | 0 none, 1 ByteRun1 |
| 11 | 1 | pad | encoder writes 0 |
| 12 | 2 | `transparentColor` | transparent index metadata, separate from mask storage |
| 14 | 1 | `xAspect` | positive display-aspect numerator |
| 15 | 1 | `yAspect` | positive display-aspect denominator |
| 16 | 2 | `pageWidth` | signed nominal page width, emitted positive |
| 18 | 2 | `pageHeight` | signed nominal page height, emitted positive |

For each plane row, `rowBytes = ((width + 15) >> 4) * 2`; unused bits and bytes
pad the row to a 16-bit word. Plane 0 supplies the least-significant bit of the
palette index, plane 1 the next bit, and so on. Within a byte, the leftmost pixel
uses bit 7. Uncompressed BODY order is row 0 plane 0, row 0 plane 1, …, optional
row 0 mask, then the same plane sequence for row 1. A mask bit of 1 is opaque
and 0 is transparent.

ByteRun1 changes only how each individual plane row is stored. Read a signed
control byte: 0…127 copies the next `n + 1` bytes, -1…-127 repeats the next byte
`1 - n` times, and -128 is a no-op. Reset the decompression target at every
plane-row boundary; a command must never produce bytes in the next plane or
row. The next compressed command begins immediately after the current padded
plane row has produced exactly `rowBytes` bytes.

Decoded ILBM documents expose uncompressed planar bytes as `components.body`,
the original CMAP bytes as `components.palette`, and, when present, unpacked
one-byte-per-pixel mask values as `components.mask`. Metadata includes `planes`,
`masking`, `compression`, `camg`, page size, and `planarLayout`.

## Export or read Amiga Raw planar data

Raw files contain only primary planar bytes. They do not carry dimensions,
mode, timing, plane count, layout, palette, or mask presence. Store those facts
beside the file in the consuming project. To decode, provide `width`, `height`,
`modeId`, `displayProfile`, an RGB888 palette or `components.palette`, and
`amigaPlanar` hints.

```ts
const raw = await registry.decode(bytes, {
  formatId: "amiga.raw-planar",
  modeId: "ocs-indexed",
  width: 320,
  height: 256,
  displayProfile: { hardware: "ocs", videoStandard: "pal", interlaced: false },
  components: { palette: paletteRgb888Bytes },
  amigaPlanar: { layout: "row-interleaved", planes: 5, mask: false }
});
```

For export, choose `amigaPlanar.layout` as `row-interleaved` or `plane-major`.
The default is row-interleaved. `EncodeResult.data` is only the primary planar
file. Preserve `document.components.palette` as a separate RGB888 palette
sidecar when the receiver cannot obtain the palette elsewhere.

1. Select the exact indexed mode and display profile, just as for ILBM.
2. Analyze native art or Auto-convert with `dither: "none"`, then review the
   palette and binary transparency.
3. Decide whether the receiver walks plane rows per scanline
   (`row-interleaved`) or consumes complete planes (`plane-major`).
4. Encode the primary bytes and save the RGB888 `components.palette` sidecar.
5. Record width, height, mode ID, color-plane count, mask presence, layout, and
   display profile alongside both files; Raw bytes cannot recover these facts.

Both layouts use the same word-padded `rowBytes`, bit significance, and optional
final mask plane as ILBM. Their offset formulas are:

- Row-interleaved: `((y * storedPlanes + plane) * rowBytes)`, where
  `storedPlanes = colorPlanes + (mask ? 1 : 0)`. The mask is the last plane of
  each row. This primary data is byte-for-byte equal to an uncompressed ILBM
  BODY with the same raster.
- Plane-major: `((plane * height + y) * rowBytes)`. All rows of color plane 0
  come first, then every row of plane 1, and so on. If present, all mask rows
  form the last complete plane in the file.

The primary byte count is
`rowBytes * height * (colorPlanes + maskPlane)`. The RGB888 palette sidecar is
three bytes per stored entry in R, G, B order. EHB sidecars contain only the 32
base entries (96 bytes); readers derive display entries 32–63 by halving each
base component. The decoded component names are `body`, `palette`, and optional
`mask`; decode metadata records `planes`, `masking`, and `planarLayout`.

## Common pitfalls and useful checks

- Do not treat nominal page size as mandatory bitmap dimensions or assume that
  selecting Laced resizes the raster.
- Do not store 64 RGB triplets for EHB Raw or ILBM. Only the 32 bases are native.
- Do not use arbitrary 8-bit colors in OCS/ECS output. RGB444 and RGB222 grids
  are exact requirements, not preview approximations.
- Do not allow ByteRun1 commands to cross a padded plane-row boundary.
- Do not forget 16-bit row padding when width is not divisible by 16. A
  17-pixel row occupies four bytes per plane, not three.
- Do not infer a Raw layout from its bytes. Supply `amigaPlanar.layout`.
- Review mask edges after Auto conversion: alpha 127 becomes transparent and
  alpha 128 becomes opaque.

`amigaRgb12` converts one OCS/ECS 12-bit hardware color word to RGB.
