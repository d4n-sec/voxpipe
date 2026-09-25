import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadCredentials } from "./auth";
import { createBackend } from "./backends";
import { loadConfig, type ChunkingConfig, type VoxpipeConfig } from "./config";
import { previewInput, resolveChunking, transcribe, type PreviewResult } from "./transcribe";
import type { InputResult, Progress, SegmentOptions } from "./types";

export type CoreArgs = {
  path: string;
  language?: string;
  prompt?: string;
  model?: string;
  backend?: string;
  command?: string;
  chunking?: ChunkingConfig;
  outDir?: string;
};

export type PlanArgs = CoreArgs & {
  targetSeconds?: number;
  maxSeconds?: number;
  overlapSeconds?: number;
  minSegmentSeconds?: number;
  silenceWindowFraction?: number;
  silenceDb?: number;
  silenceDur?: number;
};

export type TranscribeOutcome =
  | { mode: "single" | "joined"; text: string }
  | {
      mode: "segmented";
      outDir: string;
      segments: number;
      files: string[];
      manifest?: string;
      merged?: string;
    };

export type RunOptions = { onProgress?: Progress; signal?: AbortSignal };

function segmentOptions(args: PlanArgs, config: VoxpipeConfig): SegmentOptions {
  const targetSeconds = Math.max(1, args.targetSeconds ?? config.targetSeconds);
  const maxSeconds = Math.max(targetSeconds, args.maxSeconds ?? config.maxSeconds);
  let overlapSeconds = Math.max(0, args.overlapSeconds ?? config.overlapSeconds);
  if (overlapSeconds >= targetSeconds) overlapSeconds = Math.max(1, targetSeconds - 1);
  return {
    targetSeconds,
    maxSeconds,
    overlapSeconds,
    minSegmentSeconds: Math.max(0, args.minSegmentSeconds ?? config.minSegmentSeconds),
    silenceWindowFraction: args.silenceWindowFraction ?? config.silenceWindowFraction,
  };
}

function selectBackend(args: CoreArgs, config: VoxpipeConfig): ReturnType<typeof createBackend> {
  const name = args.backend ?? config.backend;
  if (name === "chatgpt") loadCredentials();
  return createBackend(name, { command: args.command ?? config.command });
}

export function toOutcome(result: InputResult): TranscribeOutcome {
  if (result.mode !== "segmented") return { mode: result.mode, text: result.text };
  const outDir = result.outDir ?? "";
  let files: string[] = [];
  try {
    files = readdirSync(outDir)
      .filter((name) => name.endsWith(".txt"))
      .sort();
  } catch {
    files = [];
  }
  const manifest = existsSync(join(outDir, "manifest.json")) ? join(outDir, "manifest.json") : undefined;
  const merged = existsSync(join(outDir, "merged.txt")) ? join(outDir, "merged.txt") : undefined;
  return { mode: "segmented", outDir, segments: result.segments.length, files, manifest, merged };
}

export async function runTranscribe(args: CoreArgs, options: RunOptions = {}): Promise<TranscribeOutcome> {
  const config = loadConfig({ env: process.env });
  const backend = selectBackend(args, config);
  const result = await transcribe(args.path, {
    backend,
    segment: segmentOptions(args, config),
    language: args.language ?? config.language,
    prompt: args.prompt ?? config.prompt,
    model: args.model ?? config.model,
    retries: config.retries,
    outDir: args.outDir,
    silenceDb: config.silenceDb,
    silenceDur: config.silenceDur,
    chunking: (() => {
      const mode = args.chunking ?? config.chunking;
      return mode === "auto" ? undefined : mode;
    })(),
    onProgress: options.onProgress,
    signal: options.signal,
  });
  return toOutcome(result);
}

export function runPlan(args: PlanArgs): PreviewResult {
  const config = loadConfig({ env: process.env });
  const backend = createBackend(args.backend ?? config.backend, { command: args.command ?? config.command });
  const mode = args.chunking ?? config.chunking;
  return previewInput(args.path, {
    segment: segmentOptions(args, config),
    silenceDb: args.silenceDb ?? config.silenceDb,
    silenceDur: args.silenceDur ?? config.silenceDur,
    chunking: resolveChunking(backend, mode === "auto" ? undefined : mode),
    limits: backend.limits,
  });
}
