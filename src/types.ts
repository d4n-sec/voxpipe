export type Mode = "single" | "joined" | "segmented";

export type SegmentPlan = {
  index: number;
  start: number;
  end: number;
  overlapped: boolean;
};

export type SegmentOptions = {
  targetSeconds: number;
  maxSeconds: number;
  overlapSeconds: number;
  minSegmentSeconds: number;
  silenceWindowFraction: number;
};

export type Silence = { start: number; end: number };

export type ProgressEvent =
  | { type: "probe"; duration: number; sizeBytes: number }
  | { type: "plan"; mode: Mode; fallback: boolean; segmentCount: number }
  | { type: "segment-start"; index: number; total: number; start: number; end: number; overlapped: boolean }
  | { type: "segment-done"; index: number; total: number; chars: number; cached: boolean }
  | { type: "retry"; index: number; attempt: number; delayMs: number; reason: string }
  | { type: "done"; mode: Mode; chars: number; outDir?: string };

export type Progress = (event: ProgressEvent) => void;

export type TranscribeOptions = {
  backend: import("./backends/types").Backend;
  segment: SegmentOptions;
  language?: string;
  prompt?: string;
  model?: string;
  retries: number;
  outDir?: string;
  stateDir?: string;
  keepState?: boolean;
  resolveDuration?: (audio: string) => number;
  onProgress?: Progress;
  signal?: AbortSignal;
  silenceDb?: number;
  silenceDur?: number;
  silences?: Silence[];
  keep?: boolean;
};

export type SegmentResult = SegmentPlan & { text: string };

export type InputResult = {
  input: string;
  mode: Mode;
  fallback: boolean;
  text: string;
  segments: SegmentResult[];
  outDir?: string;
};
