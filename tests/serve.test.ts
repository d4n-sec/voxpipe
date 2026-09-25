import { afterAll, expect, test } from "bun:test";
import { startServer } from "../src/http/server";

const server = startServer("127.0.0.1", 0);
const base = `http://127.0.0.1:${server.port}`;

afterAll(async () => {
  await server.stop(true);
});

test("GET /healthz reports ok", async () => {
  const res = await fetch(`${base}/healthz`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("POST /transcribe without outDir returns 400", async () => {
  const res = await fetch(`${base}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "/tmp/does-not-matter.wav", backend: "command", command: "true" }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe("outDir is required for serve mode");
});

test("POST /transcribe with an empty outDir returns 400", async () => {
  const res = await fetch(`${base}/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "/tmp/does-not-matter.wav", outDir: "" }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe("outDir is required for serve mode");
});

test("POST /transcribe multipart without outDir returns 400", async () => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "clip.wav", { type: "audio/wav" }));
  const res = await fetch(`${base}/transcribe`, { method: "POST", body: form });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe("outDir is required for serve mode");
});
