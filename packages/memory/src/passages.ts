import { createHash } from "node:crypto";
import { ESTIMATED_CHARS_PER_TOKEN } from "./defaults.js";

/**
 * How a notebook file becomes the passages a search ranks, ported from
 * OpenClaw `b7528507` (`chunkMarkdown` in `packages/memory-host-sdk`): a
 * passage is whole lines up to the token budget read as four characters a
 * token, the tail of one passage carried into the next as overlap, and a
 * line wider than a passage cut into pieces that each keep the line's number.
 * Line numbers are one-based and inclusive, as a citation reads them, and
 * the hash is of the passage's words alone, so the same words in two files
 * or two versions of one file are one hash and one cached embedding.
 */

export interface MemoryPassage {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /** SHA-256 of the text, the key an embedding of it is cached under. */
  readonly hash: string;
}

export interface PassageBounds {
  readonly tokens: number;
  readonly overlapTokens: number;
}

/** The passage size the pinned source cuts at: 400 tokens with 80 carried over. */
export const PASSAGE_BOUNDS: PassageBounds = {
  tokens: 400,
  overlapTokens: 80,
};

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Segment {
  line: string;
  lineNo: number;
}

export function cutPassages(
  content: string,
  bounds: PassageBounds = PASSAGE_BOUNDS,
): readonly MemoryPassage[] {
  const lines = content.split("\n");
  const maxChars = Math.max(32, bounds.tokens * ESTIMATED_CHARS_PER_TOKEN);
  const overlapChars = Math.max(0, bounds.overlapTokens * ESTIMATED_CHARS_PER_TOKEN);
  const passages: MemoryPassage[] = [];
  let current: Segment[] = [];
  let currentChars = 0;

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    const text = current.map((segment) => segment.line).join("\n");
    if (text.trim().length === 0) return;
    passages.push({ startLine: first.lineNo, endLine: last.lineNo, text, hash: hashText(text) });
  };

  const carryOverlap = (window: number) => {
    if (window <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let kept: Segment[] = [];
    let acc = 0;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const segment = current[i];
      if (!segment) continue;
      const size = segment.line.length + 1;
      const remaining = window - acc;
      if (size > remaining) {
        const tail = kept.length === 0 ? segment.line.slice(-Math.max(0, remaining - 1)) : "";
        if (tail.length > 0) {
          kept = [{ line: tail, lineNo: segment.lineNo }, ...kept];
          acc += tail.length + 1;
        }
        break;
      }
      acc += size;
      kept = [segment, ...kept];
      if (acc >= window) break;
    }
    current = kept;
    currentChars = acc;
  };

  const append = (segment: string, lineNo: number) => {
    const size = segment.length + 1;
    if (currentChars + size > maxChars && current.length > 0) {
      flush();
      carryOverlap(Math.min(overlapChars, Math.max(0, maxChars - size)));
    }
    current.push({ line: segment, lineNo });
    currentChars += size;
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.length === 0) {
      append("", lineNo);
      return;
    }
    for (let start = 0; start < line.length; start += maxChars) {
      append(line.slice(start, start + maxChars), lineNo);
    }
  });
  flush();
  return passages;
}
