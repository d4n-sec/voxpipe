import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandBackend } from "../src/backends/command";
import type { Backend } from "../src/backends/types";
import { writeSegmentedOutput, segmentFileName } from "../src/output";
import { toOutcome } from "../src/service";
import { transcribe } from "../src/transcribe";
import type { InputResult, TranscribeOptions } from "../src/types";

const hasFfmpeg = (() => {
  try {
    return Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
})();
const segment = { targetSeconds: 2, maxSeconds: 3, overlapSeconds: 0.5, minSegmentSeconds: 0, silenceWindowFraction: 0.7 };

async function withTone(fn: (input: string, dir: string) => Promise<void>, duration = 8): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-regression-"));
  try {
    const input = join(dir, "tone.wav");
    const generated = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`, input]);
    expect(generated.exitCode).toBe(0);
    await fn(input, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.skipIf(!hasFfmpeg)("mixed segmented and plain CLI inputs write to the output directory", async () => {
  await withTone(async (input, dir) => {
    const short = join(dir, "short.wav");
    expect(Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-t", "1", short]).exitCode).toBe(0);
    const outDir = join(dir, "out");
    const proc = Bun.spawnSync(["bun", "run", join(import.meta.dir, "../bin/voxpipe.ts"), input, short, "--backend", "command", "--command", 'sh -c "echo transcript"', "--chunking", "silence", "--chunk-seconds", "2", "--max-seconds", "3", "--overlap-seconds", "0.5", "-o", outDir], {
      env: { ...process.env, VOXPIPE_CONFIG: join(dir, "absent.toml"), VOXPIPE_MIN_SEGMENT_SECONDS: "0" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(readFileSync(join(outDir, "short.txt"), "utf8")).toBe("transcript\n");
    expect(existsSync(join(outDir, "tone", "manifest.json"))).toBe(true);
  });
});

test.skipIf(!hasFfmpeg)("interrupted runs resume matching settings and invalidate every transcript setting and exact plan", async () => {
  await withTone(async (input, dir) => {
    let attempts = 0;
    const broken: Backend = { name: "fake", cacheKey: "settings-A", chunking: "silence", async transcribe() {
      if (++attempts === 2) throw new Error("interrupted");
      return "saved transcript";
    } };
    const options: TranscribeOptions = { backend: broken, segment, retries: 1, silences: [], outDir: join(dir, "out"), keepState: true, language: "en", prompt: "vocabulary", model: "model-A" };
    await expect(transcribe(input, options)).rejects.toThrow("interrupted");
    let calls = 0;
    const backend: Backend = { ...broken, async transcribe() { calls++; return "new transcript"; } };
    let result = await transcribe(input, { ...options, backend });
    expect(calls).toBe(result.segments.length - 1);
    expect(result.segments[0].text).toBe("saved transcript");
    calls = 0;
    result = await transcribe(input, { ...options, backend });
    expect(calls).toBe(0);

    const changes: Partial<TranscribeOptions>[] = [
      { backend: { ...backend, name: "other" } },
      { backend: { ...backend, cacheKey: "settings-B" } },
      { language: "zh" },
      { prompt: "new vocabulary" },
      { model: "model-B" },
      { segment: { ...segment, targetSeconds: 2.1 } },
    ];
    for (const change of changes) {
      await transcribe(input, { ...options, backend });
      calls = 0;
      const changed = await transcribe(input, { ...options, backend, ...change });
      expect(changed.segments).toHaveLength(result.segments.length);
      expect(calls).toBe(changed.segments.length);
      expect(changed.segments.every((part) => part.text === "new transcript")).toBe(true);
    }

    const commandOptions = { ...options, backend: createCommandBackend('sh -c "echo command-A"') };
    await transcribe(input, commandOptions);
    const commandResult = await transcribe(input, { ...commandOptions, backend: createCommandBackend('sh -c "echo command-B"') });
    expect(commandResult.segments.every((part) => part.text === "command-B")).toBe(true);
  });
});

test("replacing output preserves historical files and reports only the current transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-output-regression-"));
  try {
    const base = { input: "tone.wav", mode: "segmented" as const, fallback: true, text: "", outDir: dir };
    const old: InputResult = { ...base, segments: [
      { index: 0, start: 0, end: 5, overlapped: true, text: "old matching overlap phrase" },
      { index: 1, start: 4, end: 10, overlapped: false, text: "matching overlap phrase old ending" },
    ] };
    writeSegmentedOutput(base.input, dir, old);
    expect(existsSync(join(dir, "merged.txt"))).toBe(true);
    const oldMerged = readFileSync(join(dir, "merged.txt"), "utf8");
    // Existing released manifests have no merged ownership field.
    const legacy = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    delete legacy.merged;
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(legacy));
    writeFileSync(join(dir, "notes.txt"), "user notes");
    writeFileSync(join(dir, "seg_9999_000000-000001.txt"), "unowned file");
    const current: InputResult = { ...base, segments: [
      { index: 0, start: 0, end: 6, overlapped: true, text: "new beginning" },
      { index: 1, start: 5, end: 11, overlapped: false, text: "unrelated new ending" },
    ] };
    writeSegmentedOutput(base.input, dir, current);
    expect(readFileSync(join(dir, "merged.txt"), "utf8")).toBe(oldMerged);
    for (const part of old.segments) {
      expect(readFileSync(join(dir, segmentFileName(part)), "utf8")).toBe(part.text + "\n");
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.merged).toBeNull();
    expect(manifest.segments.map((part: { file: string }) => part.file)).toEqual(current.segments.map(segmentFileName));
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("user notes");
    expect(readFileSync(join(dir, "seg_9999_000000-000001.txt"), "utf8")).toBe("unowned file");
    const outcome = toOutcome(current);
    expect(outcome.mode).toBe("segmented");
    if (outcome.mode !== "segmented") throw new Error("expected segmented output");
    expect(outcome.files).toEqual(current.segments.map(segmentFileName));
    expect(outcome.merged).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unrelated merged filename is preserved and omitted from current output", () => {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-unowned-output-"));
  try {
    writeFileSync(join(dir, "merged.txt"), "user content");
    const result: InputResult = { input: "tone.wav", mode: "segmented", fallback: true, text: "", outDir: dir, segments: [
      { index: 0, start: 0, end: 6, overlapped: true, text: "new beginning" },
      { index: 1, start: 5, end: 11, overlapped: false, text: "unrelated new ending" },
    ] };
    writeSegmentedOutput(result.input, dir, result);
    writeSegmentedOutput(result.input, dir, result);
    expect(readFileSync(join(dir, "merged.txt"), "utf8")).toBe("user content");
    const outcome = toOutcome(result);
    if (outcome.mode !== "segmented") throw new Error("expected segmented output");
    expect(outcome.merged).toBeUndefined();
    expect(outcome.files).toEqual(result.segments.map(segmentFileName));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)("transcription requests stay below the backend ceiling when the target is larger", async () => {
  await withTone(async (input, dir) => {
    const durations: number[] = [];
    const backend: Backend = { name: "limited", chunking: "silence", limits: { maxInputSeconds: 3 }, async transcribe(req) {
      const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", req.file]);
      durations.push(Number(probe.stdout.toString()));
      return "transcript";
    } };
    const result = await transcribe(input, { backend, segment: { ...segment, targetSeconds: 6, maxSeconds: 6, overlapSeconds: 0, minSegmentSeconds: 1 }, retries: 1, silences: [], outDir: join(dir, "out") });
    expect(result.segments).toHaveLength(3);
    expect(result.segments.every((part) => part.end - part.start <= 3)).toBe(true);
    expect(durations).toHaveLength(3);
    // Opus container duration includes encoder padding, so allow that padding.
    expect(durations.every((duration) => duration <= 3.02)).toBe(true);
  });
});
