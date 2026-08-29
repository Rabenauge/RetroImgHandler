import { RetroImageError } from "./core/errors";
import type { RetroImageDocument, RgbaImage } from "./core/types";

/** Options for browser-native PNG export. */
export interface PngExportOptions {
  aspectMode?: "native" | "square";
}

function sourceImage(image: RgbaImage | RetroImageDocument): { rgba: RgbaImage; ratio: number } {
  if ("kind" in image) {
    return { rgba: image.preview, ratio: image.pixelAspect.numerator / image.pixelAspect.denominator };
  }
  return { rgba: image, ratio: 1 };
}

/** Export RGBA or a decoded document through Canvas/OffscreenCanvas as PNG bytes. */
export async function exportPng(
  image: RgbaImage | RetroImageDocument,
  options: PngExportOptions = {}
): Promise<Uint8Array> {
  const { rgba, ratio } = sourceImage(image);
  const width = options.aspectMode === "square" ? Math.max(1, Math.round(rgba.width * ratio)) : rgba.width;
  const height = rgba.height;
  const bitmap = new ImageData(rgba.data.slice(), rgba.width, rgba.height);

  if (typeof OffscreenCanvas !== "undefined") {
    const source = new OffscreenCanvas(rgba.width, rgba.height);
    const sourceContext = source.getContext("2d");
    if (!sourceContext) throw new RetroImageError("UNSUPPORTED_RUNTIME", "OffscreenCanvas 2D is unavailable");
    sourceContext.putImageData(bitmap, 0, 0);
    const target = width === rgba.width ? source : new OffscreenCanvas(width, height);
    if (target !== source) {
      const targetContext = target.getContext("2d");
      if (!targetContext) throw new RetroImageError("UNSUPPORTED_RUNTIME", "OffscreenCanvas 2D is unavailable");
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(source, 0, 0, width, height);
    }
    const blob = await target.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }

  if (typeof document !== "undefined") {
    const source = document.createElement("canvas");
    source.width = rgba.width;
    source.height = rgba.height;
    const sourceContext = source.getContext("2d");
    if (!sourceContext) throw new RetroImageError("UNSUPPORTED_RUNTIME", "Canvas 2D is unavailable");
    sourceContext.putImageData(bitmap, 0, 0);
    const target = width === rgba.width ? source : document.createElement("canvas");
    if (target !== source) {
      target.width = width;
      target.height = height;
      const targetContext = target.getContext("2d");
      if (!targetContext) throw new RetroImageError("UNSUPPORTED_RUNTIME", "Canvas 2D is unavailable");
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(source, 0, 0, width, height);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      target.toBlob((value) => value ? resolve(value) : reject(new RetroImageError("UNSUPPORTED_RUNTIME", "PNG encoder failed")), "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  throw new RetroImageError("UNSUPPORTED_RUNTIME", "PNG export requires Canvas or OffscreenCanvas");
}
