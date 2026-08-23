import type { SessionNoticeAsk } from "@sidecar/attention";
import { type AppGuideSnapshot, appGuideContextText } from "@sidecar/guide";
import type { TrackedIssue } from "@sidecar/issues";
import {
  type NormalizedSession,
  type ObservedWorkspaceProject,
  SESSION_LOCATION,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceTaskSupport,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { REALTIME_CLIENT_EVENT } from "./realtime-protocol.js";

/**
 * Roster context serialization: the bounded, redacted view of sessions, issues,
 * workspace projects, and the app guide that a conversation is allowed to know
 * about. Context, never a prompt — arriving must not open Luke's mouth.
 */

/**
 * How many sessions one context update may describe. A session the roster
 * omits is one Luke denies exists, and eight Conductor workspaces beside a
 * few local agents overflowed the original ten, so the bound is set past any
 * roster the adapters' own caps can produce; every line is already bounded,
 * so the update stays a bounded read either way.
 */
export const maximumVoiceContextSessions = 25;

/**
 * What one session can be asked to do, said in the roster so Luke offers only
 * what its provider promised: the identity a tool call must name, whether it
 * takes a message, each advertised control with the id a call names it by,
 * and each app whose exact address an open ask may pick — by name alone,
 * because the address behind it stays on the machine.
 */
interface SessionRecency {
  readonly mostRecentForProvider: boolean;
  readonly mostRecentOpenableForProvider: boolean;
}

function sessionCanOpen(session: NormalizedSession): boolean {
  return (
    session.detail.link !== undefined ||
    session.applications.some((application) => application.link !== undefined)
  );
}

function sessionCapabilityText(session: NormalizedSession, recency: SessionRecency): string {
  const openableApplications = session.applications.filter(
    (application) => application.link !== undefined,
  );
  const capabilities = [
    `provider_id=${session.providerId} provider_session_id=${session.providerSessionId}`,
    `messages=${session.canReceiveMessage}`,
    `open=${Boolean(session.detail.link)}`,
    ...(openableApplications.length > 0
      ? [
          `opens_in=${openableApplications
            .map((application) => application.displayName)
            .join(", ")}`,
        ]
      : []),
    `transcript=${session.location === SESSION_LOCATION.LOCAL}`,
    ...(recency.mostRecentForProvider ? ["most_recent_for_provider=true"] : []),
    ...(recency.mostRecentOpenableForProvider ? ["most_recent_openable_for_provider=true"] : []),
    ...(session.detail.change ? ["pull_request=true"] : []),
    ...(session.controls.length > 0
      ? [
          `controls=${session.controls.map((control) => `${control.label} (${control.id})`).join(", ")}`,
        ]
      : []),
    ...(session.spawnableAgents.length > 0 ? [`agents=${session.spawnableAgents.join(", ")}`] : []),
    // Each capability travels as a fact and never a target: the identity is
    // what a rename ask names, and what it lands on stays resolved from
    // observed state on the machine.
    ...(session.canRename ? ["chat can be renamed"] : []),
    ...(session.renameTarget ? ["workspace can be renamed"] : []),
  ];
  return capabilities.join("; ");
}

function firstSessionByProvider(
  sessions: readonly NormalizedSession[],
  predicate: (session: NormalizedSession) => boolean = () => true,
): ReadonlyMap<string, NormalizedSession> {
  const newest = new Map<string, NormalizedSession>();
  for (const session of sessions) {
    if (!predicate(session)) continue;
    const current = newest.get(session.providerId);
    if (!current || session.observedAt > current.observedAt)
      newest.set(session.providerId, session);
  }
  return newest;
}

function prioritizedContextSessions(
  sessions: readonly NormalizedSession[],
): readonly NormalizedSession[] {
  const mostRecent = firstSessionByProvider(sessions);
  const mostRecentOpenable = firstSessionByProvider(sessions, sessionCanOpen);
  const prioritized = new Set<NormalizedSession>([
    ...mostRecentOpenable.values(),
    ...mostRecent.values(),
    ...sessions,
  ]);
  return [...prioritized].slice(0, maximumVoiceContextSessions);
}

/**
 * How long ago Luke last observed this session, as a prose phrase. "Updated"
 * names what observedAt actually measures — when Luke last received fresh data
 * from the provider — without implying anything about the session's current
 * activity level, which the status field already covers. Spelled out in full
 * units so it reads naturally in the conversation context and quotes back
 * clearly when the voice model names it aloud.
 */
function sessionAgeText(observedAt: number, now: number): string {
  const elapsedMinutes = Math.floor((now - observedAt) / 60_000);
  if (elapsedMinutes < 1) return "updated just now";
  if (elapsedMinutes < 60)
    return `updated ${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `updated ${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `updated ${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
}

/**
 * The checkout, current tool, and reported failure a session's line carries —
 * the same bounded about-fields the attention update already sends, worded as
 * short labelled phrases so Luke can say what a session is doing or stuck on
 * rather than only that it works or waits.
 */
function sessionAboutText(session: NormalizedSession): readonly string[] {
  return [
    ...(session.detail.branch
      ? [`on branch ${session.detail.branch}`]
      : session.detail.repository
        ? [`in repository ${session.detail.repository}`]
        : []),
    ...(session.detail.activity ? [`running ${session.detail.activity}`] : []),
    ...(session.detail.error ? [`error: ${session.detail.error}`] : []),
  ];
}

/**
 * The standing asks by the identity each is about, nested rather than keyed by
 * a composed string, so a roster line can carry the one ask that names it.
 */
function noticeAsksByIdentity(
  noticeAsks: readonly SessionNoticeAsk[],
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byProvider = new Map<string, Map<string, string>>();
  for (const noticeAsk of noticeAsks) {
    const providerAsks = byProvider.get(noticeAsk.providerId) ?? new Map<string, string>();
    providerAsks.set(noticeAsk.providerSessionId, noticeAsk.ask);
    byProvider.set(noticeAsk.providerId, providerAsks);
  }
  return byProvider;
}

/**
 * How a session is named out loud: the agent having the conversation, with
 * the hosting provider beside it where the two differ — "Claude Code in
 * Conductor" — so the spoken answer matches the mark the row leads with.
 */
function sessionSpokenName(session: NormalizedSession): string {
  return session.agent
    ? `${session.agent.displayName} in ${session.provider.displayName}`
    : session.provider.displayName;
}

/**
 * Renders the session roster the conversation is allowed to know about.
 *
 * These are the same bounded, redacted fields the attention layer already
 * sends — provider, title, status, when last seen, repository or branch,
 * current tool, reported error, and the provider's own recap — plus the
 * workspace a chat belongs to when its provider groups them, the apps that
 * independently associate themselves with it, the developer's
 * standing ask where one stands, what each session can be asked to do, and the
 * identity a tool call names it by. The newest session and newest openable
 * session within each provider are labelled explicitly, so a recency ask is a
 * selection rather than an ambiguity; those rows are also kept inside the
 * bound before the remaining roster fills it. No transcript, file path, or
 * command output is ever included.
 *
 * `now` is the wall clock against which each session's age is read. Pass
 * `Date.now()` for live use; pass a fixed epoch for reproducible fixture or
 * test snapshots.
 */
export function sessionContextText(
  sessions: readonly NormalizedSession[],
  noticeAsks: readonly SessionNoticeAsk[] = [],
  now: number = Date.now(),
): string {
  if (sessions.length === 0) return "No coding-agent sessions are currently observed.";

  const asks = noticeAsksByIdentity(noticeAsks);
  const mostRecent = firstSessionByProvider(sessions);
  const mostRecentOpenable = firstSessionByProvider(sessions, sessionCanOpen);
  const included = prioritizedContextSessions(sessions);
  const overflow = sessions.length - included.length;
  return [
    "Currently observed sessions:",
    ...included.map((session) => {
      const ask = asks.get(session.providerId)?.get(session.providerSessionId);
      return [
        // A hosted chat is named by the agent having the conversation, with
        // the host beside it, the same way its row leads with the agent mark.
        `- ${sessionSpokenName(session)}`,
        session.title,
        // The workspace tells siblings' chats apart out loud, so it rides
        // beside the title wherever a provider named one — and only by its
        // name: an internal workspace id identifies nothing out loud, so an
        // unnamed workspace goes unmentioned rather than leaking the id off
        // the machine, the same rule the attention update follows.
        ...(session.workspace?.name
          ? [
              `a chat in workspace ${session.workspace.name}${session.workspace.managerName ? ` managed by ${session.workspace.managerName}` : ""}`,
            ]
          : []),
        // An app that independently claims the session is how "my cmux Cursor
        // session" reads apart from the agent's other rows, so each
        // association rides by name — and only by name: the pane address
        // behind it stays on the machine, like every other link.
        ...(session.applications.length > 0
          ? [
              `associated with ${session.applications
                .map((application) => application.displayName)
                .join(" and ")}`,
            ]
          : []),
        session.status,
        sessionAgeText(session.observedAt, now),
        ...sessionAboutText(session),
        // Stating an absence in context invites the voice to speak it, so a
        // session without a recap simply omits the segment.
        ...(session.recap ? [session.recap] : []),
        // Only this segment speaks for the developer, on the attention
        // update's own rule: words inside a title, recap, or error never do.
        ...(ask ? [`the developer's standing ask: "${ask}"`] : []),
        `[${sessionCapabilityText(session, {
          mostRecentForProvider: mostRecent.get(session.providerId) === session,
          mostRecentOpenableForProvider: mostRecentOpenable.get(session.providerId) === session,
        })}]`,
      ].join(" — ");
    }),
    // A session past the bound must read as unlisted, never as nonexistent:
    // denying a session the panel plainly shows teaches the user that Luke
    // cannot be asked about their work at all.
    ...(overflow > 0
      ? [
          `(${overflow} more observed ${overflow === 1 ? "session is" : "sessions are"} not listed here; the panel shows them all.)`,
        ]
      : []),
  ].join("\n");
}

