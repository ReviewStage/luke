import {
  normalizeSessionDetail,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionDetail,
} from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Either, Schema } from "effect";
import { writtenText } from "./service-wire.js";

/**
 * What the observe endpoint answers: one bounded row per cloud session. A
 * malformed row is skipped rather than failing the roster, and a field a row
 * could do without is dropped rather than failing the row, because a phone
 * that can draw four sessions of five is better off than one that draws none.
 */

/**
 * The one query the observe endpoint takes. The roster it answers is the
 * snapshot the service's own scheduled pass last stored; a foreground device
 * that wants the provider asked again right now says so with `fresh=true`,
 * which spends the endpoint's per-user rate brake where a stored read does
 * not.
 */
export const OBSERVE_QUERY = {
  FRESH: "fresh",
  /** The value the flag takes; anything else reads the stored snapshot. */
  FRESH_VALUE: "true",
} as const;

/**
 * One control a session's provider advertised for it, as the observe endpoint
 * reports it: the id an action names, and the label and kind the row draws. What
 * the control targets never travels — the action endpoint re-observes and builds
 * the write from its own fresh advertisement, so the wire copy can gate a
 * button but can never redirect a write.
 */
export interface ObservedSessionControl {
  id: string;
  label: string;
  /** One of the SESSION_CONTROL_KIND string values, when the provider named one. */
  kind?: string;
}

/**
 * One cloud session as reported by the observe endpoint. The fields are a
 * bounded subset of `ProviderSessionObservation`: what mobile can show in a
 * roster row, and which actions that row may offer. The service maps the
 * stored snapshot's observation onto this shape; every action endpoint
 * validates against that same snapshot's own advertisements rather than
 * trusting these copies.
 *
 * The detail fields are the session vocabulary's own, and the reader holds
 * them to that vocabulary's own bounds: `change` to an HTTPS address, `link`
 * to the openable session-link schemes. `link` is the one observed field a
 * surface acts on rather than draws, so an address outside the set never
 * crosses the wire at all.
 */
export interface ObservedSession
  extends Pick<SessionDetail, "branch" | "change" | "error" | "link"> {
  /** The cloud-agent provider id for this session (conductor today). */
  providerId: string;
  /** The provider's own id for this session. */
  sessionId: string;
  /** Bounded session title. */
  title: string;
  /** One of the SESSION_STATUS string values. */
  status: string;
  /** Repository label or workspace name, when the provider reported one. */
  workspace?: string;
  /** Unix milliseconds of the provider's last write about the session, when it reported one. */
  lastActivityAt?: number;
  /**
   * The name `lastActivityAt` traveled under before it was renamed. The
   * service still writes it beside the new name, and a reader still accepts
   * it, so an installed iOS build keeps its age chip and recency sort until
   * it updates; it may go once the first iOS release that reads
   * `lastActivityAt` has shipped. Nothing else reads or writes it.
   */
  observedAt?: number;
  /** Whether the session's latest observation advertised taking a message. */
  canReceiveMessage?: boolean;
  /** The controls the session's latest observation advertised, if any. */
  controls?: ObservedSessionControl[];
  /** Agent kinds the latest observation listed as spawnable in this session's workspace. */
  spawnableAgents?: string[];
  /** Whether the latest observation advertised renaming the session itself. */
  canRename?: boolean;
  /** Whether the latest observation advertised renaming the session's workspace. */
  canRenameWorkspace?: boolean;
  /**
   * Whether the messages endpoint can read this session's conversation — a
   * capability of the provider's documented transcript read, not a per-turn
   * state, so a screen that sees it absent has no conversation to draw and
   * says so.
   */
  canReadConversation?: boolean;
}

/** The observe endpoint answer: the caller's cloud sessions across all providers. */
export interface ObserveAnswer {
  sessions: ObservedSession[];
  /** When the roster answered was observed, in Unix milliseconds; absent for a roster no pass has stored. */
  observedAt?: number;
}

const OBSERVED_SESSION_STATUS_NAMES = Object.values(SESSION_STATUS);

/**
 * A declaration handed the interface it decodes into, since Effect's `Schema`
 * is invariant in its decoded type and a struct assembled from field tables
 * only agrees with that interface rather than restating it. The same claim
 * the facade's own `schemaOver` made over its assembled AST.
 */
function schemaAs<Value>(schema: Schema.Schema.Any): Schema.Schema<Value, UnparsedWireValue> {
  return Schema.make<Value, UnparsedWireValue>(schema.ast);
}

/** A record that ignores a key a newer service added, which is what an answer always does. */
const tolerantRecord = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/**
 * A key a `dropRefused` field left holding `undefined` is dropped entirely,
 * exactly as an absent optional key is: a struct's decode still writes the
 * key when it arrived, even holding nothing.
 */
function omittingUndefinedKeys<Fields extends object, Encoded>(
  schema: Schema.Schema<Fields, Encoded>,
) {
  return Schema.transform(schema, Schema.Unknown, {
    strict: false,
    decode: (value) =>
      Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)),
    encode: (value) => value,
  });
}

/** A trimmed text, refused when only whitespace remains. */
const text: Schema.Schema<string, string> = Schema.transform(Schema.String, Schema.String, {
  strict: true,
  decode: (value) => value.trim(),
  encode: (value) => value,
}).pipe(Schema.minLength(1));

/**
 * A member set read with its ends trimmed ahead of the membership test, the
 * node declared beside it because what the emitter shows for a
 * transformation is the text it decodes from.
 */
