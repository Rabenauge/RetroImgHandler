/** JSON-compatible values used by public metadata and format definitions. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A positive rational value such as a hardware pixel aspect ratio. */
export interface Rational {
  numerator: number;
  denominator: number;
}

/** An eight-bit RGB color. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** Raw RGBA pixels in row-major order. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Hardware and display interpretation used for constraints and previews. */
export interface DisplayProfile {
  hardware: string;
  videoStandard?: "pal" | "ntsc";
  interlaced?: boolean;
  paletteId?: string;
}

/** Fixed dimensions for a native mode. */
export interface ModeDimensions {
  width: number;
  height: number;
}

/** Allowed dimensions for variable-size container and raw formats. */
export interface DimensionRange {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  widthAlignment?: number;
  heightAlignment?: number;
}

/** How a target obtains the colors that may be displayed. */
export type PaletteModel =
  | "fixed-indexed"
  | "programmable-indexed"
  | "derived-indexed"
  | "structured-registers"
  | "monochrome"
  | "sampled-direct";

/** Exact per-component precision of one programmable RGB grid. */
export interface RgbComponentPrecision {
  redBits: number;
  greenBits: number;
  blueBits: number;
}

/** A hardware-profile-specific programmable RGB grid. */
export interface RgbComponentPrecisionVariant extends RgbComponentPrecision {
  hardwareProfiles: string[];
}

/** Native semantics of one structured palette register group. */
export type StructuredPaletteValueModel =
  | "fixed-color-code"
  | "gtia-color-code"
  | "gtia-hue"
  | "gtia-luminance";

/** A stable native register group used to derive displayed colors. */
export interface StructuredPaletteRegisterDefinition {
  id: string;
  count: number;
  valueModel: StructuredPaletteValueModel;
  derivedDisplayColors?: number;
}

/** JSON-safe palette and sample capabilities for one target mode. */
export interface PaletteCapability {
  model: PaletteModel;
  displayColorLimit: number;
  storableColorEntries: number;
  componentPrecision?: RgbComponentPrecisionVariant[];
  fixedColors?: RgbColor[];
  supportsInverse?: boolean;
  registers?: StructuredPaletteRegisterDefinition[];
}

/** Broad display timing/resolution family for target selection UIs. */
export type ResolutionClass = "low" | "medium" | "high" | "super-high" | "variable" | "sampled";

/** Whether a mode can use interlaced display timing. */
export type InterlaceSupport = "none" | "optional" | "required";

/** One resolved display interpretation exposed by the registry. */
export interface DisplayVariantDefinition {
  id: string;
  label: string;
  hardwareProfiles: string[];
  videoStandard?: "pal" | "ntsc";
  nominalPageSize: ModeDimensions;
  pixelAspect: Rational;
  interlaced: boolean;
}

/** Direct-sample storage rules for Netpbm/PFM-style target modes. */
export interface SampleCapability {
  sampleType: "uint" | "float32";
  channelModel: SampleChannelModel;
  alpha: "none" | "straight";
  maxSampleValue?: { minimum: number; maximum: number; fixed?: number };
  byteOrders?: PfmByteOrder[];
  rowOrders?: PfmRowOrder[];
  preservesScaleFactor?: boolean;
}

/** JSON-safe limitations for a target mode. */
export interface FormatModeDefinition {
  id: string;
  label: string;
  dimensions: ModeDimensions[];
  dimensionRange?: DimensionRange;
  pixelAspect: Rational;
  colorModel: "indexed" | "ham" | "direct" | "character";
  bitsPerPixel: number;
  maxColors: number;
  paletteBitsPerChannel?: number;
  palette?: PaletteCapability;
  resolutionClass?: ResolutionClass;
  interlaceSupport?: InterlaceSupport;
  displayVariants?: DisplayVariantDefinition[];
  sample?: SampleCapability;
  cell?: {
    width: number;
    height: number;
    maxColors: number;
    sharedColors?: number;
    sharedAttribute?: string;
  };
  hardwareProfiles: string[];
  videoStandards: Array<"pal" | "ntsc">;
  supportsTransparency: boolean;
  notes?: string[];
}

/** One named encoder configuration offered for a codec. */
export interface EncodingVariantDefinition {
  id: string;
  label: string;
  encodeOptions: EncodeOptions;
}

