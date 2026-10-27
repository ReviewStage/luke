/**
 * viewer-place.ts -- how far along its files the window's viewer stands (`tasks/attachment-viewer.tsx`), read off its strip of previews as "2 of 3": the shown file's thumb among them all.
 */

/** Where the viewer within `root` stands among its files, as "2 of 3"; none where it walks no files, a file alone drawing no strip. */
export function viewerPlace(root: ParentNode): string | undefined {
  const thumbs = [...root.querySelectorAll('ul[aria-label="Files"] button')];
  const shown = thumbs.findIndex((thumb) => thumb.getAttribute("aria-current") === "true");
  return shown < 0 ? undefined : `${String(shown + 1)} of ${String(thumbs.length)}`;
}
