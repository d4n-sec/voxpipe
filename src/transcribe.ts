import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { MAX_UPLOAD_BYTES } from "./backends/chatgpt";
import type { Backend, BackendLimits, BackendRequest, ChunkingMode } from "./backends/types";
import { isRetryable } from "./errors";
import { detectSilences, extractAudio, extractSegment, probeDuration } from "./ffmpeg";
import { joinTranscripts, writeSegmentedOutput } from "./output";
import { noopProgress } from "./progress";
import { planSegments, tailPrompt } from "./segment";
import type {
  InputResult,
  Mode,
  SegmentOptions,
  SegmentPlan,
  SegmentResult,
  Silence,
  TranscribeOptions,
} from "./types";

const DEFAULT_SILENCE_DB = -35;
const DEFAULT_SILENCE_DUR = 0.35;

type State = {
  input: string;
  inputSize: number;
  inputMtimeMs: number;
  segments: SegmentPlan[];
  done: Record<number, string>;
};

export type PreviewOptions = {
  segment: SegmentOptions;
  silenceDb?: number;
  silenceDur?: number;
  silences?: Silence[];
  keep?: boolean;
  resolveDuration?: (audio: string) => number;
  chunking?: ChunkingMode;
  limits?: BackendLimits;
};

export type PreviewResult = {
  file: string;
  duration: number;
  sizeBytes: number;
  silences: number;
  mode: Mode;
  fallback: boolean;
  segments: Array<{ index: number; start: number; end: number; duration: number; overlapped: boolean }>;
};

function backoffDelay(attempt: number): number {
  const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

async function requestWithRetry(
  options: TranscribeOptions,
  req: BackendRequest,
  index: number,
): Promise<string> {
  const attempts = Math.max(1, options.retries);
  const progress = options.onProgress ?? noopProgress;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await options.backend.transcribe(req);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryable(error)) throw error;
      const delayMs = backoffDelay(attempt);
      progress({
        type: "retry",
        index,
        attempt,
        delayMs,
        reason: error instanceof Error ? error.message : String(error),
      });
      await Bun.sleep(delayMs);
    }
  }
  throw lastError;
}

/** The backend declares its preferred strategy; an explicit override wins. */
export function resolveChunking(backend: Backend, override?: ChunkingMode): ChunkingMode {
  if (override) return override;
  if (backend.chunking) return backend.chunking;
  return backend.limits?.maxInputSeconds ? "silence" : "none";
}

/**
 * Pure decision about whether a run needs to be split, given the backend's
 * declared policy and an optional user override.
 */
export function decideChunking(
  backend: Backend,
  override: ChunkingMode | undefined,
  sizeBytes: number,
  duration: number,
  targetSeconds: number,
): { chunking: ChunkingMode; needsChunks: boolean } {
  const chunking = resolveChunking(backend, override);
  const limits = backend.limits ?? {};
  const maxInputBytes = limits.maxInputBytes;
  const needsChunks =
    chunking === "none"
      ? maxInputBytes !== undefined && sizeBytes > maxInputBytes
      : sizeBytes > (maxInputBytes ?? MAX_UPLOAD_BYTES) || (duration > 0 && duration > targetSeconds);
  return { chunking, needsChunks };
}

