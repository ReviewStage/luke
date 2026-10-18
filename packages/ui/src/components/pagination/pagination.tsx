/**
 * pagination.tsx -- links to the pages beside this one: a step back, a step on, and between them, where the pages are numbered, each page's number with the current one held.
 *
 * Every step is a link to its page's own address, so the browser's own
 * gestures (open in a tab, copy the link) work and a prerendered page pages
 * without script. A step with nowhere to go, at either end, stays drawn as
 * its dimmed arrow so the others do not shift, and is hidden from a reader,
 * for whom it is not there. The current page is no link: it is held,
 * announced as `aria-current="page"`. Past a handful of pages the numbers
 * elide to the first, the last, and the current page's neighbours, so the
 * row stays one short line however many pages there are. Without numbers
 * the two steps stand at either end of the row, each saying where it goes.
 */

/** How many page numbers show on each side of the current one before the rest elide. */
const PAGINATION_REACH = 1;

/** Which side of the current page an elision stands on, its only identity in the row. */
const ELISION_SIDE = {
  BEFORE: "before",
  AFTER: "after",
} as const;

/** One step back or on: where it goes, what it opens for a reader, and words beside its arrow. */
export interface PaginationStep {
  readonly href: string;
  /** What the step opens, since its arrow alone says only which way it points. */
  readonly label: string;
  /** Words drawn beside the arrow ("v1.4"), where the arrow alone would not say where it goes. */
  readonly text?: string | undefined;
}

/** The numbered pages: the one shown, how many there are, and each one's address. */
export interface PaginationPages {
  readonly current: number;
  readonly count: number;
  readonly href: (page: number) => string;
}

/**
 * The page numbers shown around `current`, in order, `undefined` where a run
 * of them elides. A gap of one page shows that page, because "…" would take
 * as much room as the number.
 */
function pageNumbers(current: number, count: number): readonly (number | undefined)[] {
  const shown = new Set([1, count]);
  for (let near = current - PAGINATION_REACH; near <= current + PAGINATION_REACH; near += 1) {
    if (near >= 1 && near <= count) shown.add(near);
  }
  const ordered = [...shown].sort((a, b) => a - b);
  return ordered.flatMap((number, index) => {
    const previous = ordered[index - 1];
    if (previous === undefined || number - previous === 1) return [number];
    return number - previous === 2 ? [previous + 1, number] : [undefined, number];
  });
}

/** A step to `step`'s page, or its arrow alone, dimmed and unread, where there is none. */
function Step({
  step,
  rel,
}: {
  step: PaginationStep | undefined;
  rel: "prev" | "next";
}): React.JSX.Element {
  const arrow = rel === "prev" ? "←" : "→";
  if (step === undefined) {
    return (
      <span className="luke-pagination-item" data-idle="true" aria-hidden="true">
        {arrow}
      </span>
    );
  }
  let words = arrow;
  if (step.text !== undefined)
    words = rel === "prev" ? `${arrow} ${step.text}` : `${step.text} ${arrow}`;
  return (
    <a className="luke-pagination-item" href={step.href} rel={rel} aria-label={step.label}>
      {words}
    </a>
  );
}

/**
 * A navigation named `label`: `previous` and `next` either side of `pages`'
 * numbers where they are given, else at either end. Nothing at all where
 * `pages` counts fewer than two.
 */
export function Pagination({
  label,
  previous,
  next,
  pages,
}: {
  label: string;
  /** The step back, or none at the first page. */
  previous: PaginationStep | undefined;
  /** The step on, or none at the last page. */
  next: PaginationStep | undefined;
  pages?: PaginationPages | undefined;
}): React.JSX.Element | null {
  if (pages !== undefined && pages.count < 2) return null;
  return (
    <nav className="luke-pagination" aria-label={label} data-numbered={pages ? "true" : undefined}>
      <Step step={previous} rel="prev" />
      {pages
        ? pageNumbers(pages.current, pages.count).map((number, index, numbers) => {
            if (number === undefined) {
              const side =
                (numbers[index + 1] ?? 0) <= pages.current
                  ? ELISION_SIDE.BEFORE
                  : ELISION_SIDE.AFTER;
              return (
                <span key={side} className="luke-pagination-item" data-idle="true">
                  …
                </span>
              );
            }
            if (number === pages.current) {
              return (
                <span key={number} className="luke-pagination-item" aria-current="page">
                  {number}
                </span>
              );
            }
            return (
              <a key={number} className="luke-pagination-item" href={pages.href(number)}>
                {number}
              </a>
            );
          })
        : null}
      <Step step={next} rel="next" />
    </nav>
  );
}
