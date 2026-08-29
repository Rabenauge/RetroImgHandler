# Atari 8-bit ANTIC/GTIA

`atari8RawPlugin` exposes normal-width full-screen ANTIC modes 2 through F and
GTIA 9, 10, and 11. Bitmap data is packed in native row order. For text modes,
the primary bytes are the charset and optional full-screen memory is supplied
as `components.screen`; palette-register bytes use `components.palette`.
Automatic conversion of arbitrary RGBA images into text/charset modes is not
provided because it would have to invent and deduplicate glyph assets; those
modes accept native screen and charset components and remain fully analyzable.

Dedicated file codecs are `atari8Gr8Plugin` for 320×192 monochrome GR8,
`atari8Gr9Plugin` for 80×192 GTIA luminance data, `atari8MicPlugin` for
160×192 four-color MIC/Graphics 15, and `atari8PicPlugin` for wrapped Micro
Illustrator PIC data including raw, sequential RLE, and column RLE variants.

`atari8Palette("pal" | "ntsc")` creates a deterministic 256-entry preview
projection while native GTIA color bytes remain unchanged. `atari8Plugins`
contains all dedicated and raw codecs. Arbitrary Display Lists, DLI palettes,
interlace demo modes, and Player/Missile graphics are not supported.

Registry modes expose `structured-registers` palette capabilities rather than
an arbitrary programmable RGB palette. Normal ANTIC bitmap/text modes store
their declared two, four, or five GTIA color registers. GTIA 10 stores nine
programmable color-code registers. GTIA 9 stores one hue register and derives
sixteen luminances; GTIA 11 stores one luminance register and derives sixteen
hues. Strict analysis requires exact colors from the selected PAL or NTSC code
projection and reports invalid shared-hue/shared-luminance structures.
Conversion evaluates native register-code candidates directly, selects lower
codes on equal outcomes, and maps without dithering; it does not build an
intermediate arbitrary median-cut palette.

When raw decode receives no `components.palette`, its deterministic defaults
use `palette.storableColorEntries`: one register for GTIA 9/11, nine for GTIA
10, two for ANTIC 2/3, and the declared two/four/five counts for the remaining
normal bitmap/text modes. Supplying `components.palette` still overrides those
defaults and is truncated to the same declared native capacity.

New `atari8.gr9` conversions emit the supported 7684-byte artifact: 7680 bitmap
bytes followed by the selected hue register and three reserved zero bytes. The
decoded conversion result keeps those exact bytes in `components.stored` and
the one native hue value in `components.palette`.
