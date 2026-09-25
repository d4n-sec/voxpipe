import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AuthError } from "../errors";
import { runPlan, runTranscribe, type CoreArgs, type PlanArgs } from "../service";
import type { ProgressEvent } from "../types";
import { VERSION } from "../version";

const SERVER_NAME = "voxpipe";

function describeError(error: unknown): string {
  if (error instanceof AuthError) {
    return /codex login/i.test(error.message) ? error.message : `${error.message} Run \`codex login\` and retry.`;
  }
  return error instanceof Error ? error.message : String(error);
}

const transcribeSchema = {
  path: z.string().describe("Path to a local audio/video file readable by ffmpeg."),
  language: z.string().optional().describe("Language hint, e.g. zh, en, ja."),
  prompt: z.string().optional().describe("Prompt/vocabulary hint."),
  model: z.string().optional().describe("Model name, default gpt-4o-transcribe."),
  backend: z.enum(["chatgpt", "command"]).optional().describe("Backend to use; defaults to config."),
  command: z.string().optional().describe("Command backend template with {file} {language} {model}."),
  outDir: z.string().optional().describe("Output directory for segmented runs; defaults to the server's --out-dir."),
};

const planSchema = {
  path: z.string().describe("Path to a local audio/video file readable by ffmpeg."),
  targetSeconds: z.number().positive().optional().describe("Target chunk length in seconds."),
  maxSeconds: z.number().positive().optional().describe("Hard chunk ceiling in seconds."),
  overlapSeconds: z.number().nonnegative().optional().describe("Overlap used when cutting blind."),
  minSegmentSeconds: z.number().nonnegative().optional().describe("Minimum usable segment length."),
  silenceWindowFraction: z.number().min(0).max(1).optional().describe("Silence search window fraction."),
  silenceDb: z.number().optional().describe("Silence threshold in dB."),
  silenceDur: z.number().nonnegative().optional().describe("Minimum silence length in seconds."),
};

function progressParams(event: ProgressEvent, total: number): { progress: number; total?: number; message: string } {
  switch (event.type) {
    case "probe":
      return { progress: 0, message: `probed ${event.duration.toFixed(1)}s / ${(event.sizeBytes / 1048576).toFixed(1)}MB` };
    case "plan":
      return {
        progress: 0,
        total: event.segmentCount,
        message: `plan: mode=${event.mode} segments=${event.segmentCount}${event.fallback ? " (overlap fallback)" : ""}`,
      };
    case "segment-start":
      return {
        progress: event.index,
        total: event.total,
        message: `segment ${event.index + 1}/${event.total} ${event.start.toFixed(1)}-${event.end.toFixed(1)}s`,
      };
    case "segment-done":
      return {
        progress: event.index + 1,
        total: event.total,
        message: `segment ${event.index + 1}/${event.total} done (${event.chars} chars${event.cached ? ", cached" : ""})`,
      };
    case "retry":
      return {
        progress: 0,
        total: total > 0 ? total : undefined,
        message: `retry ${event.attempt} for segment ${event.index + 1} in ${event.delayMs}ms: ${event.reason}`,
      };
    case "done":
      return { progress: total > 0 ? total : 1, total: total > 0 ? total : undefined, message: `done mode=${event.mode}` };
  }
}

function errorResult(error: unknown) {
  return { content: [{ type: "text" as const, text: describeError(error) }], isError: true };
}

