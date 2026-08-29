# Constraints and Conversion

Every `FormatDefinition` is JSON-serializable. Its modes describe fixed native
sizes or a `DimensionRange`,
pixel aspect, color model, bits per pixel, cell limits, hardware profiles,
video standards, and transparency. Additive schema-version-1 capability data
describes the palette model, simultaneous display-color limit, storable color
entries, profile-specific RGB precision, resolution class, interlace support,
resolved display variants, direct-sample rules, and named encoding variants.

`registry.analyze(image, target)` never changes an image. It reports stable
issues such as `DIMENSIONS_MISMATCH`, `TOO_MANY_COLORS`,
`COLOR_OUTSIDE_COMPONENT_GRID`, `COLOR_OUTSIDE_FIXED_PALETTE`,
`C64_CELL_COLORS`, and `SPECTRUM_CELL_COLORS`. `registry.encode` is strict and throws
`VALIDATION_FAILED` when errors remain.

Shared global palette analysis applies to fixed, programmable, derived, and
monochrome targets. A `structured-registers` target requires its codec to
interpret native register semantics. C64 therefore preserves its established
behavior: source RGB values are nearest-mapped to the fixed VIC-II codes and
the hires/multicolor cell rules are authoritative; no new global source-RGB
count or fixed-palette blocker is added. Atari 8-bit analysis resolves exact
PAL/NTSC GTIA codes before applying its declared register/display limits.

`registry.convert(image, target, options)` requires explicit choices. Supported
resize values are `none`, `nearest`, `crop`, and `pad`. Supported dither values
are `none`, `bayer2`, `bayer4`, and `floyd-steinberg`. Generic conversion uses
deterministic median-cut quantization; a source already at or below the limit
retains every unique RGB color. Programmable targets quantize each RGB
component to its profile-specific hardware grid with no dithering and stable
lower-value midpoint ties. Fixed palettes map directly to their declared
colors. Format encoders then apply their hardware cell or register layouts.

Built-in target conversion additionally optimizes Spectrum attributes, C64
cell palettes, Amiga HAM component commands, Atari ST interleaved planes, and
Atari 8-bit native register codes. Normal ANTIC modes and GTIA 10 select only
their declared color-register counts. GTIA 9 selects one hue and derives
sixteen luminances; GTIA 11 selects one luminance and derives sixteen hues.
PAL and NTSC use separate deterministic 256-code projections. Stored-container
converters decode emitted bytes again so their previews represent the bytes
that will actually be written.

`ConversionReport` records every resize, palette, and dither operation.
`DisplayProfile` keeps hardware and `pal`/`ntsc` interpretation separate. If a
file does not identify a display profile, decode returns an
`ASSUMED_DISPLAY_PROFILE` warning. Raster/color-cycling features that are kept
but not rendered produce `UNRENDERED_RASTER_EFFECT` or
`UNPLAYED_COLOR_CYCLING`.

For DEGAS PI1-PI3 and PC1-PC3, the binary header is authoritative. A known
filename extension that disagrees with the header does not block automatic
decode; it adds a `FILENAME_EXTENSION_MISMATCH` warning with the expected and
actual mode and compression family. An explicitly selected PI or PC codec is
strict and rejects the opposite binary family with `INVALID_FILE`.

`EncodeOptions.preserveUnknown` is codec-specific. Amiga ILBM preserves unknown
chunks unless the option is `false`. Atari DEGAS PC preserves unknown
`degas.trailing` trailer sections only when the option is explicitly `true`;
otherwise encode omits them and returns `UNKNOWN_DATA_OMITTED`. This opt-in
prevents application-specific or unexplained bytes from being copied into a
new PC file accidentally. Known DEGAS Elite color-cycling footer bytes are not
unknown and are always preserved.

Default safety limits are 16 MiB input, 16 million pixels, 4096 chunks, and
64 MiB decompressed data. Override individual values through `limits` only for
trusted data.

Netpbm direct-raster conversion does not use palette quantization. PGM, PPM,
and visual PAM accept `ConversionOptions.maxSampleValue` from 1 through 65535,
defaulting to 255; bilevel targets require 1 and PFM rejects the option.
Bilevel targets accept all four dither modes. Other direct targets reject a
non-`none` dither rather than silently ignoring it. Transparent sources require
an explicit opaque `background` for PBM, PGM, PPM, non-alpha PAM, and PFM;
alpha PAM targets retain straight alpha. See [Netpbm and PFM](netpbm.md).
