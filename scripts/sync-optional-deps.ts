#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Pkg = { version?: string; optionalDependencies?: Record<string, string> };

const path = join(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(path, "utf8")) as Pkg;
const version = pkg.version;
if (!version) {
  process.stderr.write("[sync] package.json has no version\n");
  process.exit(1);
}

const deps = pkg.optionalDependencies;
if (!deps || Object.keys(deps).length === 0) {
  process.stderr.write("[sync] package.json has no optionalDependencies to sync\n");
  process.exit(1);
}

let changed = 0;
for (const key of Object.keys(deps)) {
  if (!key.startsWith("@d4n-sec/voxpipe-")) continue;
  if (deps[key] !== version) {
    deps[key] = version;
    changed++;
  }
}
if (changed === 0) {
  process.stdout.write(`[sync] optionalDependencies already at ${version}\n`);
} else {
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  process.stdout.write(`[sync] optionalDependencies -> ${version} (${changed} updated)\n`);
}
