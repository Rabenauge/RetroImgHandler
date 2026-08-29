import { indexedToRgba } from "../core/color";
import { analyzePaletteCapabilities, imagePreview } from "../core/conversion";
import type {
  AnalysisResult,
  CodecTarget,
  FormatModeDefinition,
  RasterDocument,
  RetroImageDocument,
  RgbColor,
  RgbaImage
} from "../core/types";

export const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

export function rasterDocument(input: Omit<RasterDocument, "kind" | "preview">): RasterDocument {
  return {
    kind: "raster",
    ...input,
    preview: indexedToRgba(input.indices, input.width, input.height, input.palette)
  };
}

export function modeAnalysis(
  image: RgbaImage | RetroImageDocument,
  target: CodecTarget,
  mode: FormatModeDefinition,
  extraIssues: AnalysisResult["issues"] = []
): AnalysisResult {
  const preview = imagePreview(image);
  const sizeOk = mode.dimensions.some((size) => size.width === preview.width && size.height === preview.height);
  const issues = [...extraIssues, ...analyzePaletteCapabilities(image, target, mode)];
  if (!sizeOk) {
    issues.unshift({
      severity: "error",
      code: "DIMENSIONS_MISMATCH",
      message: `${preview.width}x${preview.height} does not match ${mode.label}`,
      rule: "dimensions",
      details: { width: preview.width, height: preview.height }
    });
  }
  return { valid: !issues.some(({ severity }) => severity === "error"), target, issues };
}

export function modeFor(pluginModes: FormatModeDefinition[], modeId: string): FormatModeDefinition {
  const mode = pluginModes.find(({ id }) => id === modeId);
  if (!mode) throw new Error(`Unknown mode ${modeId}`);
  return mode;
}

export function extensionConfidence(extension: string, expected: string[]): number {
  return expected.includes(extension) ? 0.15 : 0;
}