/**
 * The kinds of context a conversation is told, each of which answers exactly
 * one standing question: what Luke can see, what was already said across
 * calls, where he can create, what he knows about himself, and what the
 * tracker lists.
 *
 * A kind holds one live item at a time. Saying it again replaces the item that
 * said it before rather than adding a second answer beside the first, because
 * a conversation holding nine rosters is holding eight wrong ones — and paying
 * for all nine out of a window the developer's own turns are evicted from.
 */
export const CONTEXT_ITEM_KIND = {
  SESSIONS: "sessions",
  CONVERSATION: "conversation",
  WORKSPACE_PROJECTS: "workspace-projects",
  APP_GUIDE: "app-guide",
  ISSUES: "issues",
} as const;

export type ContextItemKind = (typeof CONTEXT_ITEM_KIND)[keyof typeof CONTEXT_ITEM_KIND];

/**
 * Names the item one context update will occupy, so the update after it has
 * something to delete. The Realtime API lets the client name an item on
 * creation, which is what makes a replacement possible without waiting to be
 * told the server's own name for it.
 *
 * The sequence rises rather than the name being reused: a delete that failed
 * would otherwise leave the old item sitting under the name the new one is
 * about to claim. This composes a wire identifier, not a lookup key — nothing
 * indexes on it, and both halves are the build's own.
 */
