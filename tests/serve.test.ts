import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServeArgs, startServer } from "../src/http/server";

const outDir = mkdtempSync(join(tmpdir(), "voxpipe-serve-test-"));
const server = startServer("127.0.0.1", 0, outDir);
const base = `http://127.0.0.1:${server.port}`;

const hasFfmpeg = (() => {
  try {
    return Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  } catch {
    return false;
  }
})();

afterAll(async () => {
  await server.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

test("serve requires --out-dir and exits 2 without it", () => {
  const original = process.exit;
  let code: number | undefined;
  process.exit = ((value?: number) => {
    code = value;
    throw new Error("exit");
  }) as typeof process.exit;
  try {
    expect(() => parseServeArgs(["--port", "0"])).toThrow("exit");
  } finally {
    process.exit = original;
  }
  expect(code).toBe(2);
});

test("parseServeArgs accepts --out-dir and aliases", () => {
  expect(parseServeArgs(["--out-dir", "/tmp/x"]).outDir).toBe("/tmp/x");
  expect(parseServeArgs(["--out=/tmp/y"]).outDir).toBe("/tmp/y");
  expect(parseServeArgs(["-o", "/tmp/z"]).outDir).toBe("/tmp/z");
});

test("GET /healthz reports ok", async () => {
  const res = await fetch(`${base}/healthz`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("POST /transcribe rejects invalid JSON chunking with 400", async () => {
  const res = await fetch(`${base}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "/nonexistent/audio.wav", chunking: "bogus" }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain("chunking");
});

test("POST /transcribe rejects invalid multipart chunking with 400", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "audio.wav", { type: "audio/wav" }));
  form.append("chunking", "bogus");
  const res = await fetch(`${base}/transcribe`, { method: "POST", body: form });
  expect(res.status).toBe(400);
});

test.skipIf(!hasFfmpeg)("POST /transcribe accepts a valid chunking value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-serve-tone-"));
  try {
    const input = join(dir, "tone.wav");
    const gen = Bun.spawnSync(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", input],
      { stdout: "ignore", stderr: "ignore" },
    );
    expect(gen.exitCode).toBe(0);
    const res = await fetch(`${base}/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: input,
        backend: "command",
        command: 'sh -c "echo hi"',
        chunking: "none",
        outDir,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; text: string };
    expect(body.mode).toBe("single");
    expect(body.text).toBe("hi");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
