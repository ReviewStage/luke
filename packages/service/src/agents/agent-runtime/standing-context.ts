import type { LabeledAgentEdit, StoredTask } from "@repo/database/models/task-store";
import { dateLabel } from "@repo/features/date-mention";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@repo/features/mention-link";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { NOTE_KIND, type DescriptionAgentEdit } from "@repo/features/description-notes";
import { DateTime, Option } from "effect";
import { openThreadsText } from "../../tasks/comment-tools.js";

const TASK_MARKER = "[task]";
const DEVELOPER_TIME_MARKER = "[the developer's time]";
const DOCUMENT_MARKER = "[saved document]";
const AGENT_EDITS_MARKER = "[recent edits by agents]";
const BRIEF_MARKER = "[the developer's brief for the task]";

const RECENT_AGENT_EDITS = 5;

const AGENT_NOTE_CHARS = 300;

function noteWords(words: string): string {
  return JSON.stringify(
    words.length > AGENT_NOTE_CHARS ? `${words.slice(0, AGENT_NOTE_CHARS)}…` : words,
  );
}

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

function briefText(stored: StoredTask): readonly string[] {
  if (stored.brief === undefined) return [];
  return [BRIEF_MARKER, JSON.stringify(stored.brief)];
}

const UTC_ZONE = "UTC";

const TIME_LOCALE = "en-US";

const NO_PLACE: MentionPlace = { workspace: "", repository: null };

export interface TurnClock {
  readonly now: number;
  readonly timeZone: string | undefined;
}

function developerTimeText({ now, timeZone }: TurnClock): string {
  const named =
    timeZone === undefined
      ? Option.none()
      : Option.map(DateTime.makeZoned(now, { timeZone }), (at) => ({ zone: timeZone, at }));
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

export function standingContext(
  stored: StoredTask | undefined,
  clock: TurnClock,
  comments: readonly DescriptionCommentThread[] = [],
  descriptionsOn = true,
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
        ...agentEditsText(stored.agentEdits),
        ...openThreadsText(comments),
      ]
    : [];
  return [heading, `Name: ${task.name}`, ...briefText(stored), ...description].join("\n");
}
