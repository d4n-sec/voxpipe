import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, loadConfig, parseToml } from "../src/config";

test("parses flat TOML key/value pairs", () => {
  const text = [
    "# voxpipe config",
    'language = "zh"',
    'model = "gpt-4o-transcribe"',
    "target_seconds = 240",
    "overlap_seconds = 20.5",
    "silence_db = -35",
    "silence_dur = 0.35",
    'backend = "chatgpt"',
    "keep = true",
    'term = "a # not a comment"',
    "",
  ].join("\n");

  const parsed = parseToml(text);
  expect(parsed.language).toBe("zh");
  expect(parsed.model).toBe("gpt-4o-transcribe");
  expect(parsed.target_seconds).toBe(240);
  expect(parsed.overlap_seconds).toBe(20.5);
  expect(parsed.silence_db).toBe(-35);
  expect(parsed.silence_dur).toBe(0.35);
  expect(parsed.backend).toBe("chatgpt");
  expect(parsed.keep).toBe(true);
  expect(parsed.term).toBe("a # not a comment");
});

test("precedence: CLI > env > file > defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "voxpipe-config-"));
  const path = join(dir, "config.toml");
  try {
    writeFileSync(
      path,
      ['language = "ja"', "target_seconds = 300", "retries = 2", 'backend = "command"', ""].join("\n"),
    );

    const config = loadConfig({
      path,
      env: { VOXPIPE_TARGET_SECONDS: "400", VOXPIPE_LANGUAGE: "ko" },
      cli: { targetSeconds: 500 },
    });

    expect(config.targetSeconds).toBe(500);
    expect(config.language).toBe("ko");
    expect(config.retries).toBe(2);
    expect(config.backend).toBe("command");
    expect(config.maxSeconds).toBe(600);
    expect(config.overlapSeconds).toBe(20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falls back to defaults when no file or env is present", () => {
  const config = loadConfig({ path: "/nonexistent/voxpipe/config.toml", env: {} });
  expect(config).toEqual(defaultConfig());
});

test("chunking defaults to auto and follows CLI > env > file", () => {
  expect(defaultConfig().chunking).toBe("auto");

  const dir = mkdtempSync(join(tmpdir(), "voxpipe-config-"));
  const path = join(dir, "config.toml");
  try {
    writeFileSync(path, ['chunking = "silence"', ""].join("\n"));
    expect(loadConfig({ path, env: {} }).chunking).toBe("silence");
    expect(loadConfig({ path, env: { VOXPIPE_CHUNKING: "none" } }).chunking).toBe("none");
    expect(
      loadConfig({ path, env: { VOXPIPE_CHUNKING: "none" }, cli: { chunking: "silence" } }).chunking,
    ).toBe("silence");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