function createServer(defaultOutDir: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });

  server.registerTool(
    "transcribe",
    {
      title: "Transcribe audio/video to text",
      description:
        "Transcribe a local audio/video file with silence-aware chunking. Returns the transcript for single/joined runs, or an object describing the output directory for segmented runs.",
      inputSchema: transcribeSchema,
    },
    async (args, extra) => {
      const token = extra._meta?.progressToken;
      let total = 0;
      const onProgress = (event: ProgressEvent) => {
        if (event.type === "plan") total = event.segmentCount;
        if (event.type === "segment-done") total = event.total;
        if (token === undefined) return;
        const update = progressParams(event, total);
        const params: { progressToken: string | number; progress: number; total?: number; message: string } = {
          progressToken: token,
          progress: update.progress,
          message: update.message,
        };
        if (update.total !== undefined) params.total = update.total;
        void extra
          .sendNotification({ method: "notifications/progress", params })
          .catch(() => {});
      };

      try {
        const coreArgs = { ...(args as CoreArgs) };
        if (!coreArgs.outDir || coreArgs.outDir.trim() === "") coreArgs.outDir = defaultOutDir;
        const outcome = await runTranscribe(coreArgs, { onProgress });
        return { content: [{ type: "text" as const, text: JSON.stringify(outcome, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "transcribe_plan",
    {
      title: "Preview a transcription plan",
      description:
        "Return the segmentation plan (duration, mode, segments) for a local file without contacting any transcription API.",
      inputSchema: planSchema,
    },
    async (args) => {
      try {
        const plan = runPlan(args as PlanArgs);
        return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export type ListenArgs = { http: boolean; host: string; port: number; outDir: string };

const MCP_USAGE = "Usage: voxpipe mcp --out-dir <path> [--http] [--host 127.0.0.1] [--port 8765]";

export function parseMcpArgs(argv: string[], defaultPort = 8765): ListenArgs {
  let http = false;
  let host = "127.0.0.1";
  let port = defaultPort;
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--http") http = true;
    else if (arg === "--host") host = argv[++i] ?? host;
    else if (arg.startsWith("--host=")) host = arg.slice("--host=".length);
    else if (arg === "--port") port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) port = Number(arg.slice("--port=".length));
    else if (arg === "--out-dir" || arg === "--out" || arg === "-o") outDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) outDir = arg.slice("--out-dir=".length);
    else if (arg.startsWith("--out=")) outDir = arg.slice("--out=".length);
    else if (arg === "-h" || arg === "--help") {
      process.stdout.write(MCP_USAGE + "\n");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`invalid --port: ${port}`);
  if (!outDir || !outDir.trim()) {
    process.stderr.write(`[voxpipe] mcp requires --out-dir\n${MCP_USAGE}\n`);
    process.exit(2);
  }
  return { http, host, port, outDir };
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

async function runStdio(outDir: string): Promise<void> {
  const server = createServer(outDir);
  await server.connect(new StdioServerTransport());
  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.close().finally(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runHttp(host: string, port: number, outDir: string): Promise<void> {
  const sessions = new Map<string, { transport: WebStandardStreamableHTTPServerTransport; server: McpServer }>();

  const handle = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });

    const sessionId = req.headers.get("mcp-session-id") ?? undefined;
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return jsonRpcError(404, -32001, "Session not found");
      return session.transport.handleRequest(req);
    }

    if (req.method !== "POST") {
      return jsonRpcError(400, -32000, "Bad Request: No valid session ID provided");
    }

    let parsedBody: unknown;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        parsedBody = await req.clone().json();
      } catch {
        return jsonRpcError(400, -32700, "Parse error: Invalid JSON");
      }
    }
    if (!isInitializeRequest(parsedBody)) {
      return jsonRpcError(400, -32000, "Bad Request: No valid session ID provided");
    }

    const server = createServer(outDir);
    let transport: WebStandardStreamableHTTPServerTransport;
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server });
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };
    await server.connect(transport);
    return transport.handleRequest(req, { parsedBody });
  };

  const httpServer = Bun.serve({
    hostname: host,
    port,
    fetch: (req) => handle(req),
  });
  process.stderr.write(`[voxpipe] mcp (streamable http) listening on http://${host}:${httpServer.port}/mcp\n`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      for (const { transport, server } of sessions.values()) {
        void transport.close();
        void server.close();
      }
      sessions.clear();
      void httpServer.stop(true).finally(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function reportError(error: unknown): void {
  process.stderr.write(`[voxpipe] ${describeError(error)}\n`);
}

export async function runMcp(argv: string[]): Promise<void> {
  const { http, host, port, outDir } = parseMcpArgs(argv);
  process.on("uncaughtException", reportError);
  process.on("unhandledRejection", reportError);
  if (http) await runHttp(host, port, outDir);
  else await runStdio(outDir);
}
