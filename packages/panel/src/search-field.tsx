import { SearchMatch } from "@repo/ui";
import { type MatchRange, matchRanges } from "@repo/ui/search-tokens";
import { focusSeek } from "./focus-seek.js";

export function focusSearchField(
  fieldId: string,
  ready?: (field: HTMLElement) => boolean,
): () => void {
  return focusSeek({
    find: () => document.getElementById(fieldId),
    ...(ready === undefined ? undefined : { ready }),
    act: (element) => {
      element.focus({ preventScroll: true });
      if (element instanceof HTMLInputElement) element.select();
    },
  });
}

export function Highlighted({
  text,
  tokens,
  ranges: given,
}: {
  text: string;
  tokens?: readonly string[] | undefined;
  ranges?: readonly MatchRange[] | undefined;
}): React.JSX.Element {
  const ranges = given ?? (tokens === undefined ? [] : matchRanges(text, tokens));
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) parts.push(text.slice(from, range.start));
    parts.push(<SearchMatch key={range.start}>{text.slice(range.start, range.end)}</SearchMatch>);
    from = range.end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
