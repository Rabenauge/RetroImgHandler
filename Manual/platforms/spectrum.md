# ZX Spectrum 48K/128K

`spectrumScrPlugin` reads and writes the 6912-byte SCR display memory layout:
6144 bitmap bytes in the native nonlinear row order followed by 768 attributes.
The decoder applies INK, PAPER, and the shared BRIGHT bit per 8×8 cell. FLASH is
preserved in the attribute component and counted in metadata; the preview does
not animate it.

Strict analysis reports any 8×8 cell that needs more than two colors or mixes
incompatible brightness values. `spectrumPalette` contains the canonical
normal/bright RGB projection: sixteen native indexes represent fifteen
distinct display RGB colors because normal and bright black are identical.
Registry metadata therefore declares a fixed indexed palette with a
15-display-color limit, 16 stored entries, and the shared `bright` cell
attribute. Conversion maps to this fixed palette before selecting INK/PAPER;
it does not create an arbitrary median-cut palette. `spectrumPlugins` contains
the SCR codec.
Timex, ULAplus, and Spectrum Next modes are outside version 1.
