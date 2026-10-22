/**
 * transcript-window.ts -- the newest messages of a coding agent's transcript as Neon Realtime delivers them, one row a message, and each row as the tab draws it.
 *
 * The service's live statement (`transcript-live.ts`'s `window`) answers
 * the newest `TRANSCRIPT_WINDOW` messages by sequence, each row the message
 * as stored and beside it, joined in rather than read after, what the
 * service's page carries for it (`transcript.ts`'s `transcriptMessageOf`):
 * what sent a developer's line and where in a turn under way it arrived,
 * the turn whose work a line said on a call answers, and for a turn's
 * journal when the turn began and what it ran on and spent. The rows are
 * keyed by the message's id, as Neon's guide asks. Its parts are rows of
 * their own (`windowParts`), keyed by the message's id and the part's index,
 * the heavy ones cut as a page asked cut cuts them, so a journal that grows
 * in place moves only the parts it added. A reader draws the messages from
 * both with `windowMessagesOf`, with nothing read again.
 */

import { isRecord, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@luke/wire";
import { Schema } from "effect";
import {
  CODING_AGENT_SENDER,
  type CodingAgentMessage,
  type CodingAgentPartCut,
  type CodingAgentSender,
  MESSAGE_SENDER,
  PART_CUT_FIELD,
  storedObjectSchema,
} from "./coding-agent-wire.js";
import { countedNumber } from "./service-wire.js";
import { turnRecordOf } from "./turn-record.js";

/** How many of the newest messages the live window holds. */
export const TRANSCRIPT_WINDOW = 100;

/** The names a line is sent under where no member's account names it: Luke's, and a member's whose account is gone. */
const SENDER_NAME = {
  LUKE: "Luke",
  FORMER_MEMBER: "Former member",
} as const;

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(countedNumber);

/** One message of the window as Realtime delivers its row, decoded at the boundary before anything reads it. */
export const transcriptWindowRowSchema = Schema.Struct({
  id: Schema.String,
  seq: countedNumber,
  clientId: Schema.String,
  turnId: NullableString,
  role: Schema.Literals(Object.values(MESSAGE_ROLE)),
  /** How many parts the message holds, which `windowParts` carries a row each. */
  partCount: countedNumber,
  metadata: Schema.NullOr(storedObjectSchema),
  placedAt: countedNumber,
  finishedAt: NullableNumber,
  /** What sent a developer's line (`MESSAGE_SENDER`), and the names the row kept of it. */
  sender: NullableString,
  senderName: NullableString,
  senderModel: NullableString,
  /** The member who sent the line, while their account stands. */
  memberId: NullableString,
  memberName: NullableString,
  /** The coding agent that sent the line, while it stands. */
  agentId: NullableString,
  agentTaskId: NullableString,
  /** Where a line a turn under way took in arrived: that turn's journal and the steps begun before it. */
  journalId: NullableString,
  afterStep: NullableNumber,
  /** The turn the ask a line said on a call followed ran in, and the steps begun before the ask joined it. */
  askTurnId: NullableString,
  askAfterStep: NullableNumber,
  /** The turn the row was written in: when it began as a working line counts it, and what it ran on and spent. */
  turnStartedAt: NullableNumber,
  turnStatus: NullableString,
  turnModel: NullableString,
  turnEffort: NullableString,
  turnUsage: Schema.NullOr(Schema.Unknown),
  turnFailure: NullableString,
  turnFastRefused: Schema.NullOr(Schema.Boolean),
});

export type TranscriptWindowRow = typeof transcriptWindowRowSchema.Type;

/**
 * One part of a window's message as Realtime delivers its row, keyed by the
 * message's id and the part's index: the part, and where a page asked cut
 * would cut it, which field it leaves out, that field's size in bytes, and
 * its two ends (`cutParts`).
 */
export const transcriptWindowPartRowSchema = Schema.Struct({
  messageId: Schema.String,
  index: countedNumber,
  part: storedObjectSchema,
  cutField: Schema.NullOr(Schema.Literals(Object.values(PART_CUT_FIELD))),
  bytes: NullableNumber,
  head: NullableString,
  tail: NullableString,
});

export type TranscriptWindowPartRow = typeof transcriptWindowPartRowSchema.Type;

/** What sent a line, as the page names it; none where the row kept no sender, or one it names nothing of. */
function senderOf(row: TranscriptWindowRow): CodingAgentSender | undefined {
  switch (row.sender) {
    case MESSAGE_SENDER.MEMBER:
      return row.memberId === null || row.memberName === null
        ? { name: SENDER_NAME.FORMER_MEMBER, kind: CODING_AGENT_SENDER.FORMER }
        : { userId: row.memberId, name: row.memberName, kind: CODING_AGENT_SENDER.MEMBER };
    case MESSAGE_SENDER.LUKE:
      return { name: SENDER_NAME.LUKE, kind: CODING_AGENT_SENDER.LUKE };
    case MESSAGE_SENDER.AUTOMATION:
      return row.senderName === null
        ? undefined
        : { name: row.senderName, kind: CODING_AGENT_SENDER.AUTOMATION };
    case MESSAGE_SENDER.GITHUB:
      return row.senderName === null
        ? undefined
        : { name: row.senderName, kind: CODING_AGENT_SENDER.GITHUB };
    case MESSAGE_SENDER.AGENT:
      return row.senderName === null
        ? undefined
        : {
            name: row.senderName,
            agent: true,
            ...(row.senderModel === null ? undefined : { model: row.senderModel }),
            ...(row.agentId === null ? undefined : { agentId: row.agentId }),
            ...(row.agentId === null || row.agentTaskId === null
              ? undefined
              : { taskId: row.agentTaskId }),
          };
    default:
      return undefined;
  }
}

/** Whether a row is a line said on a call into the agent, either speaker's, which the voice wrote rather than a turn. */
function spokenOnCall(row: TranscriptWindowRow): boolean {
  return (
    row.role !== MESSAGE_ROLE.SYSTEM &&
    isRecord(row.metadata) &&
    row.metadata.channel === MESSAGE_CHANNEL.VOICE
  );
}

/**
 * A row of the window as the tab draws it, the message the service's page
 * would carry for it: for a developer's line what sent it, when, and where
 * in a turn under way it arrived; for a line said on a call when its words
 * began and the turn whose work it answers; and for a turn's journal when
 * the turn began and what it ran on and, once the journal closed, when it
 * did and what it spent.
 */
function windowMessageOf(
  row: TranscriptWindowRow,
  partRows: readonly TranscriptWindowPartRow[],
): CodingAgentMessage {
  const ordered = partRows.toSorted((a, b) => a.index - b.index);
  const cutParts = ordered.flatMap((each): CodingAgentPartCut[] =>
    each.cutField === null || each.bytes === null || each.head === null || each.tail === null
      ? []
      : [
          {
            index: each.index,
            field: each.cutField,
            bytes: each.bytes,
            head: each.head,
            tail: each.tail,
          },
        ],
  );
  const message = {
    id: row.id,
    role: row.role,
    parts: ordered.map((each) => each.part),
    ...(row.metadata === null ? undefined : { metadata: row.metadata }),
    ...(cutParts.length === 0 ? undefined : { cutParts }),
  };
  if (row.role === MESSAGE_ROLE.USER) {
    const sentBy = senderOf(row);
    return {
      ...message,
      clientId: row.clientId,
      ...(sentBy === undefined ? undefined : { sentBy }),
      sentAt: row.placedAt,
      ...(row.journalId === null || row.afterStep === null
        ? undefined
        : { arrivedIn: { journalId: row.journalId, afterStep: row.afterStep } }),
    };
  }
  if (spokenOnCall(row)) {
    return {
      ...message,
      sentAt: row.placedAt,
      ...(row.askTurnId === null
        ? undefined
        : {
            readFrom: {
              turnId: row.askTurnId,
              ...(row.askAfterStep === null ? undefined : { afterStep: row.askAfterStep }),
            },
          }),
    };
  }
  if (row.turnStartedAt === null || row.turnStatus === null) return message;
  return {
    ...message,
    // Note that a turn's journal shares the turn's id as its client id, which no other row of the turn does.
    ...(row.clientId === row.turnId ? { turnId: row.turnId } : undefined),
    startedAt: row.turnStartedAt,
    ...(row.finishedAt === null ? undefined : { finishedAt: row.finishedAt }),
    ...turnRecordOf({
      status: row.turnStatus,
      model: row.turnModel,
      reasoningEffort: row.turnEffort,
      usage: row.turnUsage,
      failure: row.turnFailure,
      fastRefused: row.turnFastRefused === true,
    }),
  };
}

/**
 * The window's messages as the tab draws them, oldest first, from the rows
 * of both its statements as they last stood. Note that the two arrive apart,
 * so a message whose part rows are not all in yet, as a journal that grew a
 * part a moment before its row did, is left out until they are, and the
 * reader keeps what it drew of it before.
 */
export function windowMessagesOf(
  rows: readonly TranscriptWindowRow[],
  partRows: readonly TranscriptWindowPartRow[],
): readonly CodingAgentMessage[] {
  const partsOf = new Map<string, TranscriptWindowPartRow[]>();
  for (const each of partRows) {
    const held = partsOf.get(each.messageId);
    if (held === undefined) partsOf.set(each.messageId, [each]);
    else held.push(each);
  }
  return rows
    .toSorted((a, b) => a.seq - b.seq)
    .flatMap((row) => {
      const parts = partsOf.get(row.id) ?? [];
      return parts.length === row.partCount ? [windowMessageOf(row, parts)] : [];
    });
}
