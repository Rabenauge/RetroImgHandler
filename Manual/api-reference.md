# Public API Reference

## Root values and functions

- `createRegistry(plugins?)` creates an explicit `FormatRegistry`.
- `FormatRegistry` provides `register`, `listFormats`, `getFormatDefinition`,
  `detect`, `decode`, `analyze`, `convert`, and `encode`.
- `RetroImageError` exposes a stable `code` and optional `details`.
- `indexedToRgba` renders palette indices; `nearestColorIndex` maps one color.
- `analyzeDimensions` and `analyzePaletteCapabilities` implement shared size,
  display-color-limit, fixed-palette, and programmable RGB-grid rules.
- `medianCut`, `mapToPalette`, `prepareConversionImage`, and `genericConvert`
  implement deterministic generic conversion. `medianCut` returns every unique
  RGB color unchanged when the source is already within the requested limit.
- `resolveRgbComponentPrecision`, `isRgbOnComponentGrid`, and
  `quantizeRgbToComponentGrid` expose exact programmable-palette checks and
  stable nearest no-dither quantization. Exact midpoint ties select the lower
  representable component value.

## Root types

`AnalysisIssue`, `AnalysisResult`, `BaseImageDocument`, `BinarySource`,
`C64ColorMatchResult`, `C64ColorMatchSample`, `C64ConversionOptions`,
`C64SourceColorCode`,
`CharsetDocument`, `CodecTarget`, `CodecWarning`, `ConversionOptions`,
`ConversionReport`, `ConversionResult`, `DecodeHints`, `DecodeOptions`,
`DetectionResult`, `DimensionRange`, `DisplayProfile`, `DisplayVariantDefinition`,
`DitherMode`, `EncodeOptions`, `EncodeResult`, `EncodingVariantDefinition`,
`AmigaPlanarLayout`, `AmigaPlanarDecodeOptions`, `AmigaPlanarEncodeOptions`,
`FormatDefinition`, `FormatModeDefinition`, `FormatPlugin`,
`FloatSampledRasterDocument`, `IntegerSampledRasterDocument`, `JsonValue`,
`InterlaceSupport`, `ModeDimensions`, `PaletteCapability`, `PaletteModel`,
`PfmByteOrder`, `PfmDecodeOptions`, `PfmEncodeOptions`,
`PfmRowOrder`, `PfmToneMapping`, `PreservedSection`, `ProbeContext`,
`RasterDocument`, `Rational`, `ResourceLimits`, `RetroImageDocument`,
`RetroImageErrorCode`, `ResolutionClass`, `RgbColor`, `RgbComponentPrecision`,
`RgbComponentPrecisionVariant`, `RgbaImage`, `SampleCapability`,
`SampleChannelModel`, `SampledRasterDocument`,
`StructuredPaletteRegisterDefinition`, `StructuredPaletteValueModel`, and
`TilemapDocument` define the
stable schema-version-1 plugin and document contracts.

`ConversionOptions.c64` selects a required 16-color display palette and optional
source RGB-to-native-code associations for C64 conversion. `DecodeOptions.pfm` selects explicit PFM row order and preview exposure/tone
mapping. `EncodeOptions.pfm` overrides PFM row order, byte order, or positive
scale factor. `ConversionOptions.maxSampleValue` selects integer Netpbm output
precision from 1 through 65535.

## PNG subpath

- `exportPng(image, options?)` returns PNG bytes using Canvas or OffscreenCanvas.
- `PngExportOptions` selects `native` or aspect-corrected `square` output.

## Platform subpaths

- Amiga: `amigaIlbmPlugin`, `amigaRawPlanarPlugin`, `amigaPlugins`, `amigaRgb12`.
- C64: `c64KoalaPlugin`, `c64ArtStudioPlugin`, `c64DoodlePlugin`, `c64RawPlugin`,
  `c64Palette`, `c64Plugins`, `matchC64ColorCodes`.
- Spectrum: `spectrumScrPlugin`, `spectrumPalette`, `spectrumPlugins`.
- Atari ST: `atariStDegasPlugin`, `atariStDegasCompressedPlugin`,
  `atariStNeoPlugin`, `atariStRawPlugin`, `atariStPlugins`.
- Atari 8-bit: `atari8Gr8Plugin`, `atari8Gr9Plugin`, `atari8MicPlugin`,
  `atari8PicPlugin`, `atari8RawPlugin`, `atari8Palette`, `atari8Plugins`.

## Netpbm subpath

- `netpbmPbmPlugin`, `netpbmPgmPlugin`, and `netpbmPpmPlugin` provide P1-P6.
- `netpbmPamPlugin` provides the defined visual P7 tuple types.
- `netpbmPfmPlugin` provides finite grayscale and RGB Float32 PFM.
- `netpbmPlugins` contains all five plugins.

## Errors and warnings

Error codes are `AMBIGUOUS_FORMAT`, `DUPLICATE_FORMAT`, `FORMAT_NOT_FOUND`,
`INVALID_FILE`, `INVALID_OPTION`, `LIMIT_EXCEEDED`, `MISSING_HINT`,
`UNSUPPORTED_MODE`, `UNSUPPORTED_RUNTIME`, `UNSUPPORTED_SEQUENCE`, and
`VALIDATION_FAILED`. Format
violations are returned as analysis issues instead of thrown errors.

`PFM_NEGATIVE_PREVIEW_CLIPPED` warns that negative finite samples were retained
but displayed as zero in the SDR preview.