export function contextItemId(kind: ContextItemKind, sequence: number): string {
  return `luke_ctx_${kind}_${sequence}`;
}

/** Names the delete itself, so the error a failed one answers with is known as ours. */
export function contextSupersedeEventId(sequence: number): string {
  return `luke_supersede_${sequence}`;
}

/**
 * Builds the event that removes the context item a fresher one is replacing.
 *
 * Only ever aimed at an item this build named and created. Deleting an item
 * the conversation does not hold is answered with an error rather than
 * silence, which is why the event is named: the caller keeps the name and
 * knows the answer for its own rather than reporting it to the developer as a
 * fault in their call.
 */
export function contextSupersedeEvents(input: {
  itemId: string;
  eventId: string;
}): readonly WireRecord[] {
  if (!input.itemId.trim() || !input.eventId.trim()) return [];
  return [
    {
      type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_DELETE,
      event_id: input.eventId,
      item_id: input.itemId,
    },
  ];
}

/**
 * The conversation.item.create envelope every roster update travels in. A
 * user-role item is universally accepted by the Realtime API, and the explicit
 * label keeps it from reading as something the developer said.
 *
 * The item is named on creation so a fresher answer of the same kind can take
 * its place rather than pile up beside it.
 */
function labeledContextEvent(label: string, text: string, itemId: string): WireRecord {
  return {
    type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
    item: {
      id: itemId,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `[${label}]\n${text}` }],
    },
  };
}

/**
 * Builds the event that tells the conversation what Luke can currently see.
 *
 * Deliberately no `response.create`: this is context, not a prompt, so adding
 * it must never make Luke start talking. Without it the standing instructions
 * would claim Luke can see sessions it was never told about, and a spoken
 * question about live work could not be answered from real data.
 */
