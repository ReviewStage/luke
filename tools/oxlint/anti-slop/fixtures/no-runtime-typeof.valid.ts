export function labelOf(row: { readonly title: string | undefined }): string {
  return row.title ?? "Untitled";
}

/** `typeof` is the one operator banned here; its neighbours are ordinary code. */
export function discard(row: { readonly title: string | undefined }): boolean {
  void row;
  return !row.title;
}
