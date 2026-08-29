# RetroImgHandler Manual

RetroImgHandler loads and writes native retro-computer image data while keeping
hardware constraints visible to the consuming web application.

- [Getting started](getting-started.md)
- [API reference](api-reference.md)
- [Constraints and conversion](constraints-and-conversion.md)
- [Custom format plugins](custom-formats.md)
- [Amiga indexed ILBM and Raw planar export](platforms/amiga.md) — target
  selection, artist workflow, transparency, compression, and byte layouts
- [Commodore 64 containers and Raw memory](platforms/c64.md) — bitmap and
  character workflows plus exact Hires/Multicolor component maps
- [ZX Spectrum formats](platforms/spectrum.md)
- [Atari ST/STE formats](platforms/atari-st.md)
- [Atari 8-bit formats](platforms/atari-8bit.md)
- [Netpbm and PFM formats](netpbm.md)

The package is intended for current browser bundlers and Web Workers. Node.js
is used for development but is not an official image-runtime target.
