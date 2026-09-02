import { boundedText, maximumSessionRecapExcerptLength } from "@sidecar/session";
import {
  type ObservedSession,
  type ObservedSessionControl,
  PROVIDER_IDENTITY_BY_ID,
} from "../core.js";

/**
 * Context serialization for remote voice sessions.
 *
 * Remote clients can only observe cloud sessions through vault keys — no local
 * sessions, no transcript reads, no desktop-app links. The output format
 * matches `sessionContextText` from `@sidecar/realtime` so the model's
 * instructions and this context share one vocabulary, with fields the server
 * does not have (open link, running tool, pull request, workspace display
 * name) simply omitted.
 */

const MAXIMUM_REMOTE_VOICE_CONTEXT_SESSIONS = 25;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function sessionAgeText(observedAt: number | undefined, now: number): string {
  if (observedAt === undefined) return "updated at an unknown time";
  const elapsed = now - observedAt;
  if (elapsed < 5 * MINUTE_MS) return "updated just now";
  if (elapsed < HOUR_MS) return "updated minutes ago";
  if (elapsed < 2 * HOUR_MS) return "updated about an hour ago";
  if (elapsed < DAY_MS) return "updated hours ago";
  return "updated a day or more ago";
}

function providerDisplayName(providerId: string): string {
  // SAFETY: providerId is set by cloud adapters to a key in PROVIDER_IDENTITY_BY_ID; an
  // unrecognized id falls through the optional chain and the id itself is returned as-is.
  const identity = PROVIDER_IDENTITY_BY_ID[providerId as keyof typeof PROVIDER_IDENTITY_BY_ID];
  return identity?.displayName ?? providerId;
}

/**
 * Which session within a provider was observed most recently. Used to label a
 * row `most_recent_for_provider=true`, the same signal `sessionContextText`
 * emits for the desktop.
 */
function mostRecentByProvider(sessions: readonly ObservedSession[]): ReadonlyMap<string, string> {
  const newest = new Map<string, { sessionId: string; observedAt: number }>();
  for (const session of sessions) {
    const at = session.observedAt ?? 0;
    const current = newest.get(session.providerId);
    if (!current || at > current.observedAt) {
      newest.set(session.providerId, { sessionId: session.sessionId, observedAt: at });
    }
  }
  return new Map([...newest].map(([providerId, { sessionId }]) => [providerId, sessionId]));
}

function remoteCapabilityText(
  session: ObservedSession,
  mostRecent: ReadonlyMap<string, string>,
): string {
  const controls = session.controls ?? [];
  const spawnableAgents = session.spawnableAgents ?? [];
  const capabilities = [
    `provider_id=${session.providerId} provider_session_id=${session.sessionId}`,
    `messages=${Boolean(session.canReceiveMessage)}`,
    // Cloud sessions have no remote-accessible open link or local transcript.
    "open=false",
    "transcript=false",
    ...(mostRecent.get(session.providerId) === session.sessionId
      ? ["most_recent_for_provider=true"]
      : []),
    ...(controls.length > 0
      ? [
          `controls=${controls
            .map((c: ObservedSessionControl) => `${c.label} (${c.id})`)
            .join(", ")}`,
        ]
      : []),
    ...(spawnableAgents.length > 0 ? [`agents=${spawnableAgents.join(", ")}`] : []),
    ...(session.canRename ? ["chat can be renamed"] : []),
    ...(session.canRenameWorkspace ? ["workspace can be renamed"] : []),
  ];
  return capabilities.join("; ");
}

/**
 * Renders the session roster for a remote voice session context item.
 *
 * The format mirrors `sessionContextText` from `@sidecar/realtime` so the
 * session document the phone receives reads against the same instructions the
 * desktop uses. Fields the server does not hold — the session's open link,
 * current running tool, pull-request association, and the separate workspace
 * display name distinct from the repository path — are simply absent; omitting
 * them is accurate, not a loss, because cloud sessions observed here have none
 * or the server cannot distinguish them from the repository label.
 */
export function remoteSessionContextText(
  sessions: readonly ObservedSession[],
  now: number = Date.now(),
): string {
  if (sessions.length === 0) return "No coding-agent sessions are currently observed.";

  const mostRecent = mostRecentByProvider(sessions);
  // Prioritise the most-recent session per provider so the recency label
  // always lands on a listed row, then fill remaining slots with the rest.
  const mostRecentIds = new Set(mostRecent.values());
  const prioritised = [
    ...sessions.filter((s) => mostRecentIds.has(s.sessionId)),
    ...sessions.filter((s) => !mostRecentIds.has(s.sessionId)),
  ];
  const included = prioritised.slice(0, MAXIMUM_REMOTE_VOICE_CONTEXT_SESSIONS);
  const overflow = sessions.length - included.length;

  return [
    "Currently observed sessions:",
    ...included.map((session) => {
      // `session.workspace` is the repository path/label from the cloud adapter
      // (obs.detail.repository). The separate workspace display name that the
      // desktop shows on its own line is not available server-side.
      const aboutParts: string[] = [];
      if (session.branch) {
        aboutParts.push(`on branch ${session.branch}`);
      } else if (session.workspace) {
        aboutParts.push(`in repository ${session.workspace}`);
      }
      if (session.error) aboutParts.push(`error: ${session.error}`);

      return [
        `- ${providerDisplayName(session.providerId)}`,
        `internal session name — never use to refer to the work: ${session.title}`,
        session.status,
        sessionAgeText(session.observedAt, now),
        ...aboutParts,
        ...(session.recap
          ? [
              `context for naming this work — do not list its parts: ${boundedText(session.recap, maximumSessionRecapExcerptLength)}`,
            ]
          : []),
        `[${remoteCapabilityText(session, mostRecent)}]`,
      ].join(" — ");
    }),
    ...(overflow > 0
      ? [
          `(${overflow} more observed ${overflow === 1 ? "session is" : "sessions are"} not listed here; open Luke on Mac to see them all.)`,
        ]
      : []),
  ].join("\n");
}
