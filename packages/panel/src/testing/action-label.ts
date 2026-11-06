const TRAILING_ELLIPSIS = /(…|\.\.\.)\s*$/u;

export function ellipsized(labels: Iterable<string | null | undefined>): string[] {
  return [...labels].flatMap((label) =>
    label !== null && label !== undefined && TRAILING_ELLIPSIS.test(label) ? [label] : [],
  );
}
