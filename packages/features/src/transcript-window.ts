import { isRecord, LEGACY_APP_WORD, MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import { Schema } from "effect";
import {
  AGENT_SENDER,
  type AgentSender,
  type AgentTranscriptMessage,
  MESSAGE_SENDER,
  PART_CUT_FIELD,
  type PartCut,
  storedObjectSchema,
} from "./agent-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import { countedNumber } from "./service-wire.js";
import { turnRecordOf } from "./turn-record.js";

export const TRANSCRIPT_WINDOW = 100;

const SENDER_NAME = {
  APP: PRODUCT_NAME,
  FORMER_MEMBER: "Former member",
} as const;

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(countedNumber);

export const transcriptWindowRowSchema = Schema.Struct({
  id: Schema.String,
  seq: countedNumber,
  clientId: Schema.String,
  role: Schema.Literals(Object.values(MESSAGE_ROLE)),
  partCount: countedNumber,
  metadata: Schema.NullOr(storedObjectSchema),
  placedAt: countedNumber,
  finishedAt: NullableNumber,
  sender: NullableString,
  senderName: NullableString,
  senderModel: NullableString,
  memberId: NullableString,
  memberName: NullableString,
  agentId: NullableString,
  automationId: Schema.optionalKey(NullableString),
  agentTaskId: NullableString,
  journalId: NullableString,
  afterStep: NullableNumber,
  turnStartedAt: NullableNumber,
  turnStatus: NullableString,
  turnModel: NullableString,
  turnEffort: NullableString,
  turnUsage: Schema.NullOr(Schema.Unknown),
  turnFailure: NullableString,
  turnFastRefused: Schema.NullOr(Schema.Boolean),
});

export type TranscriptWindowRow = typeof transcriptWindowRowSchema.Type;

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

function senderOf(row: TranscriptWindowRow): AgentSender | undefined {
  switch (row.sender) {
    case MESSAGE_SENDER.MEMBER:
      return row.memberId === null || row.memberName === null
        ? { name: SENDER_NAME.FORMER_MEMBER, kind: AGENT_SENDER.FORMER }
        : { userId: row.memberId, name: row.memberName, kind: AGENT_SENDER.MEMBER };
    case MESSAGE_SENDER.APP:
    case LEGACY_APP_WORD:
      return { name: SENDER_NAME.APP, kind: AGENT_SENDER.APP };
    case MESSAGE_SENDER.AUTOMATION: {
      const automationId = row.automationId ?? null;
      return row.senderName === null
        ? undefined
        : {
            name: row.senderName,
            kind: AGENT_SENDER.AUTOMATION,
            ...(automationId === null ? undefined : { automationId }),
          };
    }
    case MESSAGE_SENDER.GITHUB:
      return row.senderName === null
        ? undefined
        : { name: row.senderName, kind: AGENT_SENDER.GITHUB };
    case MESSAGE_SENDER.AGENT:
      return row.senderName === null
        ? undefined
        : {
            name: row.senderName,
            agent: true,
            ...(row.senderModel === null ? undefined : { model: row.senderModel }),
            ...(row.agentId === null ? undefined : { agentId: row.agentId }),
          };
    default:
      return undefined;
  }
}

function spokenOnCall(row: TranscriptWindowRow): boolean {
  return (
    row.role !== MESSAGE_ROLE.SYSTEM &&
    isRecord(row.metadata) &&
    row.metadata.channel === MESSAGE_CHANNEL.VOICE
  );
}

function windowMessageOf(
  row: TranscriptWindowRow,
  partRows: readonly TranscriptWindowPartRow[],
): AgentTranscriptMessage {
  const ordered = partRows.toSorted((a, b) => a.index - b.index);
  const cutParts = ordered.flatMap((each): PartCut[] =>
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
  if (spokenOnCall(row)) return { ...message, sentAt: row.placedAt };
  if (row.turnStartedAt === null || row.turnStatus === null) return message;
  return {
    ...message,
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

export function windowMessagesOf(
  rows: readonly TranscriptWindowRow[],
  partRows: readonly TranscriptWindowPartRow[],
): readonly AgentTranscriptMessage[] {
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

interface WindowRows {
  readonly window: readonly TranscriptWindowRow[];
  readonly windowParts: readonly TranscriptWindowPartRow[];
}

export function joinedWindowRows<Rows extends WindowRows>(held: Rows, past: Rows): Rows {
  const rowsAnswered = new Set(past.window.map((row) => row.id));
  const partsAnswered = new Set([...rowsAnswered, ...past.windowParts.map((row) => row.messageId)]);
  const window = [...held.window.filter((row) => !rowsAnswered.has(row.id)), ...past.window]
    .toSorted((a, b) => b.seq - a.seq)
    .slice(0, TRANSCRIPT_WINDOW);
  const kept = new Set(window.map((row) => row.id));
  const windowParts = [
    ...held.windowParts.filter((row) => !partsAnswered.has(row.messageId)),
    ...past.windowParts,
  ].filter((row) => kept.has(row.messageId));
  return { ...past, window, windowParts };
}
