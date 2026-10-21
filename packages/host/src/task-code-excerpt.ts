/**
 * task-code-excerpt.ts -- the part of a snippet Luke showed that the Code tab's card draws.
 *
 * Luke names code by place through the brain's `show_code`, and the
 * service reads the lines from the brain session's checkout and sends
 * them whole (`ShownCode`); nothing is read from this Mac's disk. The Code
 * tab's card colours its lines itself, in the diff bundle
 * (`code-snippet.tsx`), so only the part it draws is cut here, as a File
 * tab, a page's source, and a file of a message colour theirs
 * (`@luke/panel`'s `whole-file.tsx`).
 */
import type { ShownCode } from "@luke/features/task-wire";

/**
 * How much of a window the Code tab's card for it draws: the lines pointed
 * at with this many of the file on either side, or, for a file shown from
 * its top, its head. Note that the rest of the window is left here rather
 * than in the window, because the view carrying every code shown on a task
 * is told to the window whole.
 */
const CODE_EXCERPT_LINES = {
  CONTEXT: 3,
  HEAD: 24,
} as const;

/**
 * The part of a window the Code tab's card draws: the lines pointed at and a
 * few either side, or the window's head for a whole file. Note that lines
 * pointed at past the window, as past a file's end, draw the window's head
 * too, because the service answered real lines for them and a card with
 * none would drop them.
 */
export function codeExcerpt(code: ShownCode): ShownCode {
  const { startLine, endLine } = code.ref;
  const head = { ...code, lines: code.lines.slice(0, CODE_EXCERPT_LINES.HEAD) };
  if (startLine === undefined || endLine === undefined) return head;
  const lastLine = code.firstLine + code.lines.length - 1;
  const from = Math.max(code.firstLine, startLine - CODE_EXCERPT_LINES.CONTEXT);
  const to = Math.min(lastLine, endLine + CODE_EXCERPT_LINES.CONTEXT);
  if (from > to) return head;
  return {
    ...code,
    firstLine: from,
    lines: code.lines.slice(from - code.firstLine, to - code.firstLine + 1),
  };
}
