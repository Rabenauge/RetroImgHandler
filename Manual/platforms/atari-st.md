# Atari ST/STE

## DEGAS PI and PC images

`atariStDegasPlugin` reads and writes the uncompressed DEGAS family.
`atariStDegasCompressedPlugin` reads and writes the PackBits-compressed DEGAS
family.

| Extension | Mode | Dimensions | Colors | Storage |
| --- | --- | --- | --- | --- |
| `.pi1` | `st-low` | 320×200 | 16 | Uncompressed |
| `.pi2` | `st-medium` | 640×200 | 4 | Uncompressed |
| `.pi3` | `st-high` | 640×400 | 2 | Uncompressed |
| `.pc1` | `st-low` | 320×200 | 16 | PackBits |
| `.pc2` | `st-medium` | 640×200 | 4 | PackBits |
| `.pc3` | `st-high` | 640×400 | 2 | PackBits |

Every file has a 34-byte header containing its resolution and sixteen Atari
palette words. A PI screen is exactly 32,000 bytes. A PC screen decompresses
to exactly 32,000 bytes. PI stores normal interleaved Atari ST screen memory.
PC stores each scanline plane-by-plane: all bytes for the lowest bitplane come
before the next bitplane. The decoder converts PC data to normal interleaved
screen memory in `document.components.screen`. The PC encoder performs the
inverse conversion and compresses independent 40-byte blocks for compatibility
with DEGAS Elite's fixed decompression buffer.

ST Low displays 16 programmable colors and ST Medium displays 4, while both
formats still store all 16 palette words. Select `displayProfile.hardware:
"st"` for the RGB333 grid or `"ste"` for RGB444. Strict analysis reports a
source color between grid points as `COLOR_OUTSIDE_COMPONENT_GRID`; conversion
chooses the nearest representable component without dithering and chooses the
lower grid value at an exact tie. ST High is different: it is fixed monochrome
white/black, supports an inverse pixel interpretation, and ignores the sixteen
stored palette words for display. They remain present in every DEGAS header for
file-layout compatibility.

The registry advertises `uncompressed` and `packbits` encoding variants for PI
and PC respectively. Each mode also exposes its supported resolved display
variants, nominal page size, pixel aspect, resolution class, and lack of
interlace; ST High exposes PAL only.

The optional 32-byte DEGAS Elite color-cycling footer is exposed as
`document.components.colorAnimation`, preserved byte-for-byte by encode, and
not animated in the preview. New conversions do not invent a footer. Supplying
`colorAnimation` with a length other than 32 bytes causes encode to throw
`VALIDATION_FAILED`.

Some PC files contain compatibility or application data after the complete
32,000-byte screen. These bytes are not additional pixels. Decode accepts them,
stores unknown bytes as a `document.preserved` section with the ID
`degas.trailing`, and adds this warning:

```json
{
  "code": "UNKNOWN_TRAILING_DATA",
  "message": "Preserved 55 bytes after the DEGAS image.",
  "details": {
    "bytes": 55,
    "eliteFooterSeparated": false
  }
}
```

An exact 32-byte suffix remains a DEGAS Elite color-cycling footer for
compatibility with existing files. For a longer suffix, a structurally valid
32-byte Elite footer at its beginning is placed in `colorAnimation`; only the
remaining bytes are placed in `degas.trailing`, and `eliteFooterSeparated` is
`true`. Otherwise the whole suffix is preserved as unknown data.

Unknown PC trailer bytes are not written by default. Pass
`{ preserveUnknown: true }` to `registry.encode` to append all
`degas.trailing` sections in document order, after any Elite footer. With the
option omitted or `false`, encode omits those bytes and returns an
`UNKNOWN_DATA_OMITTED` warning. Known Elite footer bytes are always written.
Other preserved-section IDs are invalid for DEGAS output and cause
`VALIDATION_FAILED`. PI output cannot carry PC trailer data, so it also omits a
`degas.trailing` section with the same warning.

The header is authoritative when automatic detection uses a filename. If a
known DEGAS extension names the wrong resolution or compression family, the
file still loads according to its header and `document.warnings` contains:

```json
{
  "code": "FILENAME_EXTENSION_MISMATCH",
  "message": "Filename extension .PI2 indicates ST Medium, but the file contains ST Low DEGAS data.",
  "details": {
    "extension": "pi2",
    "expectedModeId": "st-medium",
    "actualModeId": "st-low",
    "expectedCompressed": false,
    "actualCompressed": false
  }
}
```

Unknown or missing extensions do not produce this warning. When `formatId` is
passed explicitly, it is an assertion: selecting `atari-st.degas` for a PC
file, or `atari-st.degas-compressed` for a PI file, throws `INVALID_FILE`.

`ASSUMED_DISPLAY_PROFILE` does not mean that the image data is corrupt. DEGAS
does not identify ST versus STE palette precision or PAL versus NTSC, so decode
infers ST/STE from the palette words and assumes PAL unless the caller supplies
`displayProfile`.

Decode also throws `INVALID_FILE` for a truncated header or screen, an invalid
resolution, and incomplete or overflowing PackBits runs. It throws
`LIMIT_EXCEEDED` when the configured decompression limit is below the required
32,000-byte screen.

## Other Atari ST formats

`atariStNeoPlugin` handles 32,128-byte NEOchrome low-resolution images and
keeps its color-animation header bytes. Animation is not played.

`atariStRawPlugin` handles a 32,000-byte planar screen and requires `modeId`.
Color modes additionally require `palette`; fixed-monochrome `st-high` does not.
Its modes are `st-low`, `st-medium`, and `st-high` as listed
above. `displayProfile.hardware` selects `st` 3-bit or `ste` 4-bit palette
precision. `atariStPlugins` contains both DEGAS codecs, NEOchrome, and raw
planar codecs.

TT, Falcon, and arbitrary raster animation formats are outside version 1.
