export function touchesStyle(record: MutationRecord): boolean {
  const target = record.target;
  return (
    target instanceof HTMLStyleElement ||
    target.parentNode instanceof HTMLStyleElement ||
    [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof HTMLStyleElement)
  );
}

export function styleElementSheets(root: ParentNode): () => CSSStyleSheet[] {
  const sheets = new Map<HTMLStyleElement, { sheet: CSSStyleSheet; text: string }>();
  return () => {
    const standing = new Set(root.querySelectorAll("style"));
    for (const style of sheets.keys()) if (!standing.has(style)) sheets.delete(style);
    for (const style of standing) {
      const text = style.textContent ?? "";
      const held = sheets.get(style);
      if (held?.text === text) continue;
      const sheet = held?.sheet ?? new CSSStyleSheet();
      sheet.replaceSync(text);
      sheets.set(style, { sheet, text });
    }
    return [...sheets.values()].map((held) => held.sheet);
  };
}
