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
];

const PEM_BEGIN = "-----BEGIN ";
const PEM_END = "-----END ";
/**
 * What follows `-----BEGIN ` or `-----END ` in a private-key armor: an
 * optional bounded label (`RSA `, `EC `, `ENCRYPTED `) or nothing at all,
 * since a generic PKCS#8 header reads `-----BEGIN PRIVATE KEY-----`.
 */
const PEM_HEADER_REST = /^[A-Z ]{0,64}PRIVATE KEY-----/u;

function isPrivateKeyArmor(line: string, armor: string): boolean {
  const at = line.indexOf(armor);
  return at !== -1 && PEM_HEADER_REST.test(line.slice(at + armor.length, at + armor.length + 128));
}

/**
 * Which lines of a text stand inside a private-key block, so a reader that
 * stages or re-reads a file line by line drops every line of a block rather
 * than only the one carrying `BEGIN`. The scan is stateful and linear: a
 * line holding a `BEGIN ... PRIVATE KEY` header opens a block, every line
 * through the matching `END` header is inside it, and a block never closed
 * runs to the end of the text, the same conservative answer the single-text
 * redaction gives. Indices are the caller's own, so the lines outside a
 * block keep their original coordinates.
 */
export function privateKeyLines(lines: readonly string[]): readonly boolean[] {
  const inside: boolean[] = new Array(lines.length).fill(false);
  let open = false;
  lines.forEach((line, index) => {
    if (!open && isPrivateKeyArmor(line, PEM_BEGIN)) open = true;
    if (!open) return;
    inside[index] = true;
    if (isPrivateKeyArmor(line, PEM_END)) open = false;
  });
  return inside;
}

/**
 * Redacts private-key blocks by scanning for their armor rather than
 * matching across their body: from each `BEGIN ... PRIVATE KEY` header to
 * the end of the matching `END` header, or, when no END follows — the block
 * truncated, or a line cut before it — conservatively to the end of the
 * text, so a key body never passes because its closing armor did not.
 */
function redactPrivateKeys(text: string): RedactionResult {
  let redactions = 0;
  let result = "";
  let from = 0;
  for (;;) {
    const begin = text.indexOf(PEM_BEGIN, from);
    if (begin === -1) return { text: result + text.slice(from), redactions };
    const header = PEM_HEADER_REST.exec(text.slice(begin + PEM_BEGIN.length, begin + 128));
    if (!header) {
      result += text.slice(from, begin + PEM_BEGIN.length);
      from = begin + PEM_BEGIN.length;
      continue;
    }
    const bodyFrom = begin + PEM_BEGIN.length + header[0].length;
    let end = text.indexOf(PEM_END, bodyFrom);
    while (end !== -1 && !PEM_HEADER_REST.test(text.slice(end + PEM_END.length, end + 128))) {
      end = text.indexOf(PEM_END, end + PEM_END.length);
    }
    redactions += 1;
    result += `${text.slice(from, begin)}${REDACTED_TOKEN}`;
    if (end === -1) return { text: result, redactions };
    const closing = PEM_HEADER_REST.exec(text.slice(end + PEM_END.length, end + 128));
    from = end + PEM_END.length + (closing?.[0].length ?? 0);
  }
}

export interface RedactionResult {
  readonly text: string;
  readonly redactions: number;
}

/** Replaces every sensitive match with the fixed token and counts the replacements. */
export function redactSensitiveText(text: string): RedactionResult {
  const keys = redactPrivateKeys(text);
  let redactions = keys.redactions;
  let scrubbed = keys.text;
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
