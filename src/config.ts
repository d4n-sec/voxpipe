import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ChunkingConfig = "auto" | "none" | "silence";

export type VoxpipeConfig = {
  language?: string;
  model?: string;
  backend: string;
  command?: string;
  prompt?: string;
  chunking: ChunkingConfig;
  targetSeconds: number;
  maxSeconds: number;
  overlapSeconds: number;
  minSegmentSeconds: number;
  silenceWindowFraction: number;
  silenceDb: number;
  silenceDur: number;
  retries: number;
};

export function defaultConfig(): VoxpipeConfig {
  return {
    backend: "chatgpt",
    chunking: "auto",
    targetSeconds: 240,
    maxSeconds: 600,
    overlapSeconds: 20,
    minSegmentSeconds: 15,
    silenceWindowFraction: 0.7,
    silenceDb: -35,
    silenceDur: 0.35,
    retries: 1,
  };
}

function parseScalar(raw: string): string | number | boolean {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n") : inner;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) return Number.parseFloat(value);
  return value;
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"') i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

export function parseToml(text: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    out[key] = parseScalar(line.slice(eq + 1));
  }
  return out;
}

const FILE_KEYS: Record<string, keyof VoxpipeConfig> = {
  language: "language",
  model: "model",
  backend: "backend",
  command: "command",
  prompt: "prompt",
  chunking: "chunking",
  target_seconds: "targetSeconds",
  max_seconds: "maxSeconds",
  overlap_seconds: "overlapSeconds",
  min_segment_seconds: "minSegmentSeconds",
  silence_window_fraction: "silenceWindowFraction",
  silence_db: "silenceDb",
  silence_dur: "silenceDur",
  retries: "retries",
};

const NUMERIC_KEYS = new Set<keyof VoxpipeConfig>([
  "targetSeconds",
  "maxSeconds",
  "overlapSeconds",
  "minSegmentSeconds",
  "silenceWindowFraction",
  "silenceDb",
  "silenceDur",
  "retries",
]);

function assign(config: VoxpipeConfig, key: keyof VoxpipeConfig, value: unknown): void {
  if (value === undefined || value === null) return;
  if (NUMERIC_KEYS.has(key)) {
    const num = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (Number.isFinite(num)) (config as Record<string, unknown>)[key] = num;
    return;
  }
  (config as Record<string, unknown>)[key] = typeof value === "string" ? value : String(value);
}

const ENV_KEYS: Record<string, keyof VoxpipeConfig> = {
  VOXPIPE_LANGUAGE: "language",
  VOXPIPE_MODEL: "model",
  VOXPIPE_BACKEND: "backend",
  VOXPIPE_COMMAND: "command",
  VOXPIPE_PROMPT: "prompt",
  VOXPIPE_CHUNKING: "chunking",
  VOXPIPE_TARGET_SECONDS: "targetSeconds",
  VOXPIPE_MAX_SECONDS: "maxSeconds",
  VOXPIPE_OVERLAP_SECONDS: "overlapSeconds",
  VOXPIPE_MIN_SEGMENT_SECONDS: "minSegmentSeconds",
  VOXPIPE_SILENCE_WINDOW_FRACTION: "silenceWindowFraction",
  VOXPIPE_SILENCE_DB: "silenceDb",
  VOXPIPE_SILENCE_DUR: "silenceDur",
  VOXPIPE_RETRIES: "retries",
};

export function configPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.VOXPIPE_CONFIG?.trim();
  if (explicit) return explicit;
  const base = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config");
  return join(base, "voxpipe", "config.toml");
}

export function loadConfig(
  options: {
    path?: string;
    env?: Record<string, string | undefined>;
    cli?: Partial<VoxpipeConfig>;
  } = {},
): VoxpipeConfig {
  const env = options.env ?? process.env;
  const config = defaultConfig();

  const path = options.path ?? configPath(env);
  if (existsSync(path)) {
    try {
      const parsed = parseToml(readFileSync(path, "utf8"));
      for (const [rawKey, value] of Object.entries(parsed)) {
        const key = FILE_KEYS[rawKey];
        if (key) assign(config, key, value);
      }
    } catch {
      // A malformed config file is ignored; defaults/environment still apply.
    }
  }

  for (const [envKey, key] of Object.entries(ENV_KEYS)) {
    const value = env[envKey];
    if (value !== undefined && value !== "") assign(config, key, value);
  }

  if (options.cli) {
    for (const [key, value] of Object.entries(options.cli)) {
      if (value !== undefined) assign(config, key as keyof VoxpipeConfig, value);
    }
  }

  return config;
}
