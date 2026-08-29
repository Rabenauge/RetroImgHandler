import { RetroImageError } from "./errors";
import type { BinarySource, ResourceLimits } from "./types";

export const DEFAULT_LIMITS: ResourceLimits = {
  maxInputBytes: 16 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024,
  maxChunks: 4096,
  maxDecompressedBytes: 64 * 1024 * 1024
};

export async function toBytes(source: BinarySource, maxBytes: number): Promise<Uint8Array> {
  let data: Uint8Array;
  if (source instanceof Uint8Array) data = source;
  else if (source instanceof ArrayBuffer) data = new Uint8Array(source);
  else if (typeof Blob !== "undefined" && source instanceof Blob) {
    if (source.size > maxBytes) {
      throw new RetroImageError("LIMIT_EXCEEDED", `Input exceeds ${maxBytes} bytes`);
    }
    data = new Uint8Array(await source.arrayBuffer());
  } else {
    throw new RetroImageError("INVALID_OPTION", "Unsupported binary source");
  }
  if (data.byteLength > maxBytes) {
    throw new RetroImageError("LIMIT_EXCEEDED", `Input exceeds ${maxBytes} bytes`);
  }
  return data;
}

export class BinaryReader {
  readonly data: Uint8Array;
  offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  ensure(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      throw new RetroImageError("INVALID_FILE", "Unexpected end of file", {
        offset: this.offset,
        requested: length,
        size: this.data.length
      });
    }
  }

  u8(): number {
    this.ensure(1);
    return this.data[this.offset++]!;
  }

  i8(): number {
    const value = this.u8();
    return value > 127 ? value - 256 : value;
  }

  u16be(): number {
    this.ensure(2);
    const value = (this.data[this.offset]! << 8) | this.data[this.offset + 1]!;
    this.offset += 2;
    return value;
  }

  i16be(): number {
    const value = this.u16be();
    return value > 0x7fff ? value - 0x10000 : value;
  }

  u16le(): number {
    this.ensure(2);
    const value = this.data[this.offset]! | (this.data[this.offset + 1]! << 8);
    this.offset += 2;
    return value;
  }

  u32be(): number {
    this.ensure(4);
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Uint8Array {
    this.ensure(length);
    const result = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  ascii(length: number): string {
    return String.fromCharCode(...this.bytes(length));
  }

  skip(length: number): void {
    this.ensure(length);
    this.offset += length;
  }
}

export class BinaryWriter {
  private readonly values: number[] = [];

  u8(value: number): void {
    this.values.push(value & 0xff);
  }

  u16be(value: number): void {
    this.values.push((value >>> 8) & 0xff, value & 0xff);
  }

  u16le(value: number): void {
    this.values.push(value & 0xff, (value >>> 8) & 0xff);
  }

  u32be(value: number): void {
    this.values.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }

  ascii(value: string): void {
    for (const char of value) this.u8(char.charCodeAt(0));
  }

  bytes(value: Uint8Array | number[]): void {
    this.values.push(...value);
  }

  result(): Uint8Array {
    return Uint8Array.from(this.values);
  }
}

export function extensionOf(filename?: string): string {
  if (!filename) return "";
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}
