import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServeArgs, startServer } from "../src/http/server";

const outDir = mkdtempSync(join(tmpdir(), "voxpipe-serve-test-"));
const server = startServer("127.0.0.1", 0, outDir);
const base = `http://127.0.0.1:${server.port}`;

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
