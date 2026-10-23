import type { GitHubPerson } from "@luke/features/coding-agent-wire";
import { HoverCard, HoverCardHead, HoverCardNote } from "@luke/ui";
import type { ReactNode } from "react";
import { OpenedNote } from "./pull-request-card-notes.js";

/**
 * issue-card.tsx -- an issue's card where a chip names it outside words: its mark, its title, its key and where it stands, and who opened it.
 *
 * A chip of an issue in a line of words hangs this card (`mention-chip.tsx`),
 * and so do the chips that list one, a task's linked issues and New task's,
 * so an issue reads alike wherever the pointer rests on it. The key says
 * the repository where GitHub holds the issue, since a chip names the
 * issue by its number alone; the note after it is the place's own, what the
 * issue's link does there.
 */

/** An issue's card: its title under its mark, `heading` (its key and where it stands), who opened it, and the place's own `note`. */
export function IssueCard({
  mark,
  title,
  heading,
  opener,
  note,
}: {
  mark: ReactNode;
  title: string;
  /** The issue's key and, where its provider answered, where it stands: `acme/relay#42 · Open`. */
  heading: string;
  /** Who opened a GitHub issue; none for a Linear issue or where GitHub named no one. */
  opener?: GitHubPerson | undefined;
  note?: string | undefined;
}): React.JSX.Element {
  return (
    <HoverCard data-issue-card="">
      <HoverCardHead glyph={mark} name={title} />
      <HoverCardNote>{heading}</HoverCardNote>
      <OpenedNote opener={opener} />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
    </HoverCard>
  );
}
