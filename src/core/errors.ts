/** Stable error categories produced by RetroImgHandler. */
export type RetroImageErrorCode =
  | "AMBIGUOUS_FORMAT"
  | "DUPLICATE_FORMAT"
  | "FORMAT_NOT_FOUND"
  | "INVALID_FILE"
  | "INVALID_OPTION"
  | "LIMIT_EXCEEDED"
  | "MISSING_HINT"
  | "UNSUPPORTED_SEQUENCE"
  | "UNSUPPORTED_MODE"
  | "UNSUPPORTED_RUNTIME"
  | "VALIDATION_FAILED";

/** Typed error for invalid files, unsupported operations, and API misuse. */
export class RetroImageError extends Error {
  readonly code: RetroImageErrorCode;
  readonly details?: unknown;

  constructor(code: RetroImageErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "RetroImageError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
