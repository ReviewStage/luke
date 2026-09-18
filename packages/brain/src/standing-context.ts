import { DAY_MS } from "@sidecar/runtime/vocabulary";
import {
  ACTION_KIND,
  advertisedActionFor,
  advertisedControls,
  type ObservedWorkspaceProject,
  SESSION_COMPLETION_CAUSE,
  type Session,
  type SessionCompletionCause,
  type SessionIdentity,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceTaskSupport,
  workspaceProjectSelectionId,
} from "@sidecar/session";

/**
 * Roster context serialization: the bounded, redacted view of sessions and
 * workspace projects a model is allowed to know about. It is a view composed
 * for a window rather than the roster itself, which is why it lives here and
 * not with the session vocabulary it reads. On the desktop it is the brain's
 * standing context; on a remote call it is the roster item the call is sent.
 * Context, never a prompt.
 */

/**
 * How many sessions one context update may describe. A session the roster
 * omits is one Luke denies exists, and eight Conductor workspaces beside a
 * few local agents overflowed the original ten, so the bound is set past any
 * roster the adapters' own caps can produce; every line is already bounded,
 * so the update stays a bounded read either way.
 */
export const maximumVoiceContextSessions = 25;

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

/**
 * What one session can be asked to do, so Luke offers only what its provider
 * promised: the identity a tool call must name, whether it takes a message,
 * each advertised control with the id a call names it by, and each app an
 * open ask may pick — by name alone, because the address behind it stays on
 * the machine.
 */
