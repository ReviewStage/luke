/**
 * standing-context.ts -- the task as it stands, handed to an agent's turn beside its instructions.
 *
 * What a coding agent is handed on a turn where its description changed since its
 * last turn (`../coder-host/turn-context.ts`): the developer's own time, the
 * task's name and brief, and, where its workspace has Task descriptions on, its saved
 * document, the agents' recent notes on it, and the open comment threads. It is data,
 * read again as each turn opens and remembered by none, so a turn reads
 * what was saved since the last one rather than a stale copy.
 */

import type { LabeledAgentEdit, StoredTask } from "@repo/database/models/task-store";
import { dateLabel } from "@repo/features/date-mention";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { type DescriptionAgentEdit, NOTE_KIND } from "@repo/features/description-notes";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@repo/features/mention-link";
import { DateTime, Option } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const TASK_MARKER = "[task]";
const DEVELOPER_TIME_MARKER = "[the developer's time]";
const DOCUMENT_MARKER = "[saved document]";
const AGENT_EDITS_MARKER = "[recent edits by agents]";
const BRIEF_MARKER = "[the developer's brief for the task]";

/** The most agents' saves the model is told of, the newest; the journal keeps more. */
const RECENT_AGENT_EDITS = 5;

/** The most characters of one note's text the model is told; the document itself holds the whole. */
const AGENT_NOTE_CHARS = 300;

/** A note's words, cut where they run past what one line of the history carries. */
function noteWords(words: string): string {
  return JSON.stringify(
    words.length > AGENT_NOTE_CHARS ? `${words.slice(0, AGENT_NOTE_CHARS)}…` : words,
  );
}

/** One note an agent took, in a line: what it did, where, and its words, the text it replaced or deleted among them. */
function agentNoteLine(note: DescriptionAgentEdit["notes"][number]): string {
  switch (note.kind) {
    case NOTE_KIND.ADD:
      return `add under ${noteWords(note.section)}: ${noteWords(note.text)}`;
    case NOTE_KIND.REPLACE:
      return `replace ${noteWords(note.find)} → ${noteWords(note.text)}`;
    case NOTE_KIND.REMOVE:
      return `remove ${noteWords(note.find)}`;
  }
}

/** The newest saves coding agents made, one line each, newest first; nothing where none has. */
function agentEditsText(edits: readonly LabeledAgentEdit[]): readonly string[] {
  if (edits.length === 0) return [];
  const recent = edits.slice(-RECENT_AGENT_EDITS).reverse();
  return [
    AGENT_EDITS_MARKER,
    ...recent.map(
      (edit) =>
        `- ${edit.label}, ${new Date(edit.at).toISOString()}: ${edit.notes.map((note) => agentNoteLine(note)).join("; ")}`,
    ),
  ];
}

/** The developer's own words about the task as they started it, as a JSON string; nothing for a task started with none. */
function briefText(stored: StoredTask): readonly string[] {
  if (stored.brief === undefined) return [];
  return [BRIEF_MARKER, JSON.stringify(stored.brief)];
}

/** The zone a turn reads the day in where the developer's window named none. */
const UTC_ZONE = "UTC";

/** The language the developer's time is said in, as the description's dates are (`date-mention.ts`). */
const TIME_LOCALE = "en-US";

/** A date names no workspace or repository, so its mention is written under none. */
const NO_PLACE: MentionPlace = { workspace: "", repository: null };

/**
 * The one line said of a description last edited before Task descriptions
 * was last turned on for its workspace: work may have gone on without it
 * since, so the agent checks it against the code. It names no experiment,
 * and nothing is said of a description edited since.
 */
function staleText(
  stored: StoredTask,
  descriptionsOnSince: number | undefined,
  timeZone: string | undefined,
): readonly string[] {
  const edited = stored.task.lastEdit?.at;
  if (descriptionsOnSince === undefined || edited === undefined || edited >= descriptionsOnSince) {
    return [];
  }
  return [
    `Last edited ${dayMention(edited, timeZone)}, before the most recent work; check it against the code before relying on it.`,
  ];
}

