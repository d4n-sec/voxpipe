import type { SegmentOptions, SegmentPlan, Silence } from "./types";

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  targetSeconds: 240,
  maxSeconds: 600,
  overlapSeconds: 20,
  minSegmentSeconds: 15,
  silenceWindowFraction: 0.7,
};

export type MergeResult = { text: string; merged: boolean };

export function normalizeForMatch(value: string): string {
  return value.replace(/[\s\p{P}\p{S}]/gu, "");
}

export function normalizedIndexOf(raw: string, count: number): number {
  let seen = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!/[\s\p{P}\p{S}]/u.test(raw[i])) seen++;
    if (seen === count) return i + 1;
  }
  return raw.length;
}

export function overlapCut(aNorm: string, bNorm: string): number {
  const maxStart = Math.min(200, Math.max(0, bNorm.length - 1));
  const maxK = Math.min(400, aNorm.length, bNorm.length);
  let bestK = 0;
  let bestEnd = 0;
  for (let start = 0; start <= maxStart; start++) {
    for (let k = maxK; k >= 8; k--) {
      if (start + k > bNorm.length) continue;
      if (aNorm.endsWith(bNorm.slice(start, start + k))) {
        if (k > bestK) {
          bestK = k;
          bestEnd = start + k;
        }
        break;
      }
    }
  }
  return bestK >= 8 ? bestEnd : 0;
}

export function appendText(left: string, right: string): string {
  const tail = left.slice(-1);
  if (/[。！？，、；：,.!?;:]/.test(tail)) {
    return left + right.replace(/^[。！？，、；：,.!?;:]+/, "");
  }
  return left + right;
}

export function mergeOverlapping(parts: string[]): MergeResult {
  const cleaned = parts.map((part) => (part ?? "").trim());
  if (cleaned.length === 0) return { text: "", merged: true };
  let out = cleaned[0];
  let merged = true;
  for (let i = 1; i < cleaned.length; i++) {
    const next = cleaned[i];
    if (!next) continue;
    const cut = overlapCut(normalizeForMatch(out), normalizeForMatch(next));
    if (cut === 0) {
      out = `${out}\n${next}`;
      merged = false;
      continue;
    }
    out = appendText(out, next.slice(normalizedIndexOf(next, cut)));
  }
  return { text: out, merged };
}

export function tailPrompt(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(-200);
}

export function nearestSilence(silences: Silence[], lo: number, hi: number, prefer: number): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const silence of silences) {
    const mid = (silence.start + silence.end) / 2;
    if (mid < lo || mid > hi) continue;
    const dist = Math.abs(mid - prefer);
    if (dist < bestDist) {
      bestDist = dist;
      best = mid;
    }
  }
  return best;
}

export function planSegments(
  duration: number,
  options: SegmentOptions,
  silences: Silence[] = [],
): { segments: SegmentPlan[]; fallback: boolean } {
  const maxChunk = Math.max(0, options.maxSeconds);
  const target = Math.max(1, Math.min(options.targetSeconds, maxChunk));
  const overlap = Math.max(0, Math.min(options.overlapSeconds, target - 1));
  const minSeg = Math.max(0, options.minSegmentSeconds);
  const window = options.silenceWindowFraction;

  const segments: SegmentPlan[] = [];
  let pos = 0;
  let fallback = false;
  let index = 0;

  while (duration - pos > 0.25) {
    const remaining = duration - pos;
    if (remaining <= maxChunk) {
      if (remaining > target + minSeg) {
        const cut = nearestSilence(silences, pos + target * window, duration - minSeg, pos + target);
        if (cut !== null) {
          segments.push({ index: index++, start: pos, end: cut, overlapped: false });
          pos = cut;
          continue;
        }
      }
      segments.push({ index: index++, start: pos, end: duration, overlapped: false });
      break;
    }

    const cut = nearestSilence(silences, pos + target * window, pos + maxChunk, pos + target);
    if (cut !== null) {
      segments.push({ index: index++, start: pos, end: cut, overlapped: false });
      pos = cut;
      continue;
    }

    fallback = true;
    const end = Math.min(pos + target, duration);
    segments.push({ index: index++, start: pos, end, overlapped: true });
    const next = end - overlap;
    pos = next > pos ? next : end;
  }

  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (last.end - last.start < minSeg) {
      const previous = segments[segments.length - 2];
      previous.end = last.end;
      segments.pop();
    }
  }

  return { segments, fallback };
}
