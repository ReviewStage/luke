export function onFontsSettled(run: () => void): () => void {
  const fonts: FontFaceSet | undefined = globalThis.document?.fonts;
  fonts?.addEventListener("loadingdone", run);
  return () => fonts?.removeEventListener("loadingdone", run);
}