function sessionCapabilityText(session: Session, recency: SessionRecency): string {
  const openableApplications = session.applications.filter(
    (application) => application.link !== undefined,
  );
  const controls = advertisedControls(session);
  const addAgent = advertisedActionFor(session, ACTION_KIND.ADD_AGENT);
  const capabilities = [
    `provider_id=${session.providerId} provider_session_id=${session.providerSessionId}`,
    `messages=${advertisedActionFor(session, ACTION_KIND.MESSAGE) !== undefined}`,
    `open=${Boolean(session.detail.link)}`,
    ...(openableApplications.length > 0
      ? [
          `opens_in=${openableApplications
            .map((application) => application.displayName)
            .join(", ")}`,
        ]
      : []),
    ...(recency.mostRecentForProvider ? ["most_recent_for_provider=true"] : []),
    ...(recency.mostRecentOpenableForProvider ? ["most_recent_openable_for_provider=true"] : []),
    ...(session.detail.change ? ["pull_request=true"] : []),
    ...(controls.length > 0
      ? [`controls=${controls.map((control) => `${control.label} (${control.id})`).join(", ")}`]
      : []),
    ...(addAgent ? [`agents=${addAgent.agents.join(", ")}`] : []),
    // Each capability travels as a fact and never a target: the identity is
    // what a rename ask names, and what it lands on stays resolved from
    // observed state on the machine.
    ...(advertisedActionFor(session, ACTION_KIND.RENAME_SESSION) ? ["chat can be renamed"] : []),
    ...(advertisedActionFor(session, ACTION_KIND.RENAME_WORKSPACE)
      ? ["workspace can be renamed"]
      : []),
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
const AGE_BUCKET = {
  JUST_NOW: "just_now",
  MINUTES: "minutes",
  ABOUT_AN_HOUR: "about_an_hour",
  HOURS: "hours",
  DAY_OR_MORE: "day_or_more",
} as const;

type AgeBucket = (typeof AGE_BUCKET)[keyof typeof AGE_BUCKET];

const SESSION_AGE_TEXT = {
  [AGE_BUCKET.JUST_NOW]: "updated just now",
  [AGE_BUCKET.MINUTES]: "updated minutes ago",
  [AGE_BUCKET.ABOUT_AN_HOUR]: "updated about an hour ago",
  [AGE_BUCKET.HOURS]: "updated hours ago",
  [AGE_BUCKET.DAY_OR_MORE]: "updated a day or more ago",
} as const satisfies Record<AgeBucket, string>;

/** The same buckets for a briefing's age, read as when it was given rather than when a session moved. */
const BRIEFING_AGE_TEXT = {
  [AGE_BUCKET.JUST_NOW]: "just now",
  [AGE_BUCKET.MINUTES]: "minutes ago",
  [AGE_BUCKET.ABOUT_AN_HOUR]: "about an hour ago",
  [AGE_BUCKET.HOURS]: "hours ago",
  [AGE_BUCKET.DAY_OR_MORE]: "a day or more ago",
} as const satisfies Record<AgeBucket, string>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function ageBucket(instant: number, now: number): AgeBucket {
  const elapsed = now - instant;
  if (elapsed < 5 * MINUTE_MS) return AGE_BUCKET.JUST_NOW;
  if (elapsed < HOUR_MS) return AGE_BUCKET.MINUTES;
  if (elapsed < 2 * HOUR_MS) return AGE_BUCKET.ABOUT_AN_HOUR;
  if (elapsed < DAY_MS) return AGE_BUCKET.HOURS;
  return AGE_BUCKET.DAY_OR_MORE;
}

function sessionAgeText(lastActivityAt: number, now: number): string {
  return SESSION_AGE_TEXT[ageBucket(lastActivityAt, now)];
}

/**
 * How a waiting session that cannot continue without the developer reads: one
 * fixed phrase, never the provider's own words for the permission, approval,
 * or question it reported. A waiting session whose adapter could not tell
 * carries no phrase and reads as waiting alone, so an idle turn end and a
 * tool call holding for permission are told apart on the line itself.
 */
const HOLDING_FOR_DEVELOPER_TEXT = "holding for your permission or answer";

/**
 * Why a complete session became complete, where its provider could say. A
 * chat the developer closed is not a turn that finished, and the two are news
 * of different kinds: one is work to report, the other the developer's own
 * hand. A provider that could not tell reports no cause and says nothing here.
 */
const COMPLETION_CAUSE_TEXT = {
  [SESSION_COMPLETION_CAUSE.WORK_FINISHED]: "finished its work",
  [SESSION_COMPLETION_CAUSE.SESSION_CLOSED]: "the chat was closed",
} as const satisfies Record<SessionCompletionCause, string>;

/**
 * The checkout, current tool, reported failure, hold, and completion cause a
 * session's line carries — the same bounded about-fields the panel draws,
 * worded as short labelled phrases so Luke can say what a session is doing or
 * stuck on rather than only that it works or waits.
 */
function sessionAboutText(session: Session): readonly string[] {
  return [
    ...(session.holdingForDeveloper === true ? [HOLDING_FOR_DEVELOPER_TEXT] : []),
    ...(session.completionCause ? [COMPLETION_CAUSE_TEXT[session.completionCause]] : []),
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
 * provider, title, status, when last seen, whether a wait holds for the
 * developer, why a complete chat ended, repository or branch,
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
    // The internal names are said once, in this one header line: a caveat
    // repeated on every row costs more than it teaches, and the header stays
    // one line so a row is a line.
    "Currently observed sessions. The title and workspace name on a row are internal names — read them to tell the sessions apart, never to refer to the work out loud:",
    ...included.map((session) => {
      return [
        // A hosted chat is named by the agent having the conversation, with
        // the host beside it, the same way its row leads with the agent mark.
        `- ${sessionSpokenName(session)}`,
        `title: ${session.title}`,
        // The workspace tells siblings' chats apart out loud, so it rides
        // beside the title wherever a provider named one — and only by its
        // name: an internal workspace id identifies nothing out loud, so an
        // unnamed workspace goes unmentioned rather than leaking the id off
        // the machine, the same rule every observed value follows.
        ...(session.workspace?.name
          ? [
              `workspace: ${session.workspace.name}${session.workspace.managerName ? ` managed by ${session.workspace.managerName}` : ""}`,
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

/** How many projects one context update may offer workspace creation in. */
const maximumVoiceContextWorkspaceProjects = 10;

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
 * the validated action, so the sentence here is a description and never a lever.
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

/**
 * One briefing Luke gave from an observed session's conversation, as the
 * store found it: when it was offered, which session it was about, and the
 * words the announce call carried.
 */
export interface RecentBriefing {
  readonly announcedAt: number;
  readonly session: SessionIdentity;
  /** What the roster called the session when the briefing was given, or nothing where it had no name. */
  readonly title: string | undefined;
  readonly words: string;
}

/** How many briefings one context update may recall; older ones are history the roster and the transcript reads cover. */
export const maximumRecentBriefings = 8;

const UNTITLED_BRIEFING_SESSION = "untitled session";

/** A briefing as one line: its whitespace folded so a line stays a line. */
function briefingLineText(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}

/**
 * Renders the briefings Luke gave recently from observed conversations, so
 * main's turn knows what the developer has been told and which session each
 * was about: an observed conversation's turns are that conversation's own
 * history, and nothing else carries its briefing into main. Newest last, as
 * the history reads, and at most the bound; nothing at all for none, so the
 * section is absent rather than empty. The age is the roster's coarse
 * buckets for the roster's reason: the block travels every turn, and a line
 * that reworded itself each minute would say nothing new.
 */
export function recentBriefingsContextText(
  briefings: readonly RecentBriefing[],
  now: number,
): string | undefined {
  if (briefings.length === 0) return undefined;
  const listed = [...briefings]
    .sort((left, right) => left.announcedAt - right.announcedAt)
    .slice(-maximumRecentBriefings);
  return [
    "Briefings you gave the developer in the last day, newest last. Each names the session it was about, so a follow-up that refers to one can act on that session without looking it up:",
    ...listed.map(
      (briefing) =>
        `- ${BRIEFING_AGE_TEXT[ageBucket(briefing.announcedAt, now)]} — ${briefing.title ?? UNTITLED_BRIEFING_SESSION} [provider_id=${briefing.session.providerId} provider_session_id=${briefing.session.providerSessionId}] — "${briefingLineText(briefing.words)}"`,
    ),
  ].join("\n");
}
