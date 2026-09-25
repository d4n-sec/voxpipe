import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { loadCredentials } from "./auth";
import { createBackend } from "./backends";
import { loadConfig, type VoxpipeConfig } from "./config";
import { previewInput, transcribe } from "./transcribe";
import type { Progress, SegmentOptions } from "./types";

type CliOptions = VoxpipeConfig & {
  inputs: string[];
  out?: string;
  promptFile?: string;
  json: boolean;
  keep: boolean;
  keepState: boolean;
  dryRun: boolean;
  configPath?: string;
};

function usage(code = 0): never {
  const text = `voxpipe - transcribe audio/video with the ChatGPT (Codex) backend

Usage:
  voxpipe <input> [input2 ...] [options]
  voxpipe mcp | serve
  voxpipe clean [--dir <path>]

Options:
  -o, --out <path>            Output file, or directory when segmented
  -l, --language <code>       Language hint, e.g. zh, en, ja (optional)
  -p, --prompt <text>         Prompt hint (optional)
      --prompt-file <path>    Read custom vocabulary (one term per line)
  -m, --model <name>          Model name, default gpt-4o-transcribe
      --backend <name>        chatgpt (default) or command
      --command <cmd>         Command backend; placeholders {file} {language} {model}
      --chunk-seconds <n>     Target chunk length, default 240
      --max-seconds <n>       Hard chunk ceiling, default 600
      --overlap-seconds <n>   Overlap when cutting blind, default 20
      --silence-db <n>        Silence threshold in dB, default -35
      --silence-dur <n>       Min silence seconds, default 0.35
      --retry <n>             Total attempts, 1-3 (1 = no retry), default 1
      --json                  Newline-delimited JSON events on stdout
      --dry-run               Print the segmentation plan without calling the API
      --keep                  Keep intermediate audio files
      --keep-state            Keep resume state after a successful run
      --config <path>         Config file (default ~/.config/voxpipe/config.toml)
  -h, --help                  Show this help

Segmentation:
  Cuts prefer a silence nearest the target length; a chunk never exceeds the
  hard ceiling. When no silence is available, it slices blind with an overlap
  and writes one file per segment into an output directory (nothing is lost).

Auth:
  Uses an existing ChatGPT/Codex login. Read-only: never refreshes, never writes.
  Override without touching files via CODEX_STT_TOKEN / CODEX_STT_ACCOUNT_ID.

Requires: ffmpeg, ffprobe, bun`;
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}

function extractConfigPath(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") return argv[i + 1];
    if (argv[i].startsWith("--config=")) return argv[i].slice("--config=".length);
  }
  return undefined;
}

function parseArgs(argv: string[], base: VoxpipeConfig): CliOptions {
  const opts: CliOptions = {
    ...base,
    inputs: [],
    json: false,
    keep: false,
    keepState: false,
    dryRun: false,
  };
  const numeric = (raw: string, min: number, max: number): number => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) usage(2);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) usage(2);
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        usage(0);
        break;
      case "-o":
      case "--out":
        opts.out = next();
        break;
      case "-l":
      case "--language":
        opts.language = next();
        break;
      case "-p":
      case "--prompt":
        opts.prompt = next();
        break;
      case "--prompt-file":
        opts.promptFile = next();
        break;
      case "-m":
      case "--model":
        opts.model = next();
        break;
      case "--backend":
        opts.backend = next();
        break;
      case "--command":
        opts.command = next();
        break;
      case "--chunk-seconds":
        opts.targetSeconds = numeric(next(), 1, 3600);
        break;
      case "--max-seconds":
        opts.maxSeconds = numeric(next(), 1, 3600);
        break;
      case "--overlap-seconds":
        opts.overlapSeconds = numeric(next(), 0, 300);
        break;
      case "--silence-db":
        opts.silenceDb = numeric(next(), -120, 0);
        break;
      case "--silence-dur":
        opts.silenceDur = numeric(next(), 0.05, 60);
        break;
      case "--retry":
        opts.retries = numeric(next(), 1, 3);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--keep":
        opts.keep = true;
        break;
      case "--keep-state":
        opts.keepState = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--config":
        opts.configPath = next();
        break;
      default:
        if (arg.startsWith("--config=")) {
          opts.configPath = arg.slice("--config=".length);
          break;
        }
        if (arg.startsWith("-")) usage(2);
        opts.inputs.push(arg);
    }
  }

  if (opts.maxSeconds < opts.targetSeconds) opts.maxSeconds = opts.targetSeconds;
  if (opts.overlapSeconds >= opts.targetSeconds) {
    opts.overlapSeconds = Math.max(1, opts.targetSeconds - 1);
  }
  opts.retries = Math.max(1, Math.min(3, Math.round(opts.retries)));
  return opts;
}

function readPromptFile(path: string): string {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
}

function makeProgress(json: boolean): Progress {
  if (json) {
    return (event) => {
      process.stdout.write(JSON.stringify(event) + "\n");
    };
  }
  return (event) => {
    let line: string;
    switch (event.type) {
      case "probe":
        line = `[voxpipe] duration=${event.duration.toFixed(1)}s size=${(event.sizeBytes / 1048576).toFixed(1)}MB`;
        break;
      case "plan":
        line = `[voxpipe] mode=${event.mode} segments=${event.segmentCount}${event.fallback ? " (overlap fallback)" : ""}`;
        break;
      case "segment-start":
        line = `[voxpipe] segment ${event.index + 1}/${event.total} ${event.start.toFixed(1)}-${event.end.toFixed(1)}s${event.overlapped ? " [overlap]" : ""}`;
        break;
      case "segment-done":
        line = `[voxpipe] segment ${event.index + 1}/${event.total} ${event.chars} chars${event.cached ? " (cached)" : ""}`;
        break;
      case "retry":
        line = `[voxpipe] retry ${event.attempt} for segment ${event.index + 1} in ${event.delayMs}ms: ${event.reason}`;
        break;
      case "done":
        line = `[voxpipe] done mode=${event.mode} chars=${event.chars}${event.outDir ? ` dir=${event.outDir}` : ""}`;
        break;
    }
    process.stderr.write(line + "\n");
  };
}

