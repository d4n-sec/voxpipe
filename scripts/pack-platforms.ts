#!/usr/bin/env bun
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectTargets, type Target } from "./targets";

type MainPackageJson = {
  version?: string;
  description?: string;
  license?: string;
  repository?: unknown;
};

const root = process.cwd();
const main = (await Bun.file(join(root, "package.json")).json()) as MainPackageJson;
const version = main.version ?? "0.0.0";
const scope = "@d4n-sec";
const outRoot = join(root, "dist", "npm", scope);

const filter = process.argv[2];
const targets = selectTargets(filter);
if (targets.length === 0) {
  process.stderr.write(`[pack] no targets matched ${filter ?? "(all)"}\n`);
  process.exit(1);
}

function platformReadme(key: string): string {
  return [
    `# @d4n-sec/voxpipe-${key}`,
    "",
    `Prebuilt \`voxpipe\` binary for **${key}**.`,
    "",
    "Do not install this package directly. It is pulled in automatically as an",
    "optional dependency of [`@d4n-sec/voxpipe`](https://www.npmjs.com/package/@d4n-sec/voxpipe).",
    "",
  ].join("\n");
}

function build(target: Target): string {
  const outfile = join(root, "dist", `voxpipe-${target.os}-${target.arch}${target.ext}`);
  process.stdout.write(`[pack] building ${target.target} -> ${outfile}\n`);
  const result = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=${target.target}`, join(root, "bin", "voxpipe.ts"), `--outfile=${outfile}`],
    { stdout: "inherit", stderr: "inherit", cwd: root },
  );
  if (result.exitCode !== 0) {
    throw new Error(`build failed for ${target.target} (exit ${result.exitCode})`);
  }
  return outfile;
}

function assemble(target: Target, binary: string): string {
  const dir = join(outRoot, `voxpipe-${target.key}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "bin"), { recursive: true });

  const binFile = `voxpipe${target.ext}`;
  const dest = join(dir, "bin", binFile);
  copyFileSync(binary, dest);
  chmodSync(dest, 0o755);

  const platformPackage = {
    name: `${scope}/voxpipe-${target.key}`,
    version,
    description: `${main.description ?? "voxpipe"} (prebuilt binary for ${target.key})`,
    os: [target.key.split("-")[0]],
    cpu: [target.arch],
    bin: { [`voxpipe-${target.key}`]: `bin/${binFile}` },
    files: ["bin"],
    license: main.license ?? "MIT",
    repository: main.repository,
  };
  writeFileSync(join(dir, "package.json"), JSON.stringify(platformPackage, null, 2) + "\n");
  writeFileSync(join(dir, "README.md"), platformReadme(target.key));
  return dir;
}

let failed = 0;
for (const target of targets) {
  try {
    const binary = build(target);
    const dir = assemble(target, binary);
    process.stdout.write(`[pack] wrote ${dir}\n`);
  } catch (error) {
    failed++;
    process.stderr.write(`[pack] ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`[pack] ${failed} target(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`[pack] packed ${targets.length} platform package(s)\n`);