export function sessionContextEvents(
  sessions: readonly NormalizedSession[],
  itemId: string,
  noticeAsks: readonly SessionNoticeAsk[] = [],
  now: number = Date.now(),
): readonly WireRecord[] {
  return [
    labeledContextEvent(
      "observed session status, sent automatically",
      sessionContextText(sessions, noticeAsks, now),
      itemId,
    ),
  ];
}

/**
 * Builds the event that carries the conversation history — what was already
 * said and done across calls, rendered by the history module against the
 * roster as both now stand. It exists because the call that said a thing is
 * often not the call being asked about it: an announcement is read out on a
 * speak-only call the talk-key press tears down, and an idle call retires —
 * so the thread is re-fed to whichever call the developer opens next.
 * Context on the roster's own terms: never a prompt, so remembering what was
 * said must not make Luke say anything more.
 */
export function conversationContextEvents(text: string, itemId: string): readonly WireRecord[] {
  return [labeledContextEvent("recent conversation, sent automatically", text, itemId)];
}

/** How many issues one roster update may describe. */
export const maximumVoiceContextIssues = 15;

/**
 * What one issue can be asked to do, said in the roster so Luke offers only
 * what its tracker promised: the identity a tool call must name, the states
 * the tracker will accept it into, and whether it takes a comment.
 */
function issueCapabilityText(issue: TrackedIssue): string {
  const capabilities = [
    `tracker_id=${issue.trackerId} issue_id=${issue.identifier}`,
    `comments=${issue.canComment}`,
    ...(issue.transitions.length > 0
      ? [`states=${issue.transitions.map((transition) => transition.name).join(", ")}`]
      : []),
  ];
  return capabilities.join("; ");
}

/**
 * Renders the issue roster the conversation is allowed to know about: each
 * issue's identifier, title, and state, plus what its tracker will take for
 * it. These are the tracker's own bounded fields — no description, comment
 * thread, or attachment is ever included.
 */
export function issueContextText(issues: readonly TrackedIssue[]): string {
  if (issues.length === 0) return "The issue tracker lists no issues assigned to the developer.";

  return [
    "Tracked issues assigned to the developer:",
    ...issues
      .slice(0, maximumVoiceContextIssues)
      .map((issue) =>
        [
          `- ${issue.tracker.displayName}`,
          issue.identifier,
          issue.title,
          issue.stateName,
          `[${issueCapabilityText(issue)}]`,
        ].join(" — "),
      ),
  ].join("\n");
}

/**
 * Builds the event that tells the conversation what the tracker lists. Like
 * the session roster it is context, not a prompt — deliberately no
 * `response.create`, so an updated board never makes Luke start talking.
 */
export function issueContextEvents(
  issues: readonly TrackedIssue[],
  itemId: string,
): readonly WireRecord[] {
  return [
    labeledContextEvent(
      "observed issue tracker, sent automatically",
      issueContextText(issues),
      itemId,
    ),
  ];
}

/**
 * Builds the event that withdraws the issue roster. A tracker whose key was
 * removed stops being observed, and a conversation still holding the old
 * board would keep answering from it — so the disconnection is news the same
 * way the roster was, and just as deliberately not a prompt.
 */
export const ISSUE_TRACKER_DISCONNECTED_TEXT = "The issue tracker is no longer connected.";

export function issueTrackerDisconnectedEvents(itemId: string): readonly WireRecord[] {
  return [
    labeledContextEvent(
      "observed issue tracker, sent automatically",
      ISSUE_TRACKER_DISCONNECTED_TEXT,
      itemId,
    ),
  ];
}

/** How many projects one context update may offer workspace creation in. */
export const maximumVoiceContextWorkspaceProjects = 10;

/**
 * Renders the projects a creation ask may name: each with the identity a tool
 * call names it by, and nothing else. The list is what a call is validated
 * against, so an empty one is said in words too — a conversation told nothing
 * would otherwise be free to imagine somewhere.
 *
 * The default provider rides with the list because it is the list's own
 * tie-break: an ask that names no provider goes to the default when one is
 * chosen and offering, and while none is chosen the context says that the
 * first creation decides — the saving itself is the main process's, done on
 * the validated act, so the sentence here is a description and never a lever.
 * The default projects ride on the same terms, one tie-break per provider:
 * an ask that names no project goes to that provider's default when one is
 * chosen and still offered.
 */
