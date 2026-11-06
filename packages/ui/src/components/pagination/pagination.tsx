import { pulseOnPress } from "../../press-pulse.js";
import {
  PAGINATION_ITEM,
  PaginationEllipsis,
  Pagination as PaginationRow,
} from "../../shadcn/pagination.js";

const PAGINATION_REACH = 1;

const ELISION_SIDE = {
  BEFORE: "before",
  AFTER: "after",
} as const;

export interface PaginationStep {
  readonly href: string;
  readonly label: string;
  readonly text?: string | undefined;
}

export interface PaginationPages {
  readonly current: number;
  readonly count: number;
  readonly href: (page: number) => string;
}

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
      <span className={PAGINATION_ITEM} data-idle="true" aria-hidden="true">
        {arrow}
      </span>
    );
  }
  let words = arrow;
  if (step.text !== undefined)
    words = rel === "prev" ? `${arrow} ${step.text}` : `${step.text} ${arrow}`;
  return (
    <a
      className={PAGINATION_ITEM}
      href={step.href}
      rel={rel}
      aria-label={step.label}
      onClick={pulseOnPress()}
    >
      {words}
    </a>
  );
}

export function Pagination({
  label,
  previous,
  next,
  pages,
}: {
  label: string;
  previous: PaginationStep | undefined;
  next: PaginationStep | undefined;
  pages?: PaginationPages | undefined;
}): React.JSX.Element | null {
  if (pages !== undefined && pages.count < 2) return null;
  return (
    <PaginationRow aria-label={label} data-numbered={pages ? "true" : undefined}>
      <Step step={previous} rel="prev" />
      {pages
        ? pageNumbers(pages.current, pages.count).map((number, index, numbers) => {
            if (number === undefined) {
              const side =
                (numbers[index + 1] ?? 0) <= pages.current
                  ? ELISION_SIDE.BEFORE
                  : ELISION_SIDE.AFTER;
              return <PaginationEllipsis key={side}>…</PaginationEllipsis>;
            }
            if (number === pages.current) {
              return (
                <span key={number} className={PAGINATION_ITEM} aria-current="page">
                  {number}
                </span>
              );
            }
            return (
              <a
                key={number}
                className={PAGINATION_ITEM}
                href={pages.href(number)}
                onClick={pulseOnPress()}
              >
                {number}
              </a>
            );
          })
        : null}
      <Step step={next} rel="next" />
    </PaginationRow>
  );
}
