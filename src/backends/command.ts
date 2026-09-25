import { BackendError } from "../errors";
import type { Backend, BackendRequest } from "./types";

export function splitCommand(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        tokens.push(current);
        current = "";
        has = false;
      }
      continue;
    }
    current += ch;
    has = true;
  }
  if (quote) throw new Error("Unterminated quote in --command");
  if (has) tokens.push(current);
  return tokens;
}

export function createCommandBackend(command: string): Backend {
  if (!command.trim()) throw new Error("backend `command` requires --command <cmd>");
  return {
    name: "command",
    // A local tool has no known limit, so hand it the whole file by default.
    // Users can still force chunking with --chunking silence.
    chunking: "none",
    async transcribe(req: BackendRequest): Promise<string> {
      const argv = splitCommand(command).map((token) =>
        token
          .replaceAll("{file}", req.file)
          .replaceAll("{language}", req.language ?? "")
          .replaceAll("{model}", req.model ?? ""),
      );
      if (argv.length === 0) throw new BackendError("command backend has an empty command", { retryable: false });

      const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        const detail = stderr.trim();
        throw new BackendError(`command failed (exit ${exitCode})${detail ? `: ${detail}` : ""}`, { retryable: false });
      }
      return stdout.trim();
    },
  };
}
