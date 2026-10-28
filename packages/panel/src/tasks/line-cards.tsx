import { THREAD_LINE_LEAD } from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import {
  EventCard,
  type EventCardNote,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@luke/ui";
import type { GitHubLineMetadata, ThreadLineMetadata } from "@luke/wire";
import type { ReactNode } from "react";
import { githubLineHead } from "./coding-agent-model.js";
import { linkChip, type MentionDoors } from "./mention-chip.js";
import { NO_TASK, useMentionDoors } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * line-cards.tsx -- a line steered into an agent drawn from what its metadata says carried it: a thread's line under its head, and GitHub's word as its card.
 *
 * A member's reply, answer, or close on a thread reaches the agent as their
 * words under a header naming the item by its title and key, which is the
 * agent's; the transcript heads the words instead with what they did and
 * the thread's chip, which opens it. What GitHub said on the agent's pull
 * request reaches the agent as a prompt fenced and closed with what to do
 * about it; the transcript draws it as an `EventCard`: who did what to which
 * pull request, their words as the transcript draws markdown, and each
 * inline comment by the line it is on, with the instructions and the fence
 * left to the agent.
 */

/** A link in a card's words, opened as the window opens links: the chip of what it names where the transcript draws one (`linkChip`) and `doors` are given, else the link. */
function CardLink({
  href,
  label,
  doors,
}: {
  href: string;
  label: string;
  /** The doors a chip opens through; none for a link that stays a link, as a note's place does, whose page is a line of the pull request rather than the pull request. */
  doors?: MentionDoors | undefined;
}): ReactNode {
  const openLink = useOpenLink();
  const chip = doors === undefined ? undefined : linkChip(href, label, doors);
  if (chip !== undefined) return chip;
  return (
    <TextLink
      href={href}
      look={TEXT_LINK_LOOK.UNDERLINED}
      onClick={(event) => {
        event.preventDefault();
        openLink(href);
      }}
    >
      {label}
    </TextLink>
  );
}

/** The link a thread's chip is read from: the item under the task the transcript is drawn on; none off a task's page, where no workspace names it. */
function threadLink(itemId: string, doors: MentionDoors): string | undefined {
  if (doors.taskId === NO_TASK || doors.place.workspace === "") return undefined;
  return linkOf(
    { kind: LINK_PLACE.INBOX_ITEM, planId: doors.taskId, itemId },
    doors.place.workspace,
  );
}

/** A thread's line's head: what the member did on the thread, and the thread's chip, which opens it. */
export function ThreadLineHead({ line }: { line: ThreadLineMetadata }): React.JSX.Element {
  const doors = useMentionDoors();
  const href = threadLink(line.item_id, doors);
  const chip = href === undefined ? undefined : linkChip(href, href, doors);
  return (
    <Text
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      data-thread-line=""
    >
      {THREAD_LINE_LEAD[line.event]}
      {chip === undefined ? null : <> {chip}</>}
    </Text>
  );
}

/** One inline comment as the card's note: its place, linking its page, over its words. */
function commentNote(
  comment: NonNullable<GitHubLineMetadata["comments"]>[number],
  at: number,
): EventCardNote {
  const where = comment.line === undefined ? comment.path : `${comment.path}:${comment.line}`;
  return {
    key: String(at),
    where: <CardLink href={comment.url} label={where} />,
    body: comment.body === "" ? null : <TranscriptWords text={comment.body} />,
  };
}

/** What GitHub said on the agent's pull request, as its card: the head, the words, and the inline comments. */
export function GitHubLineCard({ line }: { line: GitHubLineMetadata }): React.JSX.Element {
  const doors = useMentionDoors();
  const words = line.words ?? "";
  const head = githubLineHead(line);
  return (
    <EventCard
      data-github-line={line.event}
      head={
        <>
          {head.event} <CardLink href={line.url} label={head.target} doors={doors} />
        </>
      }
      notes={(line.comments ?? []).map(commentNote)}
    >
      {words === "" ? null : <TranscriptWords text={words} />}
    </EventCard>
  );
}
