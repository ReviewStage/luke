import { ChevronRightIcon } from "@sidecar/panel";
import type { ReactNode } from "react";

/**
 * sidebar-group-header.tsx -- the header a group of rows folds under, the sidebar's Pinned and Archived and the Inbox's plans alike.
 *
 * It is a row with the plan rows' own hover, in the headings' voice: the
 * group's glyph, which gives way to the fold's chevron while the header is
 * hovered or reached from the keyboard, pointing down while the group is
 * open and right while it is folded, then the group's name. Folded, it
 * counts what the group holds after its name, shown with the chevron and
 * read as "n plans", so a header at rest says nothing but its name. A
 * steady count, the Inbox's of what needs the developer, stands at rest
 * too, as a mail app's folder counts its unread mail, and is left out at
 * none.
 */

/** What a folded group's count is read as, one and many. */
export interface CountNoun {
  readonly one: string;
  readonly many: string;
}

const PLAN_NOUN: CountNoun = { one: "plan", many: "plans" };

/**
 * A folded group's count of what it holds, shown after its name while the
 * header is hovered or reached from the keyboard, or at rest too where it
 * is steady, and read as "n plans".
 */
export function FoldedCount({
  count,
  noun = PLAN_NOUN,
  steady = false,
}: {
  count: number;
  noun?: CountNoun;
  steady?: boolean;
}): React.JSX.Element {
  return (
    <span className="sidebar-repository-count" data-steady={steady ? "true" : undefined}>
      {count}
      <span className="visually-hidden"> {count === 1 ? noun.one : noun.many}</span>
    </span>
  );
}

/** A group's header, its press folding and unfolding the group; `className` names the toggle for a group's own rules. */
export function SidebarGroupHeader({
  glyph,
  name,
  folded,
  count,
  noun = PLAN_NOUN,
  steady = false,
  className,
  onToggle,
}: {
  glyph: ReactNode;
  name: string;
  folded: boolean;
  count: number;
  noun?: CountNoun;
  /** Whether the folded count stands at rest rather than only under the pointer, and is left out at none. */
  steady?: boolean;
  className?: string;
  onToggle: () => void;
}): React.JSX.Element {
  // Note that a steady count says nothing at none, because "0 need you" is no news.
  const counted = folded && !(steady && count === 0);
  return (
    <div className="sidebar-repository-header">
      <button
        type="button"
        className={
          className === undefined
            ? "sidebar-repository-toggle"
            : `sidebar-repository-toggle ${className}`
        }
        aria-expanded={!folded}
        onClick={onToggle}
      >
        <span className="sidebar-repository-glyph">
          {glyph}
          <ChevronRightIcon />
        </span>
        <span className="sidebar-repository-name">{name}</span>
        {counted ? <FoldedCount count={count} noun={noun} steady={steady} /> : null}
      </button>
    </div>
  );
}