async function runTranscribe(argv: string[]): Promise<void> {
  if (argv.includes("-h") || argv.includes("--help")) usage(0);

  const config = loadConfig({ path: extractConfigPath(argv), env: process.env });
  const opts = parseArgs(argv, config);
  if (opts.promptFile) opts.prompt = readPromptFile(opts.promptFile);
  if (opts.inputs.length === 0) usage(2);

  const segmentOptions: SegmentOptions = {
    targetSeconds: opts.targetSeconds,
    maxSeconds: opts.maxSeconds,
    overlapSeconds: opts.overlapSeconds,
    minSegmentSeconds: opts.minSegmentSeconds,
    silenceWindowFraction: opts.silenceWindowFraction,
  };
  const progress = makeProgress(opts.json);

  if (opts.dryRun) {
    for (const input of opts.inputs) {
      const preview = previewInput(input, {
        segment: segmentOptions,
        silenceDb: opts.silenceDb,
        silenceDur: opts.silenceDur,
        keep: opts.keep,
      });
      if (opts.json) {
        console.log(JSON.stringify({ type: "preview", ...preview }));
      } else {
        console.log(
          `# ${preview.file}  duration=${preview.duration}s  mode=${preview.mode}  fallback=${preview.fallback}  silences=${preview.silences}`,
        );
        for (const segment of preview.segments) {
          console.log(
            `  ${String(segment.index).padStart(2)}  ${String(segment.start).padStart(8)} -> ${String(segment.end).padStart(8)}  (${segment.duration}s)${segment.overlapped ? "  [overlap]" : ""}`,
          );
        }
      }
    }
    return;
  }

  if (opts.backend === "chatgpt") loadCredentials();

  const backend = createBackend(opts.backend, { command: opts.command });
  const plain: Array<{ input: string; text: string }> = [];

  for (const input of opts.inputs) {
    const stem = basename(input, extname(input));
    const outDir =
      opts.inputs.length > 1
        ? opts.out
          ? join(opts.out, stem)
          : join(process.cwd(), `${stem}.segments`)
        : opts.out ?? join(process.cwd(), `${stem}.segments`);

    const result = await transcribe(input, {
      backend,
      segment: segmentOptions,
      language: opts.language,
      prompt: opts.prompt,
      model: opts.model,
      retries: opts.retries,
      outDir,
      keepState: opts.keepState,
      keep: opts.keep,
      silenceDb: opts.silenceDb,
      silenceDur: opts.silenceDur,
      onProgress: progress,
    });

    if (result.mode === "segmented") {
      if (opts.json) {
        console.log(
          JSON.stringify({
            type: "input",
            input: basename(input),
            mode: result.mode,
            fallback: true,
            outDir: result.outDir ?? outDir,
            segments: result.segments.length,
          }),
        );
      } else {
        console.error(`[voxpipe] no usable silence; wrote ${result.segments.length} segments to ${result.outDir ?? outDir}`);
      }
      continue;
    }

    if (opts.json) {
      console.log(
        JSON.stringify({
          type: "input",
          input: basename(input),
          mode: result.mode,
          fallback: false,
          text: result.text,
        }),
      );
    } else if (opts.inputs.length > 1) {
      console.log(`# ${basename(input)}\n${result.text}\n`);
    } else if (!opts.out) {
      console.log(result.text);
    }
    plain.push({ input, text: result.text });
  }

  if (opts.out && plain.length > 0) {
    if (plain.length === 1) {
      writeFileSync(opts.out, plain[0].text + "\n");
      console.error(`[voxpipe] wrote ${opts.out}`);
    } else {
      mkdirSync(opts.out, { recursive: true });
      for (const item of plain) {
        const target = join(opts.out, `${basename(item.input, extname(item.input))}.txt`);
        writeFileSync(target, item.text + "\n");
        console.error(`[voxpipe] wrote ${target}`);
      }
    }
  }
}

function collectStateDirs(dir: string, depth: number, out: string[]): void {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".voxpipe") {
      out.push(join(dir, entry.name));
      continue;
    }
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    collectStateDirs(join(dir, entry.name), depth + 1, out);
  }
}

function runClean(args: string[]): void {
  let dir = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") usage(0);
    if (arg === "--dir") {
      const value = args[++i];
      if (value === undefined) usage(2);
      dir = resolve(value);
      continue;
    }
    usage(2);
  }
  const removed: string[] = [];
  collectStateDirs(resolve(dir), 0, removed);
  for (const path of removed) rmSync(path, { recursive: true, force: true });
  process.stderr.write(`[voxpipe] removed ${removed.length} state dir(s)\n`);
  for (const path of removed) process.stderr.write(`[voxpipe] removed ${path}\n`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const first = argv[0];
  if (first === "mcp") {
    const { runMcp } = await import("./mcp/server");
    await runMcp(argv.slice(1));
    return;
  }
  if (first === "serve") {
    const { runServe } = await import("./http/server");
    await runServe(argv.slice(1));
    return;
  }
  if (first === "clean") {
    runClean(argv.slice(1));
    return;
  }
  await runTranscribe(argv);
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await main(argv);
  } catch (error) {
    process.stderr.write(`[voxpipe] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
