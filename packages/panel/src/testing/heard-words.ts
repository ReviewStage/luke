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
