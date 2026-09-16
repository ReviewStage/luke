import { readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result } from "effect";
import {
  ACTION_KIND,
  type AdvertisedAction,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type ProviderSessionObservation,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  type UnparsedWireValue,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "../core.js";

/**
 * The roster as the snapshot keeps it: every provider's observations exactly
 * as its pass reported them, advertisements and all, beside the projects the
 * same pass listed. The observations are kept whole rather than as the
 * observe wire's rows because an action is admitted against the snapshot —
 * the control a session advertised, the workspace a rename targets, the
 * project a creation names — and a row cut to what a phone draws could
 * validate none of it. The instant is the record's, not the body's.
 */
export const OBSERVED_ROSTER_VERSION = 1;

interface ObservedRosterProvider {
  readonly providerId: CloudAgentProviderId;
  /**
   * A fingerprint of the key the pass observed under, so a snapshot read
   * under a key since replaced or removed is not served or admitted against
   * as if it were this key's roster.
   */
  readonly keyFingerprint: string;
  readonly observations: readonly ProviderSessionObservation[];
  readonly projects: readonly WorkspaceProject[];
}

export interface ObservedRoster {
  readonly version: typeof OBSERVED_ROSTER_VERSION;
  readonly providers: readonly ObservedRosterProvider[];
}

/** One provider's slice of the roster, or nothing where the snapshot holds none for it. */
export function rosterProvider(
  roster: ObservedRoster,
  providerId: CloudAgentProviderId,
): ObservedRosterProvider | undefined {
  return roster.providers.find((provider) => provider.providerId === providerId);
}

export function encodeObservedRoster(roster: ObservedRoster): string {
  return JSON.stringify(roster);
}

/**
 * A value the schema admitted, or nothing, for a caller that only cares
 * whether the value is admissible.
 */
function admitted<Value>(
  schema: EffectSchema.Codec<Value, UnparsedWireValue>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/** A declaration handed the interface it decodes into, matching the assembled struct's shape. */
function schemaAs<Value>(schema: EffectSchema.Top): EffectSchema.Codec<Value, UnparsedWireValue> {
  return EffectSchema.make<EffectSchema.Codec<Value, UnparsedWireValue>>(schema.ast);
}

/**
 * A stored field read back exactly as the pass wrote it: the adapter already
 * bounded and settled every field it reported, so the read here changes
 * nothing and refuses only what is not a string at all.
 */
const storedText = EffectSchema.String;
const optionalText = EffectSchema.optionalKey(storedText);

const cloudProviderIdSchema: EffectSchema.Codec<CloudAgentProviderId, UnparsedWireValue> = schemaAs(
  EffectSchema.Literals(Object.values(CLOUD_AGENT_PROVIDER_ID)),
);

const sessionStatusSchema = EffectSchema.Literals(Object.values(SESSION_STATUS));

const advertisedActionSchema: EffectSchema.Codec<AdvertisedAction, UnparsedWireValue> = schemaAs(
  EffectSchema.Union([
    EffectSchema.Struct({ kind: EffectSchema.Literal(ACTION_KIND.MESSAGE) }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(ACTION_KIND.CONTROL),
      id: storedText,
      label: storedText,
      controlKind: EffectSchema.optionalKey(
        EffectSchema.Literals(Object.values(SESSION_CONTROL_KIND)),
      ),
      target: optionalText,
    }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(ACTION_KIND.ADD_AGENT),
      agents: EffectSchema.Array(storedText),
      target: optionalText,
    }),
    EffectSchema.Struct({ kind: EffectSchema.Literal(ACTION_KIND.RENAME_SESSION) }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(ACTION_KIND.RENAME_WORKSPACE),
      target: storedText,
    }),
  ]),
);

