import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatGptBackend } from "../src/backends/chatgpt";

type Received = {
  contentType: string;
  file: File | null;
  fields: Record<string, string>;
};

let server: ReturnType<typeof Bun.serve>;
let received: Received | null = null;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const contentType = req.headers.get("content-type") ?? "";
      const form = await req.formData();
      const upload = form.get("file");
      const fields: Record<string, string> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") fields[key] = value;
      }
      received = { contentType, file: upload instanceof File ? upload : null, fields };
      return Response.json({ text: "hello from mock" });
    },
  });
});

afterAll(() => {
  void server.stop(true);
  delete process.env.VOXPIPE_ENDPOINT;
  delete process.env.CODEX_STT_TOKEN;
});

test("chatgpt backend posts multipart with a file field and parses {text}", async () => {
  process.env.VOXPIPE_ENDPOINT = `http://127.0.0.1:${server.port}/transcribe`;
  process.env.CODEX_STT_TOKEN = "test-token";

  const dir = mkdtempSync(join(tmpdir(), "voxpipe-mock-"));
  const file = join(dir, "audio.webm");
  writeFileSync(file, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01, 0x02, 0x03]));

  try {
    const backend = createChatGptBackend();
    const text = await backend.transcribe({ file, language: "zh", model: "gpt-4o-transcribe" });

    expect(text).toBe("hello from mock");
    expect(received).not.toBeNull();
    expect(received!.contentType).toContain("multipart/form-data");
    expect(received!.file).not.toBeNull();
    expect(received!.file!.name).toBe("audio.webm");
    expect(received!.fields.language).toBe("zh");
    expect(received!.fields.model).toBe("gpt-4o-transcribe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
