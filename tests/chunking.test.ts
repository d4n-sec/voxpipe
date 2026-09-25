import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../src/backends";
import type { Backend } from "../src/backends";
import { DEFAULT_SEGMENT_OPTIONS } from "../src/segment";
import { decideChunking, previewInput, resolveChunking } from "../src/transcribe";

const hasFfmpeg = (() => {
  try {
    return Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
})();

function withTone<T>(fn: (input: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-preview-test-"));
  try {
    const input = join(dir, "tone.wav");
    const gen = Bun.spawnSync(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", input],
      { stdout: "ignore", stderr: "ignore" },
    );
    if (gen.exitCode !== 0) throw new Error("ffmpeg could not generate the test tone");
    return fn(input);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fake(partial: Partial<Backend>): Backend {
  return {
    name: "fake",
    async transcribe() {
      return "";
    },
    ...partial,
  };
}

test("chatgpt backend declares silence chunking with a 10-minute cap", () => {
  const backend = createBackend("chatgpt");
  expect(backend.chunking).toBe("silence");
  expect(backend.limits?.maxInputSeconds).toBe(600);
});

test("command backend sends the whole file by default", () => {
  const backend = createBackend("command", { command: "true" });
  expect(backend.chunking).toBe("none");
  expect(backend.limits).toBeUndefined();
});

test("resolveChunking: override wins, then backend, then limits", () => {
  expect(resolveChunking(fake({ chunking: "silence" }), "none")).toBe("none");
  expect(resolveChunking(fake({ chunking: "silence" }))).toBe("silence");
  expect(resolveChunking(fake({ limits: { maxInputSeconds: 600 } }))).toBe("silence");
  expect(resolveChunking(fake({}))).toBe("none");
});

test("decideChunking: none does not split by duration", () => {
  const backend = fake({ chunking: "none" });
  expect(decideChunking(backend, undefined, 1_000_000, 7200, 240).needsChunks).toBe(false);
});

test("decideChunking: the command backend sends a long file whole", () => {
  const backend = createBackend("command", { command: "true" });
  expect(decideChunking(backend, undefined, 5_000_000, 3600, 240).needsChunks).toBe(false);
  expect(decideChunking(backend, "silence", 5_000_000, 3600, 240).needsChunks).toBe(true);
});

test("decideChunking: none still splits past a declared byte limit", () => {
  const backend = fake({ chunking: "none", limits: { maxInputBytes: 1000 } });
  expect(decideChunking(backend, undefined, 2000, 10, 240).needsChunks).toBe(true);
});

test("decideChunking: silence splits long audio near the target", () => {
  const backend = fake({ chunking: "silence" });
  expect(decideChunking(backend, undefined, 1000, 700, 240).needsChunks).toBe(true);
  expect(decideChunking(backend, undefined, 1000, 200, 240).needsChunks).toBe(false);
});

test("decideChunking: an explicit override forces the mode", () => {
  const backend = fake({ chunking: "none" });
  expect(decideChunking(backend, "silence", 1000, 700, 240).needsChunks).toBe(true);
});

test.skipIf(!hasFfmpeg)("previewInput with chunking none stays single for long audio", () => {
  const preview = withTone((input) =>
    previewInput(input, {
      segment: DEFAULT_SEGMENT_OPTIONS,
      resolveDuration: () => 7200,
      silences: [],
      chunking: "none",
    }),
  );
  expect(preview.mode).toBe("single");
  expect(preview.segments).toEqual([]);
});

test.skipIf(!hasFfmpeg)("previewInput with chunking silence plans segments for long audio", () => {
  const preview = withTone((input) =>
    previewInput(input, {
      segment: DEFAULT_SEGMENT_OPTIONS,
      resolveDuration: () => 7200,
      silences: [],
      chunking: "silence",
    }),
  );
  expect(preview.mode).not.toBe("single");
  expect(preview.segments.length).toBeGreaterThan(0);
});