/** Serializable description returned to web application user interfaces. */
export interface FormatDefinition {
  schemaVersion: 1;
  id: string;
  label: string;
  platform: string;
  extensions: string[];
  mimeTypes: string[];
  canDecode: boolean;
  canEncode: boolean;
  raw: boolean;
  modes: FormatModeDefinition[];
  encodingVariants?: EncodingVariantDefinition[];
}

/** A warning that does not make a decoded document unusable. */
export interface CodecWarning {
  code: string;
  message: string;
  details?: JsonValue;
}

/** Common fields shared by all decoded native asset kinds. */
export interface BaseImageDocument {
  kind: "raster" | "sampled-raster" | "charset" | "tilemap";
  formatId: string;
  modeId: string;
  width: number;
  height: number;
  pixelAspect: Rational;
  displayProfile: DisplayProfile;
  palette: RgbColor[];
  preview: RgbaImage;
  components: Record<string, Uint8Array>;
  metadata: Record<string, JsonValue>;
  warnings: CodecWarning[];
  preserved: PreservedSection[];
}

/** Preserved file section that a codec can write back unchanged. */
export interface PreservedSection {
  id: string;
  data: Uint8Array;
}

/** A native raster with palette or hardware command indices. */
export interface RasterDocument extends BaseImageDocument {
  kind: "raster";
  indices: Uint8Array;
}

/** Meaning and ordering of channels in a direct sampled raster. */
export type SampleChannelModel =
  | "black-and-white"
  | "black-and-white-alpha"
  | "grayscale"
  | "grayscale-alpha"
  | "rgb"
  | "rgb-alpha";

/** Direct unsigned-integer samples stored without palette quantization. */
export interface IntegerSampledRasterDocument extends BaseImageDocument {
  kind: "sampled-raster";
  sampleType: "uint";
  channelModel: SampleChannelModel;
  channelCount: 1 | 2 | 3 | 4;
  samples: Uint16Array;
  maxSampleValue: number;
}

/** Direct IEEE-754 samples stored without integer normalization. */
export interface FloatSampledRasterDocument extends BaseImageDocument {
  kind: "sampled-raster";
  sampleType: "float32";
  channelModel: "grayscale" | "rgb";
  channelCount: 1 | 3;
  samples: Float32Array;
  scaleFactor: number;
  byteOrder: "big-endian" | "little-endian";
  rowOrder: "top-down" | "bottom-up";
}

/** Direct integer or floating-point raster data plus an RGBA preview. */
export type SampledRasterDocument = IntegerSampledRasterDocument | FloatSampledRasterDocument;

/** A character set, optionally accompanied by screen and color maps. */
export interface CharsetDocument extends BaseImageDocument {
  kind: "charset";
  glyphWidth: number;
  glyphHeight: number;
  glyphCount: number;
  bitmap: Uint8Array;
  screen?: Uint8Array;
  colorRam?: Uint8Array;
}

/** A tile map with a referenced tile set. */
export interface TilemapDocument extends BaseImageDocument {
  kind: "tilemap";
  tileWidth: number;
  tileHeight: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Uint8Array;
  map: Uint16Array;
}

/** Any native document handled by the library. */
export type RetroImageDocument = RasterDocument | SampledRasterDocument | CharsetDocument | TilemapDocument;

/** A supported binary source in a browser or Worker. */
export type BinarySource = Uint8Array | ArrayBuffer | Blob;

/** Defensive limits applied before decoding untrusted input. */
export interface ResourceLimits {
  maxInputBytes: number;
  maxPixels: number;
  maxChunks: number;
  maxDecompressedBytes: number;
}

/** Additional information required by headerless formats. */
export interface DecodeHints {
  formatId?: string;
  modeId?: string;
  filename?: string;
  width?: number;
  height?: number;
  displayProfile?: DisplayProfile;
  palette?: RgbColor[];
  components?: Record<string, Uint8Array>;
  amigaPlanar?: AmigaPlanarDecodeOptions;
}

/** Byte ordering of complete Amiga bitplanes in a headerless planar file. */
export type AmigaPlanarLayout = "row-interleaved" | "plane-major";

/** Typed layout hints required to reconstruct headerless Amiga planar data. */
export interface AmigaPlanarDecodeOptions {
  layout?: AmigaPlanarLayout;
  planes?: number;
  mask?: boolean;
}

/** Typed layout selection for headerless Amiga planar encoding. */
export interface AmigaPlanarEncodeOptions {
  layout?: AmigaPlanarLayout;
}

