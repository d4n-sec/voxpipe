import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { mergeOverlapping } from "./segment";
import type { InputResult, SegmentPlan } from "./types";

export function joinTranscripts(parts: string[], language?: string): string {
  const cjk = language != null && /^(zh|ja|ko|yue)/i.test(language);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(cjk ? "" : " ");
}

export function segmentFileName(segment: SegmentPlan): string {
  const start = Math.round(segment.start).toString().padStart(6, "0");
  const end = Math.round(segment.end).toString().padStart(6, "0");
  return `seg_${String(segment.index + 1).padStart(4, "0")}_${start}-${end}.txt`;
}

export function writeSegmentedOutput(
  input: string,
  dir: string,
  result: InputResult,
): { dir: string; merged: boolean } {
  mkdirSync(dir, { recursive: true });
  const manifest: Array<Record<string, unknown>> = [];
  for (const segment of result.segments) {
    const name = segmentFileName(segment);
    writeFileSync(join(dir, name), segment.text.trim() + "\n");
    manifest.push({
      index: segment.index + 1,
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      duration: Number((segment.end - segment.start).toFixed(3)),
      overlapped: segment.overlapped,
      file: name,
    });
  }
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ input: basename(input), segments: manifest }, null, 2) + "\n",
  );

  const merge = mergeOverlapping(result.segments.map((segment) => segment.text));
  if (merge.merged) writeFileSync(join(dir, "merged.txt"), merge.text + "\n");
  return { dir, merged: merge.merged };
}
