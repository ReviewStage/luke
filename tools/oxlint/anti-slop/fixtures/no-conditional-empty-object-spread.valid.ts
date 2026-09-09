export interface Row {
  readonly title: string;
  readonly branch?: string;
}

export function row(title: string, branch: string | undefined): Row {
  if (branch === undefined) return { title };
  return { title, branch };
}

/** A conditional spread of two real objects omits nothing and stays readable. */
export function labelled(title: string, detached: boolean): Row {
  return { ...(detached ? { title, branch: "HEAD" } : { title }) };
}
