import { spawnSync } from "bun";
import { statSync } from "node:fs";
import type { Silence } from "./types";

function run(cmd: string, args: string[]): string {
  const result = spawnSync([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const err = result.stderr?.toString().trim();
    throw new Error(`${cmd} failed (exit ${result.exitCode})${err ? `: ${err}` : ""}`);
  }
  return result.stdout.toString();
}

export function probeDuration(path: string): number {
  try {
    const out = run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const value = Number.parseFloat(out.trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function probe(path: string): { duration: number; sizeBytes: number } {
  return { duration: probeDuration(path), sizeBytes: statSync(path).size };
}

export function extractAudio(input: string, out: string): void {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "48k",
    out,
  ]);
}

export function detectSilences(input: string, db: number, dur: number): Silence[] {
  const filter = `silencedetect=noise=${db}dB:d=${dur}`;
  const result = spawnSync(
    ["ffmpeg", "-hide_banner", "-nostats", "-i", input, "-af", filter, "-f", "null", "-"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = result.stderr?.toString() ?? "";
  const silences: Silence[] = [];
  let pendingStart: number | null = null;
  for (const line of output.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[0-9.]+)/);
    const end = line.match(/silence_end:\s*(-?[0-9.]+)/);
    if (start) pendingStart = Number.parseFloat(start[1]);
    if (end) {
      silences.push({ start: pendingStart ?? 0, end: Number.parseFloat(end[1]) });
      pendingStart = null;
    }
  }
  return silences;
}

export function extractSegment(audio: string, out: string, start: number, end: number): void {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", start.toFixed(3), "-to", end.toFixed(3),
    "-i", audio,
    "-c:a", "libopus", "-b:a", "48k",
    out,
  ]);
}
