export interface Row {
  readonly title: string;
  readonly branch?: string;
}

export function row(title: string, branch: string | undefined): Row {
  if (branch === undefined) return { title };
  return { title, branch };
}
