export function fenceable(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function fencedWithin(text: string, room: number, cutMark: string): string {
  const fenced = fenceable(text);
  if (fenced.length <= room) return fenced;
  const budget = Math.max(0, room - cutMark.length);
  let kept = "";
  for (const character of text) {
    const spelled = fenceable(character);
    if (kept.length + spelled.length > budget) break;
    kept += spelled;
  }
  return `${kept}${cutMark}`;
}