export function workspaceProjectContextText(
  projects: readonly ObservedWorkspaceProject[],
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
): string {
  if (projects.length === 0) return "No provider currently offers workspace creation.";
  const listed = listedWorkspaceProjects(projects, defaultProjectIds);
  // The default is said by id, never by name alone: two providers may share a
  // name's first word (Conductor and Conductor (local) today), and a default
  // the conversation cannot bind to one provider_id is a question it will ask
  // the developer instead. Whether it is offering is judged against everything
  // offered, not the capped slice below, or the sentence would disown a
  // default the validator still honors.
  const chosenDefault = projects.find((project) => project.providerId === defaultProviderId);
  return [
    "Projects a new workspace can be created in:",
    ...listed.map(
      (project) =>
        `- ${project.providerName} — ${project.repository}${project.targetName ? ` on ${project.targetName}` : ""} [provider_id=${project.providerId} project_id=${project.providerProjectId}${project.providerTargetId ? ` target_id=${project.providerTargetId}` : ""}]; ${TASK_SUPPORT_TEXT[project.taskSupport]}${defaultProjectIds?.[project.providerId] === workspaceProjectSelectionId(project) ? "; the provider's default project" : ""}${project.spawnableAgents?.length ? `; agents: ${project.spawnableAgents.join(", ")}${project.defaultAgent ? `; default agent: ${project.defaultAgent}` : ""}` : ""}`,
    ),
    chosenDefault
      ? `An ask that names no provider creates in ${chosenDefault.providerName} [provider_id=${chosenDefault.providerId}]; do not ask which provider unless the ask names a different one.`
      : defaultProviderId
        ? "The chosen default provider is not currently offering; ask which project when more than one could take the ask."
        : "No default provider is chosen yet; ask which project when more than one could take the ask, and the first workspace created saves its provider as the default.",
  ].join("\n");
}

/**
 * The bounded slice the conversation is shown, kept default-aware: a chosen
 * default project that survived observation must survive this cap too, or
 * the alphabetical order could push the one project a nameless ask should
 * land in off the list — unnamed, unlisted, and unsteerable. Each provider's
 * chosen default rides past the cut instead, so the cap still bounds the
 * list at the maximum plus at most one project per provider.
 */
function listedWorkspaceProjects(
  projects: readonly ObservedWorkspaceProject[],
  defaultProjectIds: Readonly<Partial<Record<string, string>>> | undefined,
): readonly ObservedWorkspaceProject[] {
  const listed = projects.slice(0, maximumVoiceContextWorkspaceProjects);
  for (const project of projects.slice(maximumVoiceContextWorkspaceProjects)) {
    if (defaultProjectIds?.[project.providerId] === workspaceProjectSelectionId(project)) {
      listed.push(project);
    }
  }
  return listed;
}

/**
 * How each support level reads in the projects list. Said beside the identity
 * so the ask and its validation share one vocabulary: the sentence Luke reads
 * is the rule the call is held to.
 */
const TASK_SUPPORT_TEXT = {
  [WORKSPACE_TASK_SUPPORT.NONE]: "takes no task",
  [WORKSPACE_TASK_SUPPORT.OPTIONAL]: "takes an opening task",
  [WORKSPACE_TASK_SUPPORT.REQUIRED]: "needs an opening task",
} satisfies Record<WorkspaceTaskSupport, string>;

/**
 * Builds the event that tells the conversation where a workspace can be
 * created. The same shape as the roster, for the same reason: context, never
 * a prompt, so arriving must not open Luke's mouth.
 */
export function workspaceProjectContextEvents(
  projects: readonly ObservedWorkspaceProject[],
  itemId: string,
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
): readonly WireRecord[] {
  return [
    labeledContextEvent(
      "workspace projects, sent automatically",
      workspaceProjectContextText(projects, defaultProviderId, defaultProjectIds),
      itemId,
    ),
  ];
}

/**
 * Builds the event that tells the conversation what the app knows about
 * itself. The same shape as the session roster, for the same reason: the
 * standing instructions describe a guide, so one has to actually arrive, and
 * it must never open Luke's mouth by itself — context, not a prompt.
 */
export function appGuideContextEvents(
  guide: AppGuideSnapshot,
  itemId: string,
): readonly WireRecord[] {
  return [labeledContextEvent("app guide, sent automatically", appGuideContextText(guide), itemId)];
}
