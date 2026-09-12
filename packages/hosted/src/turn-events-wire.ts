import {
  effectSchema,
  SCHEMA_REFUSAL,
  type Schema,
  s,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { emitJsonSchema, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { wireUuidSchema, writtenText } from "./service-wire.js";

/**
 * The turn event stream: what a client that just asked a turn hears of it
 * while it runs, as Server-Sent Events over `GET /api/brain/turns/{id}/events`.
 * The four kinds are the run seams the live session service consumes — a slow
 * step began, every action settled, one sentence of the reply, the turn ended
 * — and nothing wider: the stream carries no tool part, no reasoning, and no
 * message, only what a voice needs to speak commentary while the turn runs.
 * Each event is numbered from one inside its turn, and the number is the
 * frame's `id`, so a client that lost its connection attaches again with the
 * last number it took as the reads' own `after` and hears the rest exactly
 * once. The end is
 * the last event of every turn, and the stream closes after it; a stream that
 * closes without an end is one whose attachment lapsed, and the client attaches
 * again from its cursor. The same words as the brain's own run stream, spelled
 * here because the wire cannot reach the brain; a test above both holds them
 * equal.
 *
 * Every declaration below is composed directly as an Effect `Schema`, under
 * its own `<name>Effect` export; the plain `<name>` export beside it is the
 * same declaration read through `fromEffect` (the pattern P1-04 established
 * in `packages/wire/src/ui-message-metadata.ts`), which is what
 * `decodeTurnEventFrame` below and `apps/web/server/hosted/turn-event-stream.ts`
 * still call `.parse()` on. The facade twin is the strangler shim P12-08
 * deletes, once every caller declares against the `Effect` export directly.
 */

/**
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) =>
      Either.match(read(value), {
        onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onRight: (value) => ({ ok: true, value }),
      }),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** An integer at or above its minimum, the way `s.wholeNumber({ minimum })` reads one. */
function wholeNumber(minimum: number) {
  return EffectSchema.Int.pipe(EffectSchema.greaterThanOrEqualTo(minimum));
}

export const TURN_EVENT_KIND = {
  /** The turn began a step slow enough to be worth telling the developer about; at most once per turn. */
  SLOW_STEP: "slow_step",
  /** Every action the turn dispatched has its result on the record; the reply's sentences follow. */
  ACTIONS_SETTLED: "actions_settled",
  /** One sentence of the reply, in order, after the actions settled. */
  REPLY_SENTENCE: "reply_sentence",
  /** The turn reached a terminal status; the stream ends with it. */
  ENDED: "ended",
} as const;

export type TurnEventKind = (typeof TURN_EVENT_KIND)[keyof typeof TURN_EVENT_KIND];

/** Which kind of slow step began: a whole transcript read, or a write the provider carries. */
export const TURN_SLOW_STEP = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
} as const;

export type TurnSlowStep = (typeof TURN_SLOW_STEP)[keyof typeof TURN_SLOW_STEP];

/** How a turn ended, as a client tells a reply from a refusal. */
export const TURN_END = {
  /** The turn answered; whatever sentences it had were streamed ahead of this. */
  COMPLETED: "completed",
  /** The developer, or a drain, stopped it before a reply formed. */
  CANCELLED: "cancelled",
  /** The turn could not finish for a reason of its own. */
  FAILED: "failed",
} as const;

export type TurnEnd = (typeof TURN_END)[keyof typeof TURN_END];

/** The cursor as the query carries it under `READ_QUERY.AFTER`: the number of the last event taken, zero for none. */
export const turnEventCursorSchemaEffect = wholeNumber(0);

export const turnEventCursorSchema: Schema<number> = fromEffect(turnEventCursorSchemaEffect);

/** What every event of the stream carries beside its own fields: the turn it belongs to and its place in that turn. */
interface TurnEventBase {
  readonly turnId: string;
  /** The event's place in the turn, numbered from one; the frame's `id`. */
  readonly seq: number;
}

export type TurnEventBody =
  | { readonly kind: typeof TURN_EVENT_KIND.SLOW_STEP; readonly step: TurnSlowStep }
  | { readonly kind: typeof TURN_EVENT_KIND.ACTIONS_SETTLED }
  | { readonly kind: typeof TURN_EVENT_KIND.REPLY_SENTENCE; readonly sentence: string }
  | { readonly kind: typeof TURN_EVENT_KIND.ENDED; readonly end: TurnEnd };

export type TurnEvent = TurnEventBody & TurnEventBase;

const eventBaseEffect = {
  turnId: effectSchema(wireUuidSchema),
  seq: wholeNumber(1),
} as const;

export const turnEventSchemaEffect = EffectSchema.Union(
  tolerantRecord({
    ...eventBaseEffect,
    kind: EffectSchema.Literal(TURN_EVENT_KIND.SLOW_STEP),
    step: EffectSchema.Literal(...Object.values(TURN_SLOW_STEP)),
  }),
  tolerantRecord({
    ...eventBaseEffect,
    kind: EffectSchema.Literal(TURN_EVENT_KIND.ACTIONS_SETTLED),
  }),
  tolerantRecord({
    ...eventBaseEffect,
    kind: EffectSchema.Literal(TURN_EVENT_KIND.REPLY_SENTENCE),
    sentence: effectSchema(writtenText),
  }),
  tolerantRecord({
    ...eventBaseEffect,
    kind: EffectSchema.Literal(TURN_EVENT_KIND.ENDED),
    end: EffectSchema.Literal(...Object.values(TURN_END)),
  }),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export const turnEventSchema: Schema<TurnEvent> = fromEffect(turnEventSchemaEffect);

/**
 * The stream's framing, as the Server-Sent Events format has it: one frame is
 * an `id` line carrying the event's number and a `data` line carrying the
 * event's JSON, closed by a blank line; a frame of one comment line and no
 * fields is a heartbeat, which says only that the connection stands.
 */
export const TURN_EVENT_STREAM = {
  MEDIA_TYPE: "text/event-stream",
  FRAME_END: "\n\n",
  HEARTBEAT_FRAME: ":\n\n",
} as const;

const FIELD = { ID: "id", DATA: "data" } as const;

/** One event as its frame travels. */
export function encodeTurnEventFrame(event: TurnEvent): string {
  return `${FIELD.ID}: ${event.seq}\n${FIELD.DATA}: ${JSON.stringify(event)}${TURN_EVENT_STREAM.FRAME_END}`;
}

function fieldOf(line: string, name: string): string | undefined {
  if (!line.startsWith(`${name}:`)) return undefined;
  const value = line.slice(name.length + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

/**
 * The event one frame carries, read back under the schema, or nothing for a
 * heartbeat, a frame this build cannot read, or one whose `id` disagrees with
 * the event's own number. A client that reads nothing from a frame skips it
 * and keeps its cursor where it stood.
 */
export function decodeTurnEventFrame(frame: string): TurnEvent | undefined {
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    const idValue = fieldOf(line, FIELD.ID);
    if (idValue !== undefined) id = idValue;
    const dataValue = fieldOf(line, FIELD.DATA);
    if (dataValue !== undefined) data.push(dataValue);
  }
  if (data.length === 0) return undefined;
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse answers a wire value; the schema read below is the validation.
    parsed = JSON.parse(data.join("\n")) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  const event = turnEventSchema.parse(parsed);
  if (event === undefined || id !== String(event.seq)) return undefined;
  return event;
}
