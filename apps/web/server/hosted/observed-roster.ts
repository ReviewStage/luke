import {
  ACTION_KIND,
  type AdvertisedAction,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  type ProviderSessionObservation,
  RECORD_EXTRA_KEYS,
  type Schema,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  s,
  TEXT_ENDS,
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

export function encodeObservedRoster(roster: ObservedRoster): string {
  return JSON.stringify(roster);
}

/**
 * A stored field read back exactly as the pass wrote it: the adapter already
 * bounded and settled every field it reported, so the read here changes
 * nothing and refuses only what is not a string at all.
 */
const storedText = s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true });
const optionalText = storedText.optional();

export const cloudProviderIdSchema: Schema<CloudAgentProviderId> = s.enumOf(
  Object.values(CLOUD_AGENT_PROVIDER_ID),
);

export const sessionStatusSchema = s.enumOf(Object.values(SESSION_STATUS));

const advertisedActionSchema: Schema<AdvertisedAction> = s.union([
  s.record({ kind: s.literal(ACTION_KIND.MESSAGE) }),
  s.record({
    kind: s.literal(ACTION_KIND.CONTROL),
    id: storedText,
    label: storedText,
    controlKind: s.enumOf(Object.values(SESSION_CONTROL_KIND)).optional(),
    target: optionalText,
  }),
  s.record({
    kind: s.literal(ACTION_KIND.ADD_AGENT),
    agents: s.array(storedText),
    target: optionalText,
  }),
  s.record({ kind: s.literal(ACTION_KIND.RENAME_SESSION) }),
  s.record({ kind: s.literal(ACTION_KIND.RENAME_WORKSPACE), target: storedText }),
]);

const observationSchema: Schema<ProviderSessionObservation> = s.record({
  providerSessionId: storedText,
  directory: optionalText,
  parentProviderSessionId: optionalText,
  title: storedText,
  status: sessionStatusSchema,
  completionCause: s.enumOf(Object.values(SESSION_COMPLETION_CAUSE)).optional(),
  lastActivityAt: s.number(),
  realtimeVoice: s.boolean().optional(),
  realtimeVoiceLive: s.boolean().optional(),
  standing: s.boolean().optional(),
  holdingForDeveloper: s.boolean().optional(),
  agent: s.record({ id: storedText, displayName: storedText }).optional(),
  workspace: s
    .record({
      providerWorkspaceId: storedText,
      scopeId: optionalText,
      managerName: optionalText,
      name: optionalText,
    })
    .optional(),
  location: s.enumOf(Object.values(SESSION_LOCATION)).optional(),
  detail: s
    .record({
      activity: optionalText,
      repository: optionalText,
      branch: optionalText,
      model: optionalText,
      error: optionalText,
      link: optionalText,
      change: optionalText,
      diff: s
        .record({
          filesChanged: s.wholeNumber(),
          linesAdded: s.wholeNumber(),
          linesRemoved: s.wholeNumber(),
        })
        .optional(),
    })
    .optional(),
  applications: s
    .array(
      s.record({
        id: storedText,
        displayName: storedText,
        scope: s.enumOf(Object.values(SESSION_APPLICATION_SCOPE)),
        link: optionalText,
      }),
    )
    .optional(),
  advertises: s.array(advertisedActionSchema).optional(),
});

const projectSchema: Schema<WorkspaceProject> = s.record({
  providerProjectId: storedText,
  repository: storedText,
  taskSupport: s.enumOf(Object.values(WORKSPACE_TASK_SUPPORT)),
  providerTargetId: optionalText,
  targetName: optionalText,
  spawnableAgents: s.array(storedText).optional(),
  defaultAgent: optionalText,
  namesItself: s.boolean().optional(),
});

/**
 * Every field the pass writes and no other: a body carrying a field this
 * build does not know is a body another build wrote, and is read as no
 * snapshot rather than as a roster with something missing from it.
 */
const observedRosterSchema: Schema<ObservedRoster> = s.record(
  {
    version: s.literal(OBSERVED_ROSTER_VERSION),
    providers: s.array(
      s.record({
        providerId: cloudProviderIdSchema,
        keyFingerprint: storedText,
        observations: s.array(observationSchema),
        projects: s.array(projectSchema),
      }),
    ),
  },
  { extraKeys: RECORD_EXTRA_KEYS.REFUSE },
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
  return observedRosterSchema.parse(parseStoredJson(body));
}