/** Supported PFM raster row interpretations. */
export type PfmRowOrder = "top-down" | "bottom-up";

/** Supported PFM sample byte orders. */
export type PfmByteOrder = "big-endian" | "little-endian";

/** Supported deterministic mappings from linear PFM samples to SDR preview. */
export type PfmToneMapping = "reinhard" | "clip";

/** PFM-specific decode and preview interpretation. */
export interface PfmDecodeOptions {
  rowOrder?: PfmRowOrder;
  exposure?: number;
  toneMapping?: PfmToneMapping;
}

/** PFM-specific output overrides. */
export interface PfmEncodeOptions {
  rowOrder?: PfmRowOrder;
  byteOrder?: PfmByteOrder;
  scaleFactor?: number;
}

/** Options used during detection and decode. */
export interface DecodeOptions extends DecodeHints {
  limits?: Partial<ResourceLimits>;
  pfm?: PfmDecodeOptions;
}

/** A scored content detection result. */
export interface DetectionResult {
  formatId: string;
  confidence: number;
  reason: string;
}

/** A concrete format mode and hardware target. */
export interface CodecTarget {
  formatId: string;
  modeId: string;
  displayProfile: DisplayProfile;
}

/** A stable validation issue suitable for a web UI. */
export interface AnalysisIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  rule: string;
  details?: JsonValue;
}

/** Result of checking an image against one target. */
export interface AnalysisResult {
  valid: boolean;
  target: CodecTarget;
  issues: AnalysisIssue[];
}

/** Supported explicit size conversion modes. */
export type ResizeMode = "none" | "nearest" | "crop" | "pad";

/** Supported deterministic dithering modes. */
export type DitherMode = "none" | "bayer2" | "bayer4" | "floyd-steinberg";

/** One source color considered for a native C64 color-code match. */
export interface C64ColorMatchSample {
  color: RgbColor;
  weight?: number;
  pinnedColorCode?: number;
}

/** One native C64 color-code match and its weighted aggregate error. */
export interface C64ColorMatchResult {
  matches: Array<{ colorCode: number; distance: number; pinned: boolean }>;
  weightedMeanDistance: number;
}

/** Optional direct source-RGB to native C64 color-code association. */
export interface C64SourceColorCode {
  sourceColor: RgbColor;
  colorCode: number;
  pinned?: boolean;
}

/** C64 conversion display interpretation and optional native-code associations. */
export interface C64ConversionOptions {
  displayPalette: RgbColor[];
  sourceColorCodes?: C64SourceColorCode[];
  borderColorCode?: number;
}

/** Explicit conversion options; omitted operations are not performed. */
export interface ConversionOptions {
  resize?: ResizeMode;
  dither?: DitherMode;
  background?: RgbColor;
  maxSampleValue?: number;
  c64?: C64ConversionOptions;
}

/** One mutation made by conversion. */
export interface ConversionStep {
  operation: string;
  message: string;
  details?: JsonValue;
}

/** Auditable report returned with a converted document. */
export interface ConversionReport {
  target: CodecTarget;
  steps: ConversionStep[];
  warnings: CodecWarning[];
}

/** Converted document and its report. */
export interface ConversionResult {
  document: RetroImageDocument;
  report: ConversionReport;
}

/** Native encoder configuration. */
export interface EncodeOptions {
  target?: CodecTarget;
  compression?: "none" | "byterun1" | "packbits";
  preserveUnknown?: boolean;
  pfm?: PfmEncodeOptions;
  amigaPlanar?: AmigaPlanarEncodeOptions;
}

/** Binary output with diagnostics. */
export interface EncodeResult {
  data: Uint8Array;
  formatId: string;
  warnings: CodecWarning[];
}

/** Context supplied to format probes. */
export interface ProbeContext {
  filename?: string;
}

/** Extension point implemented by built-in and custom codecs. */
export interface FormatPlugin {
  definition: FormatDefinition;
  probe(data: Uint8Array, context: ProbeContext): DetectionResult | null;
  decode(data: Uint8Array, options: DecodeOptions): Promise<RetroImageDocument>;
  encode(document: RetroImageDocument, options: EncodeOptions): Promise<EncodeResult>;
  analyze?(image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult;
  convert?(
    image: RgbaImage | RetroImageDocument,
    target: CodecTarget,
    options: ConversionOptions
  ): Promise<ConversionResult>;
}
