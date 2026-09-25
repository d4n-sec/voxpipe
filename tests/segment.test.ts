import { test, expect } from "bun:test";
import { DEFAULT_SEGMENT_OPTIONS, planSegments } from "../src/segment";
import type { Silence } from "../src/types";

const OPTIONS = { ...DEFAULT_SEGMENT_OPTIONS };

test("cuts at the silence nearest the target", () => {
  const silences: Silence[] = [
    { start: 295, end: 305 },
    { start: 595, end: 605 },
    { start: 895, end: 905 },
  ];
  const { segments, fallback } = planSegments(1000, OPTIONS, silences);

  expect(fallback).toBe(false);
  expect(segments.map((s) => [s.start, s.end])).toEqual([
    [0, 300],
    [300, 600],
    [600, 900],
    [900, 1000],
  ]);
  expect(segments.every((s) => s.overlapped)).toBe(false);
});

test("falls back to overlapped blind cuts and never exceeds max", () => {
  const { segments, fallback } = planSegments(1000, OPTIONS, []);

  expect(fallback).toBe(true);
  expect(segments).toHaveLength(3);
  expect(segments[0]).toMatchObject({ start: 0, end: 240, overlapped: true });
  expect(segments[1]).toMatchObject({ start: 220, end: 460, overlapped: true });
  expect(segments[2]).toMatchObject({ start: 440, end: 1000, overlapped: false });
  for (let i = 0; i < segments.length - 1; i++) {
    expect(segments[i].end - segments[i].start).toBeLessThanOrEqual(OPTIONS.maxSeconds);
  }
});

test("takes the remaining tail as the final non-overlapped segment", () => {
  const { segments, fallback } = planSegments(620, OPTIONS, [{ start: 295, end: 305 }]);

  expect(fallback).toBe(false);
  expect(segments).toHaveLength(2);
  expect(segments[0]).toMatchObject({ start: 0, end: 300, overlapped: false });
  expect(segments[1]).toMatchObject({ start: 300, end: 620, overlapped: false });
});

test("merges a tiny final segment into the previous one", () => {
  const options = { ...OPTIONS, targetSeconds: 240, maxSeconds: 240, overlapSeconds: 10 };
  const { segments } = planSegments(244, options, []);

  expect(segments).toHaveLength(1);
  expect(segments[0]).toMatchObject({ start: 0, end: 244, overlapped: true });
});

test("last chunk is not overlapped even after fallback cuts", () => {
  const { segments } = planSegments(1300, OPTIONS, []);
  expect(segments[segments.length - 1].overlapped).toBe(false);
});

test("handles zero duration", () => {
  const { segments, fallback } = planSegments(0, OPTIONS, [{ start: 0, end: 0 }]);
  expect(segments).toEqual([]);
  expect(fallback).toBe(false);
});

test("fallback is true if any segment is overlapped", () => {
  const { segments, fallback } = planSegments(1000, OPTIONS, []);
  expect(segments.some((s) => s.overlapped)).toBe(true);
  expect(fallback).toBe(true);
});