/** The day an instant falls on in the developer's zone, or UTC where their window named none, as the date mention the description writes it. */
function dayMention(at: number, timeZone: string | undefined): string {
  const zoned = timeZone === undefined ? Option.none() : DateTime.makeZoned(at, { timeZone });
  // Note that UTC is a zone every runtime holds, so the fallback cannot throw.
  const day = DateTime.formatIsoDate(
    Option.getOrElse(zoned, () => DateTime.makeZonedUnsafe(at, { timeZone: UTC_ZONE })),
  );
  return mentionMarkdown(
    { kind: MENTION_KIND.DATE, start: day },
    dateLabel({ start: day }),
    NO_PLACE,
  );
}

/** When a turn opens, and the zone the developer's window named for it, where it named one. */
export interface TurnClock {
  readonly now: number;
  readonly timeZone: string | undefined;
}

/**
 * The developer's own time as the turn opens: the weekday, the date, and the
 * time in their zone, the zone's name and offset, and the time in UTC beside
 * them, then today as the date mention the description writes it, so the agent counts
 * "Friday" from their today rather than UTC's and spells a time at their
 * offset. A turn whose window named no zone, a desktop released before it
 * sent one, reads UTC and says so.
 */
function developerTimeText({ now, timeZone }: TurnClock): string {
  const named =
    timeZone === undefined
      ? Option.none()
      : Option.map(DateTime.makeZoned(now, { timeZone }), (at) => ({ zone: timeZone, at }));
  // Note that UTC is a zone every runtime holds, so the fallback cannot throw.
  const { zone, at } = Option.getOrElse(named, () => ({
    zone: UTC_ZONE,
    at: DateTime.makeZonedUnsafe(now, { timeZone: UTC_ZONE }),
  }));
  const day = new Intl.DateTimeFormat(TIME_LOCALE, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  }).format(now);
  const time = new Intl.DateTimeFormat(TIME_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(now);
  const utc = new Date(now).toISOString().slice(11, 16);
  const offset = DateTime.zonedOffsetIso(at);
  const today = DateTime.formatIsoDate(at);
  const todayMention = mentionMarkdown(
    { kind: MENTION_KIND.DATE, start: today },
    dateLabel({ start: today }),
    NO_PLACE,
  );
  const unknown = Option.isSome(named) ? "" : " Their time zone is unknown, so read it as UTC.";
  return `${DEVELOPER_TIME_MARKER} ${day}, ${time} ${zone} (UTC ${utc}), offset ${offset}. Today is ${todayMention}.${unknown}`;
}

/**
 * What a turn about a task is handed beside its instructions: the
 * developer's own time and today (`developerTimeText`), the plan's name, the
 * developer's brief where they wrote one as they started it, the saved
 * document as JSON, the newest saves coding agents made on it (so the agent can
 * raise what an agent asked or decided), and the description's open comment threads
 * (so the agent can raise what a member asked), each read again
 * every turn so what the agent saved is what the next turn reads. A task that no
 * longer stands gets the heading and the developer's time alone, and one
 * whose agent's workspace has Task descriptions off (`../workspace-experiment-on.ts`) its name and brief
 * without the description, its notes, or threads. A description last edited
 * before Task descriptions was last turned on, at `descriptionsOnSince`, is
 * said to be so in one line (`staleText`).
 */
export function standingContext(
  stored: StoredTask | undefined,
  clock: TurnClock,
  comments: readonly DescriptionCommentThread[] = [],
  descriptionsOn = true,
  descriptionsOnSince: number | undefined = undefined,
): string {
  const heading = [
    `${TASK_MARKER} ${new Date(clock.now).toISOString()}`,
    developerTimeText(clock),
  ].join("\n");
  if (!stored) return heading;
  const { task } = stored;
  const description = descriptionsOn
    ? [
        DOCUMENT_MARKER,
        JSON.stringify(task.document),
        ...staleText(stored, descriptionsOnSince, clock.timeZone),
        ...agentEditsText(stored.agentEdits),
        ...openThreadsText(comments),
      ]
    : [];
  return [heading, `Name: ${task.name}`, ...briefText(stored), ...description].join("\n");
}
