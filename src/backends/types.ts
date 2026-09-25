export type BackendRequest = {
  file: string;
  language?: string;
  prompt?: string;
  model?: string;
  signal?: AbortSignal;
};

/**
 * How the core should feed audio to a backend.
 * - `none`    send the whole file in one request (backends with no hard limit).
 * - `silence` prefer cuts at silences near the target length; blind cuts with
 *             overlap only when necessary (backends that truncate long input).
 */
export type ChunkingMode = "none" | "silence";

export interface BackendLimits {
  /** Maximum audio duration a single request can handle. */
  maxInputSeconds?: number;
  /** Maximum audio payload size a single request can handle. */
  maxInputBytes?: number;
}

export interface Backend {
  readonly name: string;
  transcribe(req: BackendRequest): Promise<string>;
  /** Declared by the backend so the core can pick a sensible default strategy. */
  readonly chunking?: ChunkingMode;
  readonly limits?: BackendLimits;
}
