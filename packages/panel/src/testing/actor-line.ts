export function lineWords(line: Element | null | undefined): string | undefined {
  if (line === null || line === undefined) return undefined;
  const copy = line.cloneNode(true);
  if (!(copy instanceof Element)) return undefined;
  for (const mark of copy.querySelectorAll(".actor-mark, .actor-stack")) mark.remove();
  return copy.textContent ?? "";
}
