export * from "./types";

export { transcribe, previewInput } from "./transcribe";
export type { PreviewOptions, PreviewResult } from "./transcribe";

export {
  DEFAULT_SEGMENT_OPTIONS,
  appendText,
  mergeOverlapping,
  nearestSilence,
  normalizeForMatch,
  normalizedIndexOf,
  overlapCut,
  planSegments,
  tailPrompt,
} from "./segment";
export type { MergeResult } from "./segment";

export { configPath, defaultConfig, loadConfig, parseToml } from "./config";
export type { VoxpipeConfig } from "./config";

export { createBackend, resolveEndpoint } from "./backends";
export type { Backend, BackendConfig, BackendRequest } from "./backends";

export {
  accountIdFromToken,
  authHeaders,
  authPath,
  decodeJwt,
  loadCredentials,
  tokenExpiry,
} from "./auth";
export type { Credentials } from "./auth";

export { AuthError, BackendError, VoxpipeError, isRetryable, isRetryableStatus } from "./errors";

export { noopProgress } from "./progress";
export type { Progress, ProgressEvent } from "./progress";
