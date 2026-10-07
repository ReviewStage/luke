import { focusSeek } from "./focus-seek";
import { matchRanges } from "./session-model";

/**
 * search-field.tsx -- the settings search's caret seek and the marks on the words a query found.
 */

/**
 * Puts the caret in a search field, waiting out its arrival on the way: the
 * field mounts on the same press that summons it, so it may not be drawn yet.
 * What is already typed is selected rather than kept, so a repeated summons
 * types the next query over the last one instead of appending to it.
 */
export function focusSearchField(fieldId: string): () => void {
  return focusSeek({
    find: () => document.getElementById(fieldId),
    act: (element) => {
      element.focus({ preventScroll: true });
      if (element instanceof HTMLInputElement) element.select();
    },
  });
}

/**
 * One drawn line with the query's words marked where they landed, so a
 * result says why it matched. A line the words did not land on is returned as
 * it was.
 */
export function Highlighted({
  text,
  tokens,
}: {
  text: string;
  tokens?: readonly string[] | undefined;
}): React.JSX.Element {
  if (!tokens || tokens.length === 0) return <>{text}</>;
  const ranges = matchRanges(text, tokens);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const range of ranges) {
    if (range.start > from) parts.push(text.slice(from, range.start));
    parts.push(
      <mark className="search-match" key={range.start}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    from = range.end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
