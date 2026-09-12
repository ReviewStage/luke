import { maximumIdentifierLength } from "@sidecar/actions";
import type { SessionIdentity } from "@sidecar/session";
import type { UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Schema as EffectSchema } from "effect";
import { BRAIN_TOOL } from "./names.js";
import { identityFromRecord, rejection, sameIdentity } from "./records.js";
import { REFUSAL_REASON } from "./refusals.js";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * The brain's two reads of the sessions it observes: the roster in full, and
 * one session's whole transcript tail. Neither performs anything. A read
 * names a session by the identity the standing context lists and is refused
 * here for any identity the roster does not hold; the host refuses it again
 * for a session whose provider is not connected, and answers only where this
 * build documents reading a transcript.
 */

export interface ReadToolContext extends ToolContext {
  /** The roster as the host renders it now, and the identities a named session is held to. */
  readonly roster: { readonly text: string; readonly identities: readonly SessionIdentity[] };
  /** Reads one observed session's whole tail through the host, bounded there; the identity is one the roster holds. */
  readTranscript(identity: SessionIdentity): Promise<WireRecord>;
}

export type ReadToolModule = ToolModule<WireRecord, ReadToolContext>;

/** A text trimmed, refused when left with nothing, and bounded to `max` characters. */
function boundedText(description: string, max: number): EffectSchema.Schema<string, string> {
  return describeWire(
    EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
      strict: true,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }).pipe(
      EffectSchema.filter((value) => value.trim().length > 0, {
        schemaId: EffectSchema.MinLengthSchemaId,
        jsonSchema: { minLength: 1 },
      }),
      EffectSchema.maxLength(max),
    ),
    description,
  );
}

const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** Effect's `Schema` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase<A, I>(
  schema: EffectSchema.Schema<A, I>,
): EffectSchema.Schema<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const LIST_SESSIONS_INPUT = erase(tolerantRecord({}));

const READ_TRANSCRIPT_INPUT = erase(
  tolerantRecord({
    provider_id: boundedText("The session provider ID.", maximumIdentifierLength),
    provider_session_id: boundedText("The session ID.", maximumIdentifierLength),
  }),
);

const LIST_SESSIONS: ReadToolModule = {
  name: BRAIN_TOOL.LIST_SESSIONS,
  description:
    "Read the full roster of observed sessions as it stands right now, with each session's " +
    "identity, status, and capabilities. The standing context already carries it; call this " +
    "only when you need it fresher than the turn's opening.",
  inputSchema: LIST_SESSIONS_INPUT,
  async execute(_input: WireRecord, context: ReadToolContext): Promise<WireRecord> {
    return { roster: context.roster.text };
  },
};

const READ_TRANSCRIPT: ReadToolModule = {
  name: BRAIN_TOOL.READ_TRANSCRIPT,
  description:
    "Read the recent transcript of one observed session in full, bounded to its tail. Use it " +
    "when an event's transcript delta is not enough to judge what the agent is doing. A local " +
    "session answers when its provider's transcript this build reads; a Conductor cloud " +
    "session answers with the developer's messages and the agent's replies, never its tool " +
    "activity; any other cloud session returns a refusal.",
  inputSchema: READ_TRANSCRIPT_INPUT,
  async execute(input: WireRecord, context: ReadToolContext): Promise<WireRecord> {
    const named = identityFromRecord(input);
    const observed =
      named !== undefined &&
      context.roster.identities.some((listed) => sameIdentity(listed, named));
    if (!named || !observed) return rejection(REFUSAL_REASON.UNOBSERVED_SESSION);
    return context.readTranscript(named);
  },
};

/** The two reads, in the order the catalog lists them. */
export const READ_TOOLS: readonly ReadToolModule[] = [LIST_SESSIONS, READ_TRANSCRIPT];

const READ_TOOLS_BY_NAME = new Map(READ_TOOLS.map((tool) => [tool.name, tool]));

export function readToolNamed(name: string): ReadToolModule | undefined {
  return READ_TOOLS_BY_NAME.get(name);
}
