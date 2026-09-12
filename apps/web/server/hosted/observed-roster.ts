import { readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
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
  schema: EffectSchema.Schema<Value, UnparsedWireValue>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

/** A declaration handed the interface it decodes into, matching the assembled struct's shape. */
function schemaAs<Value>(
  schema: EffectSchema.Schema.Any,
): EffectSchema.Schema<Value, UnparsedWireValue> {
  return EffectSchema.make<Value, UnparsedWireValue>(schema.ast);
}

/**
 * A stored field read back exactly as the pass wrote it: the adapter already
 * bounded and settled every field it reported, so the read here changes
 * nothing and refuses only what is not a string at all.
 */
const storedText = EffectSchema.String;
const optionalText = EffectSchema.optionalWith(storedText, { exact: true });

export const cloudProviderIdSchema: EffectSchema.Schema<CloudAgentProviderId, UnparsedWireValue> =
  schemaAs(EffectSchema.Literal(...Object.values(CLOUD_AGENT_PROVIDER_ID)));

export const sessionStatusSchema = EffectSchema.Literal(...Object.values(SESSION_STATUS));

const advertisedActionSchema: EffectSchema.Schema<AdvertisedAction, UnparsedWireValue> = schemaAs(
  EffectSchema.Union(
    EffectSchema.Struct({ kind: EffectSchema.Literal(ACTION_KIND.MESSAGE) }),
    EffectSchema.Struct({
      kind: EffectSchema.Literal(ACTION_KIND.CONTROL),
      id: storedText,
      label: storedText,
      controlKind: EffectSchema.optionalWith(
        EffectSchema.Literal(...Object.values(SESSION_CONTROL_KIND)),
        { exact: true },
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
  ),
);

const observationSchema: EffectSchema.Schema<ProviderSessionObservation, UnparsedWireValue> =
  schemaAs(
    EffectSchema.Struct({
      providerSessionId: storedText,
      directory: optionalText,
      parentProviderSessionId: optionalText,
      title: storedText,
      status: sessionStatusSchema,
      completionCause: EffectSchema.optionalWith(
        EffectSchema.Literal(...Object.values(SESSION_COMPLETION_CAUSE)),
        { exact: true },
      ),
      lastActivityAt: EffectSchema.Number,
      realtimeVoice: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
      realtimeVoiceLive: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
      standing: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
      holdingForDeveloper: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
      agent: EffectSchema.optionalWith(
        EffectSchema.Struct({ id: storedText, displayName: storedText }),
        { exact: true },
      ),
      workspace: EffectSchema.optionalWith(
        EffectSchema.Struct({
          providerWorkspaceId: storedText,
          scopeId: optionalText,
          managerName: optionalText,
          name: optionalText,
        }),
        { exact: true },
      ),
      location: EffectSchema.optionalWith(
        EffectSchema.Literal(...Object.values(SESSION_LOCATION)),
        { exact: true },
      ),
      detail: EffectSchema.optionalWith(
        EffectSchema.Struct({
          activity: optionalText,
          repository: optionalText,
          branch: optionalText,
          model: optionalText,
          error: optionalText,
          link: optionalText,
          change: optionalText,
          diff: EffectSchema.optionalWith(
            EffectSchema.Struct({
              filesChanged: EffectSchema.Number.pipe(EffectSchema.int()),
              linesAdded: EffectSchema.Number.pipe(EffectSchema.int()),
              linesRemoved: EffectSchema.Number.pipe(EffectSchema.int()),
            }),
            { exact: true },
          ),
        }),
        { exact: true },
      ),
      applications: EffectSchema.optionalWith(
        EffectSchema.Array(
          EffectSchema.Struct({
            id: storedText,
            displayName: storedText,
            scope: EffectSchema.Literal(...Object.values(SESSION_APPLICATION_SCOPE)),
            link: optionalText,
          }),
        ),
        { exact: true },
      ),
      advertises: EffectSchema.optionalWith(EffectSchema.Array(advertisedActionSchema), {
        exact: true,
      }),
    }),
  );

const projectSchema: EffectSchema.Schema<WorkspaceProject, UnparsedWireValue> = schemaAs(
  EffectSchema.Struct({
    providerProjectId: storedText,
    repository: storedText,
    taskSupport: EffectSchema.Literal(...Object.values(WORKSPACE_TASK_SUPPORT)),
    providerTargetId: optionalText,
    targetName: optionalText,
    spawnableAgents: EffectSchema.optionalWith(EffectSchema.Array(storedText), { exact: true }),
    defaultAgent: optionalText,
    namesItself: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
  }),
);

/**
 * Every field the pass writes and no other: a body carrying a field this
 * build does not know is a body another build wrote, and is read as no
 * snapshot rather than as a roster with something missing from it.
 */
const observedRosterSchema: EffectSchema.Schema<ObservedRoster, UnparsedWireValue> = schemaAs(
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
export function parseStoredJson(body: string): UnparsedWireValue {
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
