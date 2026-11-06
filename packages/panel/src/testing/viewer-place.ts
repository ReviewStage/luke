export function viewerPlace(root: ParentNode): string | undefined {
  const thumbs = [...root.querySelectorAll('ul[aria-label="Files"] button')];
  const shown = thumbs.findIndex((thumb) => thumb.getAttribute("aria-current") === "true");
  return shown < 0 ? undefined : `${String(shown + 1)} of ${String(thumbs.length)}`;
}
