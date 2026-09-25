#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const SUPPORTED = new Set(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]);

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function resolvePlatformBin(key) {
  const name = `@d4n-sec/voxpipe-${key}`;
  const exe = process.platform === "win32" ? ".exe" : "";
  try {
    return require.resolve(`${name}/bin/voxpipe${exe}`);
  } catch {
    // Fall back to the package's declared `bin` entry.
  }
  try {
    const pkgPath = require.resolve(`${name}/package.json`);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const rel = pkg.bin?.[`voxpipe-${key}`];
    if (typeof rel === "string") {
      const resolved = join(dirname(pkgPath), rel);
      if (existsSync(resolved)) return resolved;
    }
  } catch {
    // Not installed for this platform.
  }
  return undefined;
}

function hasBun() {
  const probe = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forward = (signal) => () => {
    try {
      child.kill(signal);
    } catch {
      // child already gone
    }
  };
  const handlers = signals.map((signal) => [signal, forward(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);

  child.on("error", (error) => {
    process.stderr.write(`[voxpipe] failed to launch ${command}: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    for (const [name, handler] of handlers) process.off(name, handler);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

const key = platformKey();
const binary = SUPPORTED.has(key) ? resolvePlatformBin(key) : undefined;

// Prefer the local Bun runtime (authoritative source, always in sync with the
// installed version). Only fall back to the prebuilt platform binary when Bun
// is not available, so `npx @d4n-sec/voxpipe` still works on machines without it.
if (hasBun()) {
  run("bun", ["run", join(pkgRoot, "bin", "voxpipe.ts"), ...args]);
} else if (binary) {
  run(binary, args);
} else {
  const lines = [
    `[voxpipe] no Bun runtime and no prebuilt binary available for ${key}.`,
    SUPPORTED.has(key)
      ? `  The optional package @d4n-sec/voxpipe-${key} is not installed.`
      : "  This platform has no published prebuilt package.",
    "",
    "Option 1: install Bun and run the TypeScript entry directly:",
    "  npm i -g bun",
    `  bun run ${join(pkgRoot, "bin", "voxpipe.ts")} --help`,
    "",
    "Option 2: reinstall so npm can fetch the optional platform package:",
    "  npm i -g @d4n-sec/voxpipe",
  ];
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(1);
}
