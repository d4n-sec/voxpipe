import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { AuthError } from "../errors";
import { runTranscribe, type CoreArgs, type TranscribeOutcome } from "../service";
import type { ProgressEvent } from "../types";
import { VERSION } from "../version";

const MAX_BODY_BYTES = 200 * 1024 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function field(form: { get(key: string): unknown }, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

type Prepared = { args: CoreArgs; cleanup: () => void };

async function prepare(req: Request, isMultipart: boolean): Promise<Prepared> {
  if (isMultipart) {
    let form: { get(key: string): unknown };
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "could not parse multipart/form-data body");
    }
    const upload = form.get("file");
    if (!(upload instanceof File)) throw new HttpError(400, "multipart field `file` is required");
    const outDir = field(form, "outDir");
    if (!outDir) throw new HttpError(400, "outDir is required for serve mode");
    const ext = extname(upload.name).replace(/[^A-Za-z0-9.]/g, "") || ".bin";
    const dir = mkdtempSync(join(tmpdir(), "voxpipe-upload-"));
    const target = join(dir, `upload${ext}`);
    try {
      await Bun.write(target, upload);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw new HttpError(500, `could not store upload: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
      args: {
        path: target,
        language: field(form, "language"),
        prompt: field(form, "prompt"),
        model: field(form, "model"),
        backend: field(form, "backend"),
        command: field(form, "command"),
        outDir,
      },
      cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "JSON body must be an object");
  const obj = body as Record<string, unknown>;
  const path = optional(obj.path);
  if (!path) throw new HttpError(400, "`path` is required");
  const outDir = optional(obj.outDir);
  if (!outDir) throw new HttpError(400, "outDir is required for serve mode");
  return {
    args: {
      path,
      language: optional(obj.language),
      prompt: optional(obj.prompt),
      model: optional(obj.model),
      backend: optional(obj.backend),
      command: optional(obj.command),
      outDir,
    },
    cleanup: () => {},
  };
}

function statusFor(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof AuthError) return 401;
  return 500;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sseResponse(run: (emit: (event: ProgressEvent) => void, signal: AbortSignal) => Promise<TranscribeOutcome>): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client disconnected; the abort signal stops the job.
        }
      };
      const emit = (event: ProgressEvent) => send(`data: ${JSON.stringify(event)}\n\n`);
      try {
        const outcome = await run(emit, abort.signal);
        send(`event: result\ndata: ${JSON.stringify(outcome)}\n\n`);
      } catch (error) {
        send(`event: error\ndata: ${JSON.stringify({ message: messageFor(error) })}\n\n`);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

async function handleTranscribe(req: Request, url: URL): Promise<Response> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "request body too large" }, { status: 413 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const isMultipart = contentType.toLowerCase().includes("multipart/form-data");
  const isJson = contentType.toLowerCase().includes("application/json");
  if (!isMultipart && !isJson) {
    return Response.json({ error: "expected multipart/form-data or application/json" }, { status: 415 });
  }

  const accept = req.headers.get("accept") ?? "";
  const wantsSse = accept.includes("text/event-stream") || url.searchParams.get("progress") === "1";

  try {
    if (wantsSse) {
      return sseResponse(async (emit, signal) => {
        const prepared = await prepare(req, isMultipart);
        try {
          return await runTranscribe(prepared.args, { onProgress: emit, signal });
        } finally {
          prepared.cleanup();
        }
      });
    }

    const prepared = await prepare(req, isMultipart);
    try {
      const outcome = await runTranscribe(prepared.args);
      const format = url.searchParams.get("format") ?? "json";
      if (format === "text" && outcome.mode !== "segmented") {
        return new Response(outcome.text + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return Response.json(outcome);
    } finally {
      prepared.cleanup();
    }
  } catch (error) {
    return Response.json({ error: messageFor(error) }, { status: statusFor(error) });
  }
}

type ListenArgs = { host: string; port: number };

function parseArgs(argv: string[], defaultPort: number): ListenArgs {
  let host = "127.0.0.1";
  let port = defaultPort;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--host") host = argv[++i] ?? host;
    else if (arg.startsWith("--host=")) host = arg.slice("--host=".length);
    else if (arg === "--port") port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) port = Number(arg.slice("--port=".length));
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write("Usage: voxpipe serve [--host 127.0.0.1] [--port 8787]\n");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid --port: ${port}`);
  return { host, port };
}

export function startServer(host: string, port: number) {
  return Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: MAX_BODY_BYTES,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        return Response.json({ ok: true, version: VERSION });
      }
      if (req.method === "POST" && url.pathname === "/transcribe") {
        return handleTranscribe(req, url);
      }
      return new Response("Not Found", { status: 404 });
    },
  });
}

export async function runServe(argv: string[]): Promise<void> {
  const { host, port } = parseArgs(argv, 8787);
  const server = startServer(host, port);
  process.stderr.write(`[voxpipe] serve listening on http://${host}:${server.port}\n`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      process.stderr.write("[voxpipe] shutting down\n");
      void server.stop(true).finally(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
