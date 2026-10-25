/**
 * standing-context.ts -- the task as it stands, handed to an agent's turn beside its instructions.
 *
 * What the brain is handed every turn and a coding agent on each spoken
 * turn, and on a typed one where its plan changed since its last turn
 * (`../coder-host/turn-context.ts`): the developer's own time, the task's
 * name, brief, and linked issues, its saved document, the agents' recent
 * notes on it, what the chat said, the sections the developer wrote, the
 * open comment threads, and the whiteboard. It is data, read again as each
 * turn opens and remembered by none, so a turn reads what was saved and
 * drawn since the last one rather than a stale copy.
 */

import type { LabelledAgentEdit, StoredTask } from "@luke/database/models/task-store";
import { boardText } from "@luke/features/board-text";
import type { Board } from "@luke/features/board-wire";
import { dateLabel } from "@luke/features/date-mention";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import type { PlanCommentThread } from "@luke/features/plan-comment-wire";
import { NOTE_KIND, type PlanAgentEdit } from "@luke/features/plan-template";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { DateTime, Option } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";

/** The marker the standing context rides behind, so the model reads what follows as the service's data. */
const TASK_MARKER = "[task]";
const DEVELOPER_TIME_MARKER = "[the developer's time]";
const DOCUMENT_MARKER = "[saved document]";
const AGENT_EDITS_MARKER = "[recent edits by coding agents]";
const BRIEF_MARKER = "[the developer's brief for the task]";
const ISSUE_LINKS_MARKER = "[issues the task links]";
/** The marker the sections the developer last wrote ride behind, which the brain is told to keep as written. */
const DEVELOPER_FIELDS_MARKER = "[sections the developer wrote]";

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
function agentNoteLine(note: PlanAgentEdit["notes"][number]): string {
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
function agentEditsText(edits: readonly LabelledAgentEdit[]): readonly string[] {
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

/** The sections the developer wrote last, by heading, each with when; nothing where the developer wrote none. */
function developerFieldsText(stored: StoredTask): readonly string[] {
  const written = stored.sectionWriters.filter((writer) => writer.actor === PLAN_ACTOR.DEVELOPER);
  if (written.length === 0) return [];
  return [
    DEVELOPER_FIELDS_MARKER,
    ...written.map((writer) => `- ${writer.section}, ${new Date(writer.at).toISOString()}`),
  ];
}

/** The developer's own words about the task as they started it, as a JSON string; nothing for a task started with none. */
function briefText(stored: StoredTask): readonly string[] {
  if (stored.brief === undefined) return [];
  return [BRIEF_MARKER, JSON.stringify(stored.brief)];
}

/**
 * The issues the task links, oldest linked first, as JSON: each one's
 * provider, key, title, and page, which keyword its pull requests write,
 * and its description as it read when it was linked; nothing for a task
 * that links none.
 */
function issueLinksText(stored: StoredTask): readonly string[] {
  if (stored.issueLinks.length === 0) return [];
  const links = stored.issueLinks.map(({ provider, key, title, url, relation, description }) => ({
    provider,
    key,
    title,
    url,
    relation,
    description,
  }));
  return [ISSUE_LINKS_MARKER, JSON.stringify(links)];
}

/** The zone a turn reads the day in where the developer's window named none. */
const UTC_ZONE = "UTC";

/** The language the developer's time is said in, as the plan's dates are (`date-mention.ts`). */
const TIME_LOCALE = "en-US";

/** A date names no workspace or repository, so its mention is written under none. */
const NO_PLACE: MentionPlace = { workspace: "", repository: null };

/** When a turn opens, and the zone the developer's window named for it, where it named one. */
export interface TurnClock {
  readonly now: number;
  readonly timeZone: string | undefined;
}

/**
 * The developer's own time as the turn opens: the weekday, the date, and the
 * time in their zone, the zone's name and offset, and the time in UTC beside
 * them, then today as the date mention the plan writes it, so Luke counts
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
 * developer's brief where they wrote one as they started it, the issues it
 * links, the saved document as JSON, the newest saves coding agents made on it (so Luke
 * can raise what an agent asked or decided), the sections
 * the developer last wrote themselves (so Luke treats them as decided), the
 * plan's open comment threads (so Luke can raise what a member asked), and the
 * whiteboard as the model reads it (`board-text.ts`), each read again every
 * turn so what Luke saved and what the developer drew is what the
 * next turn reads. A task that no longer stands gets the heading and the
 * developer's time alone.
 */
export function standingContext(
  stored: StoredTask | undefined,
  board: Board,
  clock: TurnClock,
  comments: readonly PlanCommentThread[] = [],
): string {
  const heading = [
    `${TASK_MARKER} ${new Date(clock.now).toISOString()}`,
    developerTimeText(clock),
  ].join("\n");
  if (!stored) return heading;
  const { task } = stored;
  return [
    heading,
    `Name: ${task.name}`,
    ...briefText(stored),
    ...issueLinksText(stored),
    DOCUMENT_MARKER,
    JSON.stringify(task.document),
    ...agentEditsText(stored.agentEdits),
    ...developerFieldsText(stored),
    ...openThreadsText(comments),
    boardText(board),
  ].join("\n");
}
