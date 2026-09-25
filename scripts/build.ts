#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { selectTargets } from "./targets";

const filter = process.argv[2];
const selected = selectTargets(filter);

mkdirSync("dist", { recursive: true });

let failed = 0;
for (const target of selected) {
  const outfile = `dist/voxpipe-${target.os}-${target.arch}${target.ext}`;
  process.stdout.write(`[build] ${target.target} -> ${outfile}\n`);
  const result = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=${target.target}`, "bin/voxpipe.ts", `--outfile=${outfile}`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) {
    failed++;
    process.stderr.write(`[build] FAILED: ${target.target} (exit ${result.exitCode})\n`);
  } else {
    process.stdout.write(`[build] ok: ${outfile}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`[build] ${failed} target(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`[build] built ${selected.length} target(s)\n`);
