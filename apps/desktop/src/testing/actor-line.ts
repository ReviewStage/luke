/**
 * actor-line.ts -- the words a line naming an actor says, as a reader reads them, each actor's mark left out.
 *
 * A mark holds a person's letter, which is no word of the line, so a test
 * reading a line's words reads them past it.
 */

/** The words of `line`, every actor's mark and facepile left out; none where no line stands. */
export function lineWords(line: Element | null | undefined): string | undefined {
  if (line === null || line === undefined) return undefined;
  const copy = line.cloneNode(true);
  if (!(copy instanceof Element)) return undefined;
  for (const mark of copy.querySelectorAll(".actor-mark, .actor-stack")) mark.remove();
  return copy.textContent ?? "";
}
