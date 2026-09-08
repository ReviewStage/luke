export function labelOf(row: { readonly title: string | undefined }): string {
  return row.title ?? "Untitled";
}
