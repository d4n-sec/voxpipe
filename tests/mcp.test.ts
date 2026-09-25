import { expect, test } from "bun:test";
import { parseMcpArgs } from "../src/mcp/server";

test("mcp requires --out-dir and exits 2 without it", () => {
  const original = process.exit;
  let code: number | undefined;
  process.exit = ((value?: number) => {
    code = value;
    throw new Error("exit");
  }) as typeof process.exit;
  try {
    expect(() => parseMcpArgs([])).toThrow("exit");
  } finally {
    process.exit = original;
  }
  expect(code).toBe(2);
});

test("parseMcpArgs accepts --out-dir and aliases", () => {
  expect(parseMcpArgs(["--out-dir", "/tmp/x"]).outDir).toBe("/tmp/x");
  expect(parseMcpArgs(["--out=/tmp/y", "--http"]).outDir).toBe("/tmp/y");
  expect(parseMcpArgs(["-o", "/tmp/z"]).outDir).toBe("/tmp/z");
});
