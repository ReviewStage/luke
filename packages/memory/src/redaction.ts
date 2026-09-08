/**
 * What is taken out of a line before it may be learned from. Two things
 * never enter the candidate store: a block the runtime marked as recalled
 * context, because a snippet recalled from memory must not be learned again
 * as new memory and so reinforce itself; and material that reads like a
 * secret or a personal identifier, redacted to a fixed token before the
 * words are staged. The redaction is a scrub, not a classifier: a line it
 * empties is dropped rather than staged as nothing.
 */

/** The marker the brain puts in front of a recall's summary; the same words the redaction looks for. */
export const RECALLED_CONTEXT_MARKER = "[recalled memory]";

const RECALLED_MARKERS: readonly string[] = [RECALLED_CONTEXT_MARKER, "[recall question]"];

/**
 * Drops every recalled-context block: from a line that starts with one of
 * the markers through the next empty line, or the end of the text.
 */
export function stripRecalledContext(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!skipping && RECALLED_MARKERS.some((marker) => trimmed.startsWith(marker))) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (trimmed.length === 0) skipping = false;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export const REDACTED_TOKEN = "[redacted]";

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}=*/giu,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/giu,
  /\b(?:\d[ -]?){13,19}\b/gu,
  /\+?\b\d{1,3}[ .-]?\(?\d{2,4}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}\b/gu,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gu,
];

export interface RedactionResult {
  readonly text: string;
  readonly redactions: number;
}

/** Replaces every sensitive match with the fixed token and counts the replacements. */
export function redactSensitiveText(text: string): RedactionResult {
  let redactions = 0;
  let scrubbed = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, () => {
      redactions += 1;
      return REDACTED_TOKEN;
    });
  }
  return { text: scrubbed, redactions };
}

/** Both scrubs in order, answering nothing when no words survive them. */
export function prepareForIngestion(text: string): RedactionResult | undefined {
  const stripped = stripRecalledContext(text);
  if (stripped.length === 0) return undefined;
  const redacted = redactSensitiveText(stripped);
  const words = redacted.text.replace(/\s+/g, " ").trim();
  if (words.length === 0 || words === REDACTED_TOKEN) return undefined;
  return { text: words, redactions: redacted.redactions };
}
