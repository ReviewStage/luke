/**
 * heard-words.ts -- the words a reader hears of an element: its text but what it hides from them, the words drawn for a reader alone heard apart from those beside them.
 */

/**
 * What a reader hears of `element`: its words but what it hides from them
 * (`aria-hidden`), such as the copy a shimmer's light is drawn with, and the
 * words drawn for a reader alone heard apart from those beside them, as a
 * browser hears a box of their own.
 */
export function heardWords(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  for (const apart of copy.querySelectorAll(".ui-visually-hidden")) {
    apart.before(" ");
    apart.after(" ");
  }
  return (copy.textContent ?? "").replace(/\s+/gu, " ").trim();
}