const observationSchema: EffectSchema.Codec<ProviderSessionObservation, UnparsedWireValue> =
  schemaAs(
    EffectSchema.Struct({
      providerSessionId: storedText,
      directory: optionalText,
      parentProviderSessionId: optionalText,
      title: storedText,
      status: sessionStatusSchema,
      completionCause: EffectSchema.optionalKey(
        EffectSchema.Literals(Object.values(SESSION_COMPLETION_CAUSE)),
      ),
      lastActivityAt: EffectSchema.Number,
      realtimeVoice: EffectSchema.optionalKey(EffectSchema.Boolean),
      realtimeVoiceLive: EffectSchema.optionalKey(EffectSchema.Boolean),
      standing: EffectSchema.optionalKey(EffectSchema.Boolean),
      holdingForDeveloper: EffectSchema.optionalKey(EffectSchema.Boolean),
      agent: EffectSchema.optionalKey(
        EffectSchema.Struct({ id: storedText, displayName: storedText }),
      ),
      workspace: EffectSchema.optionalKey(
        EffectSchema.Struct({
          providerWorkspaceId: storedText,
          scopeId: optionalText,
          managerName: optionalText,
          name: optionalText,
        }),
      ),
      location: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(SESSION_LOCATION))),
      detail: EffectSchema.optionalKey(
        EffectSchema.Struct({
          activity: optionalText,
          repository: optionalText,
          branch: optionalText,
          model: optionalText,
          error: optionalText,
          link: optionalText,
          change: optionalText,
          diff: EffectSchema.optionalKey(
            EffectSchema.Struct({
              filesChanged: EffectSchema.Number.check(EffectSchema.isInt()),
              linesAdded: EffectSchema.Number.check(EffectSchema.isInt()),
              linesRemoved: EffectSchema.Number.check(EffectSchema.isInt()),
            }),
          ),
        }),
      ),
      applications: EffectSchema.optionalKey(
        EffectSchema.Array(
          EffectSchema.Struct({
            id: storedText,
            displayName: storedText,
            scope: EffectSchema.Literals(Object.values(SESSION_APPLICATION_SCOPE)),
            link: optionalText,
          }),
        ),
      ),
      advertises: EffectSchema.optionalKey(EffectSchema.Array(advertisedActionSchema)),
    }),
  );

const projectSchema: EffectSchema.Codec<WorkspaceProject, UnparsedWireValue> = schemaAs(
  EffectSchema.Struct({
    providerProjectId: storedText,
    repository: storedText,
    taskSupport: EffectSchema.Literals(Object.values(WORKSPACE_TASK_SUPPORT)),
    providerTargetId: optionalText,
    targetName: optionalText,
    spawnableAgents: EffectSchema.optionalKey(EffectSchema.Array(storedText)),
    defaultAgent: optionalText,
    namesItself: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
);

/**
 * Every field the pass writes and no other: a body carrying a field this
 * build does not know is a body another build wrote, and is read as no
 * snapshot rather than as a roster with something missing from it.
 */
const observedRosterSchema: EffectSchema.Codec<ObservedRoster, UnparsedWireValue> = schemaAs(
  EffectSchema.Struct({
    version: EffectSchema.Literal(OBSERVED_ROSTER_VERSION),
    providers: EffectSchema.Array(
      EffectSchema.Struct({
        providerId: cloudProviderIdSchema,
        keyFingerprint: storedText,
        observations: EffectSchema.Array(observationSchema),
        projects: EffectSchema.Array(projectSchema),
      }),
    ),
  }),
);

/** A stored body as JSON, or nothing for text that is not JSON at all. */
function parseStoredJson(body: string): UnparsedWireValue {
  try {
    // SAFETY: JSON.parse returns unknown; the schema the caller reads it with validates the shape.
    return JSON.parse(body) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

/**
 * Reads a stored body, or nothing for one this build cannot read: another
 * version, or a shape the pass never wrote. A body that cannot be read is
 * treated as no snapshot at all, so the next pass writes a fresh one and
 * takes no diff against it.
 */
export function decodeObservedRoster(body: string): ObservedRoster | undefined {
  return admitted(observedRosterSchema, parseStoredJson(body));
}