function trimmedEnum<const Member extends string>(
  members: readonly Member[],
): Schema.Schema<Member, string> {
  return verbatimJsonSchema(
    Schema.transform(Schema.String, Schema.Literal(...members), {
      strict: false,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }),
    { type: "string", enum: members },
  );
}

const written = writtenText;

/** The value a schema admitted, or nothing, for a caller that only cares whether the value is admissible. */
function admitted<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

/** The value a `dropRefused` field admits: whatever the schema read, or nothing. */
function droppedField<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
): Schema.Schema<Value | undefined, UnparsedWireValue> {
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: admitted(schema, value) }),
    emitJsonSchema(schema),
  );
}

/** A text read against `map`, folding the read value or dropping it, and never refusing the field. */
function droppedMappedText<Mapped>(
  map: (value: string) => Mapped | undefined,
): Schema.Schema<Mapped | undefined, UnparsedWireValue> {
  const read = readEither(text);
  return declareReader<Mapped | undefined>(
    (value) => ({
      ok: true,
      value: Either.match(read(value), { onLeft: () => undefined, onRight: map }),
    }),
    emitJsonSchema(text),
  );
}

/** An array that drops a refused entry instead of refusing the whole array. */
function keptItems<Value, Encoded>(
  item: Schema.Schema<Value, Encoded>,
): Schema.Schema<readonly Value[], UnparsedWireValue> {
  const droppedItem = droppedField(item);
  const forgiving = Schema.Array(droppedItem);
  const transformed = Schema.transform(forgiving, Schema.Unknown, {
    strict: false,
    decode: (entries) => entries.filter((entry) => entry !== undefined),
    encode: (entries) => entries,
  });
  return Schema.make<readonly Value[], UnparsedWireValue>(transformed.ast);
}

const observedSessionControlSchema = tolerantRecord({
  id: text,
  label: text,
  kind: Schema.optionalWith(droppedField(trimmedEnum(Object.values(SESSION_CONTROL_KIND))), {
    exact: true,
  }),
});

/**
 * The two details a surface acts on rather than draws. Each goes through the
 * same normalizer the desktop's own rows go through, which is what decides
 * whether the address may be opened at all; one it turns down is dropped like
 * any other unreadable field.
 */
const changeField = droppedMappedText((value) => normalizeSessionDetail({ change: value }).change);
const linkField = droppedMappedText((value) => normalizeSessionDetail({ link: value }).link);

const rawObservedSessionSchema = tolerantRecord({
  providerId: text,
  sessionId: text,
  title: text,
  status: trimmedEnum(OBSERVED_SESSION_STATUS_NAMES),
  workspace: Schema.optionalWith(droppedField(text), { exact: true }),
  branch: Schema.optionalWith(droppedField(text), { exact: true }),
  change: Schema.optionalWith(changeField, { exact: true }),
  link: Schema.optionalWith(linkField, { exact: true }),
  error: Schema.optionalWith(droppedField(text), { exact: true }),
  lastActivityAt: Schema.optionalWith(droppedField(Schema.Number.pipe(Schema.finite())), {
    exact: true,
  }),
  observedAt: Schema.optionalWith(droppedField(Schema.Number.pipe(Schema.finite())), {
    exact: true,
  }),
  canReceiveMessage: Schema.optionalWith(droppedField(Schema.Literal(true)), { exact: true }),
  controls: Schema.optionalWith(
    droppedField(keptItems(observedSessionControlSchema).pipe(Schema.minItems(1))),
    { exact: true },
  ),
  spawnableAgents: Schema.optionalWith(droppedField(keptItems(written).pipe(Schema.minItems(1))), {
    exact: true,
  }),
  canRename: Schema.optionalWith(droppedField(Schema.Literal(true)), { exact: true }),
  canRenameWorkspace: Schema.optionalWith(droppedField(Schema.Literal(true)), { exact: true }),
  canReadConversation: Schema.optionalWith(droppedField(Schema.Literal(true)), { exact: true }),
});

/**
 * A key a `dropRefused` field left holding `undefined` is dropped from the
 * row entirely — a struct's decode still writes the key when it arrived,
 * even holding nothing — and the old name is folded into the new one here
 * and travels no further, so nothing downstream of this read has two names
 * for one instant.
 */
const observedSessionSchema = schemaAs<ObservedSession>(
  Schema.transform(rawObservedSessionSchema, Schema.Unknown, {
    strict: false,
    decode: (raw) => {
      const { observedAt, lastActivityAt, ...rest } = raw;
      const cleaned = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined),
      );
      const resolvedLastActivityAt = lastActivityAt ?? observedAt;
      return resolvedLastActivityAt === undefined
        ? cleaned
        : { ...cleaned, lastActivityAt: resolvedLastActivityAt };
    },
    encode: (session) => session,
  }),
);

/** A malformed session entry is skipped, not fatal. */
export const observeAnswerSchema = schemaAs<ObserveAnswer>(
  omittingUndefinedKeys(
    tolerantRecord({
      sessions: keptItems(observedSessionSchema),
      observedAt: Schema.optionalWith(droppedField(Schema.Number.pipe(Schema.finite())), {
        exact: true,
      }),
    }),
  ),
);

export function observeAnswerFromWire(value: UnparsedWireValue): ObserveAnswer | undefined {
  return admitted(observeAnswerSchema, value);
}
