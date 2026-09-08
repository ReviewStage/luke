export function labelOf(row: { readonly title: string | undefined }): string {
  return typeof row.title === "string" ? row.title : "Untitled";
}
