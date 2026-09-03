import {
  type ObservedWorkspaceProject,
  SESSION_LOCATION,
  type Session,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceTaskSupport,
  workspaceProjectSelectionId,
} from "@sidecar/session";

/**
 * Roster context serialization: the bounded, redacted view of sessions and
 * workspace projects a model is allowed to know about. On the desktop it is
 * the brain's standing context; on a remote call it is the roster item the
 * call is sent. Context, never a prompt.
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

function sessionCanOpen(session: Session): boolean {
  return (
    session.detail.link !== undefined ||
    session.applications.some((application) => application.link !== undefined)
  );
}

function sessionCapabilityText(session: Session, recency: SessionRecency): string {
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
  sessions: readonly Session[],
  predicate: (session: Session) => boolean = () => true,
): ReadonlyMap<string, Session> {
  const newest = new Map<string, Session>();
  for (const session of sessions) {
    if (!predicate(session)) continue;
    const current = newest.get(session.providerId);
    if (!current || session.lastActivityAt > current.lastActivityAt)
      newest.set(session.providerId, session);
  }
  return newest;
}

function prioritizedContextSessions(sessions: readonly Session[]): readonly Session[] {
  const mostRecent = firstSessionByProvider(sessions);
  const mostRecentOpenable = firstSessionByProvider(sessions, sessionCanOpen);
  const prioritized = new Set<Session>([
    ...mostRecentOpenable.values(),
    ...mostRecent.values(),
    ...sessions,
  ]);
  return [...prioritized].slice(0, maximumVoiceContextSessions);
}

/**
 * How long ago the provider last wrote about this session, in coarse buckets.
 * "Updated" names what `lastActivityAt` measures — the provider's own last
 * write — without implying anything about the session's current activity
 * level, which the status field already covers.
 *
 * Coarse deliberately: the roster travels again only when its text changes,
 * and an unchanged item is what keeps the conversation's cached prefix warm —
 * so the phrase must hold still across pure clock ticks and move only at a
 * bucket edge a session actually crossed. An exact age would reword the whole
 * roster every minute a stale session merely sat there, and the buckets are
 * wide enough that an ordinary conversation crosses few edges.
 */
const SESSION_AGE_TEXT = {
  JUST_NOW: "updated just now",
  MINUTES: "updated minutes ago",
  ABOUT_AN_HOUR: "updated about an hour ago",
  HOURS: "updated hours ago",
  DAY_OR_MORE: "updated a day or more ago",
} as const;

type SessionAgeText = (typeof SESSION_AGE_TEXT)[keyof typeof SESSION_AGE_TEXT];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function sessionAgeText(lastActivityAt: number, now: number): SessionAgeText {
  const elapsed = now - lastActivityAt;
  if (elapsed < 5 * MINUTE_MS) return SESSION_AGE_TEXT.JUST_NOW;
  if (elapsed < HOUR_MS) return SESSION_AGE_TEXT.MINUTES;
  if (elapsed < 2 * HOUR_MS) return SESSION_AGE_TEXT.ABOUT_AN_HOUR;
  if (elapsed < DAY_MS) return SESSION_AGE_TEXT.HOURS;
  return SESSION_AGE_TEXT.DAY_OR_MORE;
}

/**
 * The checkout, current tool, and reported failure a session's line carries —
 * the same bounded about-fields the panel draws, worded as short labelled
 * phrases so Luke can say what a session is doing or stuck on rather than
 * only that it works or waits.
 */
function sessionAboutText(session: Session): readonly string[] {
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
 * How a session is named out loud: the agent having the conversation, with
 * the hosting provider beside it where the two differ — "Claude Code in
 * Conductor" — so the spoken answer matches the mark the row leads with.
 */
function sessionSpokenName(session: Session): string {
  return session.agent
    ? `${session.agent.displayName} in ${session.provider.displayName}`
    : session.provider.displayName;
}

/**
 * Renders the session roster the conversation is allowed to know about.
 *
 * These are the same bounded, redacted fields the panel already draws —
 * provider, title, status, when last seen, repository or branch,
 * current tool, and reported error — plus the
 * workspace a chat belongs to when its provider groups them, the apps that
 * independently associate themselves with it, what each session can be asked to do, and the
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
export function sessionContextText(sessions: readonly Session[], now: number = Date.now()): string {
  if (sessions.length === 0) return "No coding-agent sessions are currently observed.";

  const mostRecent = firstSessionByProvider(sessions);
  const mostRecentOpenable = firstSessionByProvider(sessions, sessionCanOpen);
  const included = prioritizedContextSessions(sessions);
  const overflow = sessions.length - included.length;
  return [
    "Currently observed sessions:",
    ...included.map((session) => {
      return [
        // A hosted chat is named by the agent having the conversation, with
        // the host beside it, the same way its row leads with the agent mark.
        `- ${sessionSpokenName(session)}`,
        `internal session name — never use to refer to the work: ${session.title}`,
        // The workspace tells siblings' chats apart out loud, so it rides
        // beside the title wherever a provider named one — and only by its
        // name: an internal workspace id identifies nothing out loud, so an
        // unnamed workspace goes unmentioned rather than leaking the id off
        // the machine, the same rule every observed value follows.
        ...(session.workspace?.name
          ? [
              `internal workspace name — never use to refer to the work: ${session.workspace.name}${session.workspace.managerName ? ` managed by ${session.workspace.managerName}` : ""}`,
            ]
          : []),
        // An app that independently claims the session is how "my Superset Codex
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
        sessionAgeText(session.lastActivityAt, now),
        ...sessionAboutText(session),
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
 * The kinds of context a remote call is told, each answering one standing
 * question. The desktop's call is told none of them: its roster, history, and
 * projects are the brain's, and the voice reaches them through its one tool.
 */
export const CONTEXT_ITEM_KIND = {
  SESSIONS: "sessions",
  CONVERSATION: "conversation",
  MEMORY: "memory",
  WORKSPACE_PROJECTS: "workspace-projects",
} as const;

export type ContextItemKind = (typeof CONTEXT_ITEM_KIND)[keyof typeof CONTEXT_ITEM_KIND];

/**
 * Names the item one context update occupies on a call that still carries
 * context items — the remote call, until it too is given a brain. Nothing
 * indexes on the name; both halves are the build's own.
 */
export function contextItemId(kind: ContextItemKind, sequence: number): string {
  return `luke_ctx_${kind}_${sequence}`;
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
        `- ${project.providerName} — ${project.repository}${project.targetName ? ` on ${project.targetName}` : ""} [provider_id=${project.providerId} project_id=${project.providerProjectId}${project.providerTargetId ? ` target_id=${project.providerTargetId}` : ""}]; ${TASK_SUPPORT_TEXT[project.taskSupport]}${project.namesItself ? "; names its own workspaces" : ""}${defaultProjectIds?.[project.providerId] === workspaceProjectSelectionId(project) ? "; the provider's default project" : ""}${project.spawnableAgents?.length ? `; agents: ${project.spawnableAgents.join(", ")}${project.defaultAgent ? `; default agent: ${project.defaultAgent}` : ""}` : ""}`,
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
