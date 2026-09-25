import { test, expect } from "bun:test";
import { mergeOverlapping } from "../src/segment";

test("merges overlapping CJK text with different boundary punctuation", () => {
  const a = "今天天气很好，我们一起去公园散步吧。";
  const b = "我们一起去公园散步吧！然后回家吃饭。";
  const result = mergeOverlapping([a, b]);

  expect(result.merged).toBe(true);
  expect(result.text).toContain("然后回家吃饭。");
  expect(result.text.includes("吧。我们")).toBe(false);

  const occurrences = result.text.split("我们一起去公园散步吧").length - 1;
  expect(occurrences).toBe(1);
});

test("removes duplication at the join without losing content", () => {
  const result = mergeOverlapping(["hello wonderful world", "wonderful world again here"]);
  expect(result.merged).toBe(true);
  expect(result.text).toBe("hello wonderful world again here");
  expect(result.text.split("world").length - 1).toBe(1);
});

test("returns merged=false when a boundary cannot be merged", () => {
  const result = mergeOverlapping(["hello world", "totally unrelated content"]);
  expect(result.merged).toBe(false);
  expect(result.text).toContain("hello world");
  expect(result.text).toContain("totally unrelated content");
});

test("ignores empty parts", () => {
  const result = mergeOverlapping(["first part", "", "second part"]);
  expect(result.text).toContain("first part");
  expect(result.text).toContain("second part");
});

test("returns an empty result for no parts", () => {
  expect(mergeOverlapping([])).toEqual({ text: "", merged: true });
});
