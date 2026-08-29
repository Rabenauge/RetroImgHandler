import { DEFAULT_LIMITS, toBytes } from "./binary";
import { analyzeDimensions, genericConvert } from "./conversion";
import { RetroImageError } from "./errors";
import type {
  AnalysisResult,
  BinarySource,
  CodecTarget,
  ConversionOptions,
  ConversionResult,
  DecodeOptions,
  DetectionResult,
  EncodeOptions,
  EncodeResult,
  FormatDefinition,
  FormatPlugin,
  RetroImageDocument,
  RgbaImage
} from "./types";

/** Explicit registry of codecs selected by a web application. */
export class FormatRegistry {
  private readonly plugins = new Map<string, FormatPlugin>();

  constructor(plugins: FormatPlugin[] = []) {
    for (const plugin of plugins) this.register(plugin);
  }

  /** Register one built-in or custom codec. */
  register(plugin: FormatPlugin): this {
    const id = plugin.definition.id;
    if (this.plugins.has(id)) throw new RetroImageError("DUPLICATE_FORMAT", `Format ${id} is already registered`);
    this.plugins.set(id, plugin);
    return this;
  }

  /** Return JSON-safe definitions for every registered format. */
  listFormats(): FormatDefinition[] {
    return [...this.plugins.values()].map(({ definition }) => structuredClone(definition));
  }

  /** Return one JSON-safe format definition. */
  getFormatDefinition(formatId: string): FormatDefinition {
    return structuredClone(this.plugin(formatId).definition);
  }

  /** Rank all codecs that recognize a binary source. */
  async detect(source: BinarySource, options: DecodeOptions = {}): Promise<DetectionResult[]> {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const data = await toBytes(source, limits.maxInputBytes);
    const context = options.filename === undefined ? {} : { filename: options.filename };
    return [...this.plugins.values()]
      .map((plugin) => plugin.probe(data, context))
      .filter((result): result is DetectionResult => result !== null)
      .sort((a, b) => b.confidence - a.confidence || a.formatId.localeCompare(b.formatId));
  }

  /** Detect and decode a source, or use an explicit format hint. */
  async decode(source: BinarySource, options: DecodeOptions = {}): Promise<RetroImageDocument> {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const data = await toBytes(source, limits.maxInputBytes);
    let formatId = options.formatId;
    if (!formatId) {
      const context = options.filename === undefined ? {} : { filename: options.filename };
      const detected = [...this.plugins.values()]
        .map((plugin) => plugin.probe(data, context))
        .filter((result): result is DetectionResult => result !== null)
        .sort((a, b) => b.confidence - a.confidence || a.formatId.localeCompare(b.formatId));
      if (detected.length === 0) throw new RetroImageError("FORMAT_NOT_FOUND", "No registered codec recognized the input");
      if (detected[1] && detected[0]!.confidence === detected[1].confidence) {
        throw new RetroImageError("AMBIGUOUS_FORMAT", "More than one codec matched with equal confidence", detected);
      }
      formatId = detected[0]!.formatId;
    }
    const document = await this.plugin(formatId).decode(data, { ...options, limits });
    if (document.width * document.height > limits.maxPixels) {
      throw new RetroImageError("LIMIT_EXCEEDED", `Decoded image exceeds ${limits.maxPixels} pixels`);
    }
    return document;
  }

  /** Validate an image against a concrete target mode without mutating it. */
  analyze(image: RgbaImage | RetroImageDocument, target: CodecTarget): AnalysisResult {
    const plugin = this.plugin(target.formatId);
    const mode = plugin.definition.modes.find(({ id }) => id === target.modeId);
    if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown mode ${target.modeId}`);
    return plugin.analyze?.(image, target) ?? analyzeDimensions(image, target, mode);
  }

  /** Explicitly convert an image into a target-native document. */
  async convert(
    image: RgbaImage | RetroImageDocument,
    target: CodecTarget,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    const plugin = this.plugin(target.formatId);
    const mode = plugin.definition.modes.find(({ id }) => id === target.modeId);
    if (!mode) throw new RetroImageError("UNSUPPORTED_MODE", `Unknown mode ${target.modeId}`);
    return plugin.convert?.(image, target, options) ?? genericConvert(image, target, mode, options);
  }

  /** Strictly encode an already valid native document. */
  async encode(document: RetroImageDocument, options: EncodeOptions = {}): Promise<EncodeResult> {
    const targetId = options.target?.formatId ?? document.formatId;
    const plugin = this.plugin(targetId);
    const target = options.target ?? {
      formatId: targetId,
      modeId: document.modeId,
      displayProfile: document.displayProfile
    };
    const validation = this.analyze(document, target);
    if (!validation.valid) throw new RetroImageError("VALIDATION_FAILED", "Document violates target limitations", validation);
    return plugin.encode(document, options);
  }

  private plugin(formatId: string): FormatPlugin {
    const plugin = this.plugins.get(formatId);
    if (!plugin) throw new RetroImageError("FORMAT_NOT_FOUND", `Format ${formatId} is not registered`);
    return plugin;
  }
}

/** Create a registry from an explicit list of selected codecs. */
export function createRegistry(plugins: FormatPlugin[] = []): FormatRegistry {
  return new FormatRegistry(plugins);
}
