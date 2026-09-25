export type Target = {
  target: string;
  os: string;
  arch: string;
  ext: string;
  key: string;
};

export const TARGETS: Target[] = [
  { target: "bun-darwin-arm64", os: "darwin", arch: "arm64", ext: "", key: "darwin-arm64" },
  { target: "bun-darwin-x64", os: "darwin", arch: "x64", ext: "", key: "darwin-x64" },
  { target: "bun-linux-x64", os: "linux", arch: "x64", ext: "", key: "linux-x64" },
  { target: "bun-linux-arm64", os: "linux", arch: "arm64", ext: "", key: "linux-arm64" },
  { target: "bun-windows-x64", os: "windows", arch: "x64", ext: ".exe", key: "win32-x64" },
];

export function selectTargets(filter?: string): Target[] {
  if (!filter) return TARGETS;
  return TARGETS.filter(
    (t) => t.target.includes(filter) || t.key === filter || `${t.os}-${t.arch}` === filter,
  );
}