export async function transcribe(input: string, options: TranscribeOptions): Promise<InputResult> {
  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);

  const progress = options.onProgress ?? noopProgress;
  const segmentOptions = { ...options.segment };
  const limits = options.backend.limits ?? {};
  const work = mkdtempSync(join(tmpdir(), "voxpipe-"));

  try {
    const audio = join(work, "audio.webm");
    extractAudio(input, audio);
    const size = statSync(audio).size;
    const duration = options.resolveDuration ? options.resolveDuration(audio) : probeDuration(audio);
    progress({ type: "probe", duration, sizeBytes: size });

    const { chunking, needsChunks } = decideChunking(
      options.backend,
      options.chunking,
      size,
      duration,
      segmentOptions.targetSeconds,
    );
    if (chunking === "silence" && limits.maxInputSeconds) {
      segmentOptions.maxSeconds = Math.min(segmentOptions.maxSeconds, limits.maxInputSeconds);
    }

    if (!needsChunks) {
      progress({ type: "plan", mode: "single", fallback: false, segmentCount: 1 });
      const text = (
        await requestWithRetry(
          options,
          { file: audio, language: options.language, prompt: options.prompt, model: options.model, signal: options.signal },
          0,
        )
      ).trim();
      progress({ type: "done", mode: "single", chars: text.length });
      return { input, mode: "single", fallback: false, text, segments: [] };
    }

    if (duration === 0) throw new Error("Could not determine audio duration for segmentation");

    const silences =
      options.silences ??
      detectSilences(audio, options.silenceDb ?? DEFAULT_SILENCE_DB, options.silenceDur ?? DEFAULT_SILENCE_DUR);
    const { segments: plans, fallback } = planSegments(duration, segmentOptions, silences);
    const mode: Mode = plans.length <= 1 ? "single" : fallback ? "segmented" : "joined";
    progress({ type: "plan", mode, fallback, segmentCount: Math.max(1, plans.length) });

    if (plans.length <= 1) {
      const text = (
        await requestWithRetry(
          options,
          { file: audio, language: options.language, prompt: options.prompt, model: options.model, signal: options.signal },
          0,
        )
      ).trim();
      progress({ type: "done", mode: "single", chars: text.length });
      return { input, mode: "single", fallback: false, text, segments: [] };
    }

    const stem = basename(input, extname(input));
    const outDir = options.outDir ?? join(process.cwd(), `${stem}.segments`);

    let state: State | undefined;
    let statePath: string | undefined;
    const stateDir = mode === "segmented" ? options.stateDir ?? join(outDir, ".voxpipe") : undefined;
    if (mode === "segmented" && stateDir) {
      statePath = join(stateDir, "state.json");
      const inputStat = statSync(input);
      if (existsSync(statePath)) {
        try {
          const parsed = JSON.parse(readFileSync(statePath, "utf8")) as State;
          if (
            parsed.input === input &&
            parsed.inputSize === inputStat.size &&
            parsed.inputMtimeMs === inputStat.mtimeMs
          ) {
            state = parsed;
          }
        } catch {
          state = undefined;
        }
      }
      if (!state) {
        state = {
          input,
          inputSize: inputStat.size,
          inputMtimeMs: inputStat.mtimeMs,
          segments: plans,
          done: {},
        };
      } else if (state.segments.length !== plans.length) {
        state.segments = plans;
        state.done = {};
      }
    }

    const results: SegmentResult[] = [];
    for (const plan of plans) {
      const total = plans.length;
      const cached = state?.done[plan.index];
      if (cached !== undefined) {
        results.push({ ...plan, text: cached });
        progress({ type: "segment-done", index: plan.index, total, chars: cached.length, cached: true });
        continue;
      }

      progress({
        type: "segment-start",
        index: plan.index,
        total,
        start: plan.start,
        end: plan.end,
        overlapped: plan.overlapped,
      });

      const file = join(work, `chunk_${String(plan.index).padStart(4, "0")}.webm`);
      extractSegment(audio, file, plan.start, plan.end);
      const prompt =
        options.prompt ?? (plan.overlapped ? undefined : tailPrompt(results.map((r) => r.text).join(" ")));
      const text = await requestWithRetry(
        options,
        { file, language: options.language, prompt, model: options.model, signal: options.signal },
        plan.index,
      );
      results.push({ ...plan, text });

      if (state && statePath && stateDir) {
        state.done[plan.index] = text;
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
      }

      progress({ type: "segment-done", index: plan.index, total, chars: text.length, cached: false });
    }

    if (mode === "segmented") {
      if (statePath && !options.keepState) rmSync(dirname(statePath), { recursive: true, force: true });
      const result: InputResult = { input, mode, fallback: true, text: "", segments: results, outDir };
      writeSegmentedOutput(input, outDir, result);
      progress({ type: "done", mode, chars: 0, outDir });
      return result;
    }

    const text = joinTranscripts(results.map((r) => r.text), options.language);
    progress({ type: "done", mode, chars: text.length });
    return { input, mode, fallback: false, text, segments: results };
  } finally {
    if (options.keep) {
      process.stderr.write(`[voxpipe] kept intermediate files in ${work}\n`);
    } else {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

export function previewInput(input: string, options: PreviewOptions): PreviewResult {
  if (!existsSync(input)) throw new Error(`Input not found: ${input}`);
  const work = mkdtempSync(join(tmpdir(), "voxpipe-"));
  try {
    const audio = join(work, "audio.webm");
    extractAudio(input, audio);
    const size = statSync(audio).size;
    const duration = options.resolveDuration ? options.resolveDuration(audio) : probeDuration(audio);

    const backend: Backend = {
      name: "preview",
      transcribe: async () => "",
      chunking: options.chunking,
      limits: options.limits,
    };
    const { needsChunks } = decideChunking(
      backend,
      options.chunking,
      size,
      duration,
      options.segment.targetSeconds,
    );

    if (!needsChunks) {
      return {
        file: basename(input),
        duration: Number(duration.toFixed(1)),
        sizeBytes: size,
        silences: 0,
        mode: "single",
        fallback: false,
        segments: [],
      };
    }

    const silences =
      options.silences ??
      detectSilences(audio, options.silenceDb ?? DEFAULT_SILENCE_DB, options.silenceDur ?? DEFAULT_SILENCE_DUR);
    const { segments, fallback } = planSegments(duration, options.segment, silences);
    return {
      file: basename(input),
      duration: Number(duration.toFixed(1)),
      sizeBytes: size,
      silences: silences.length,
      mode: segments.length <= 1 ? "single" : fallback ? "segmented" : "joined",
      fallback,
      segments: segments.map((segment) => ({
        index: segment.index + 1,
        start: Number(segment.start.toFixed(1)),
        end: Number(segment.end.toFixed(1)),
        duration: Number((segment.end - segment.start).toFixed(1)),
        overlapped: segment.overlapped,
      })),
    };
  } finally {
    if (!options.keep) rmSync(work, { recursive: true, force: true });
  }
}
