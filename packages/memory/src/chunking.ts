import { createHash } from "node:crypto";
import { MEMORY_SEARCH_DEFAULTS } from "./defaults.js";

/**
 * How a Markdown file becomes the chunks the index holds, ported from
 * OpenClaw `b7528507` (`chunkMarkdown` in `packages/memory-host-sdk`): a
 * chunk is whole lines up to the token budget read as four characters a
 * token, the tail of one chunk carried into the next as overlap, and a line
 * wider than a chunk cut into pieces that each keep the line's number. Line
 * numbers are one-based and inclusive, as a citation reads them.
 */

export interface MemoryChunk {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
}

export interface ChunkingOptions {
  readonly tokens: number;
  readonly overlap: number;
}

const DEFAULT_CHUNKING: ChunkingOptions = {
  tokens: MEMORY_SEARCH_DEFAULTS.CHUNK_TOKENS,
  overlap: MEMORY_SEARCH_DEFAULTS.CHUNK_OVERLAP_TOKENS,
};

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface Segment {
  line: string;
  lineNo: number;
}

export function chunkMarkdown(
  content: string,
  chunking: ChunkingOptions = DEFAULT_CHUNKING,
): readonly MemoryChunk[] {
  const lines = content.split("\n");
  const perToken = MEMORY_SEARCH_DEFAULTS.CHARS_PER_TOKEN_ESTIMATE;
  const maxChars = Math.max(32, chunking.tokens * perToken);
  const overlapChars = Math.max(0, chunking.overlap * perToken);
  const chunks: MemoryChunk[] = [];
  let current: Segment[] = [];
  let currentChars = 0;

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    const text = current.map((segment) => segment.line).join("\n");
    chunks.push({ startLine: first.lineNo, endLine: last.lineNo, text, hash: hashText(text) });
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
  return chunks;
}
