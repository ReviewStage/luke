import { type AppGuideSnapshot, appGuideContextText } from "./guide";
import type { TrackedIssue } from "./issues";
import { type ObservedWorkspaceProject, WORKSPACE_TASK_SUPPORT } from "./providers";
import { REALTIME_CLIENT_EVENT } from "./realtime-protocol";
import type { NormalizedSession } from "./session";

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
 * takes a message, and each advertised control with the id a call names it by.
 */
function sessionCapabilityText(session: NormalizedSession): string {
  const capabilities = [
    `provider_id=${session.providerId} provider_session_id=${session.providerSessionId}`,
    session.canReceiveMessage ? "takes messages" : "takes no messages",
    // Openability is the link's presence, never the link: an address has no
    // business in a conversation when the identity is what a tool call names.
    session.detail.link ? "can be opened" : "cannot be opened",
    ...(session.controls.length > 0
      ? [
          `controls: ${session.controls.map((control) => `${control.label} (${control.id})`).join(", ")}`,
        ]
      : []),
    ...(session.spawnableAgents.length > 0
      ? [`new agents: ${session.spawnableAgents.join(", ")}`]
      : []),
  ];
  return capabilities.join("; ");
}

/**
 * Renders the session roster the conversation is allowed to know about.
 *
 * These are the same bounded, redacted fields the attention layer already
 * sends — provider, title, status, and the provider's own recap — plus the
 * workspace a chat belongs to when its provider groups them, what each
 * session can be asked to do, and the identity a tool call names it by.
 * No transcript, file path, or command output is ever included.
 */
export function sessionContextText(sessions: readonly NormalizedSession[]): string {
  if (sessions.length === 0) return "No coding-agent sessions are currently observed.";

  const overflow = sessions.length - maximumVoiceContextSessions;
  return [
    "Currently observed sessions:",
    ...sessions.slice(0, maximumVoiceContextSessions).map((session) =>
      [
        `- ${session.provider.displayName}`,
        session.title,
        // The workspace tells siblings' chats apart out loud, so it rides
        // beside the title wherever a provider named one — and only by its
        // name: an internal workspace id identifies nothing out loud, so an
        // unnamed workspace goes unmentioned rather than leaking the id off
        // the machine, the same rule the attention update follows.
        ...(session.workspace?.name ? [`a chat in workspace ${session.workspace.name}`] : []),
        session.status,
        session.recap ?? "no recap reported",
        `[${sessionCapabilityText(session)}]`,
      ].join(" — "),
    ),
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
 * The conversation.item.create envelope every roster update travels in. A
 * user-role item is universally accepted by the Realtime API, and the explicit
 * label keeps it from reading as something the developer said.
 */
function labeledContextEvent(label: string, text: string): Record<string, unknown> {
  return {
    type: REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE,
    item: {
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
): readonly Record<string, unknown>[] {
  return [
    labeledContextEvent(
      "observed session status, sent automatically",
      sessionContextText(sessions),
    ),
  ];
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
    issue.canComment ? "takes comments" : "takes no comments",
    ...(issue.transitions.length > 0
      ? [`states: ${issue.transitions.map((transition) => transition.name).join(", ")}`]
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
): readonly Record<string, unknown>[] {
  return [
    labeledContextEvent("observed issue tracker, sent automatically", issueContextText(issues)),
  ];
}

/**
 * Builds the event that withdraws the issue roster. A tracker whose key was
 * removed stops being observed, and a conversation still holding the old
 * board would keep answering from it — so the disconnection is news the same
 * way the roster was, and just as deliberately not a prompt.
 */
export function issueTrackerDisconnectedEvents(): readonly Record<string, unknown>[] {
  return [
    labeledContextEvent(
      "observed issue tracker, sent automatically",
      "The issue tracker is no longer connected. Disregard earlier issue rosters.",
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
  return [
    "Projects a new workspace can be created in:",
    ...listed.map(
      (project) =>
        `- ${project.providerName} — ${project.repository} [provider_id=${project.providerId} project_id=${project.providerProjectId}]; ${TASK_SUPPORT_TEXT[project.taskSupport]}`,
    ),
    ...workspaceDefaultProviderLines(listed, defaultProviderId),
    ...workspaceDefaultProjectLines(listed, defaultProjectIds),
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
    if (defaultProjectIds?.[project.providerId] === project.providerProjectId) {
      listed.push(project);
    }
  }
  return listed;
}

/**
 * How the default provider reads under the projects list. A default that is
 * chosen but not currently offering earns no line at all: it is not a place
 * an ask can go, and the choice already made must not be presented as still
 * open — only a developer who has never chosen is told the first creation
 * chooses for them.
 */
function workspaceDefaultProviderLines(
  projects: readonly ObservedWorkspaceProject[],
  defaultProviderId: string | undefined,
): readonly string[] {
  const chosen = defaultProviderId
    ? projects.find((project) => project.providerId === defaultProviderId)
    : undefined;
  if (chosen) {
    return [
      `The developer's default provider for new workspaces is ${chosen.providerName}: an ask that names no provider creates there.`,
    ];
  }
  if (defaultProviderId) return [];
  const providers = new Set(projects.map((project) => project.providerId));
  return [
    providers.size > 1
      ? "No default provider is chosen yet: when an ask names no provider, ask which listed provider it should be. The first workspace created saves its provider as the developer's default."
      : "No default provider is chosen yet: the first workspace created saves its provider as the developer's default.",
  ];
}

/**
 * How each provider's default project reads under the projects list, on the
 * provider default's own terms. A default that is chosen but no longer
 * offered earns no line at all; a provider with exactly one project earns
 * none either while nothing is chosen, because there is nothing to steer —
 * only a provider actually offering a choice is said to be decided by the
 * first creation there.
 */
function workspaceDefaultProjectLines(
  projects: readonly ObservedWorkspaceProject[],
  defaultProjectIds: Readonly<Partial<Record<string, string>>> | undefined,
): readonly string[] {
  const lines: string[] = [];
  const said = new Set<string>();
  for (const project of projects) {
    if (said.has(project.providerId)) continue;
    said.add(project.providerId);
    const offered = projects.filter((candidate) => candidate.providerId === project.providerId);
    const chosenId = defaultProjectIds?.[project.providerId];
    const chosen = chosenId
      ? offered.find((candidate) => candidate.providerProjectId === chosenId)
      : undefined;
    if (chosen) {
      lines.push(
        `The developer's default ${chosen.providerName} project is ${chosen.repository}: an ask that names no project creates there.`,
      );
    } else if (chosenId === undefined && offered.length > 1) {
      lines.push(
        `No default ${project.providerName} project is chosen yet: when an ask names no project there, ask which listed project it should be. The first workspace created in ${project.providerName} saves its project as the default.`,
      );
    }
  }
  return lines;
}

/**
 * How each support level reads in the projects list. Said beside the identity
 * so the ask and its validation share one vocabulary: the sentence Luke reads
 * is the rule the call is held to.
 */
const TASK_SUPPORT_TEXT: Readonly<Record<string, string>> = {
  [WORKSPACE_TASK_SUPPORT.NONE]: "takes no task",
  [WORKSPACE_TASK_SUPPORT.OPTIONAL]: "takes an opening task",
  [WORKSPACE_TASK_SUPPORT.REQUIRED]: "needs an opening task",
};

/**
 * Builds the event that tells the conversation where a workspace can be
 * created. The same shape as the roster, for the same reason: context, never
 * a prompt, so arriving must not open Luke's mouth.
 */
export function workspaceProjectContextEvents(
  projects: readonly ObservedWorkspaceProject[],
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
): readonly Record<string, unknown>[] {
  return [
    labeledContextEvent(
      "workspace projects, sent automatically",
      workspaceProjectContextText(projects, defaultProviderId, defaultProjectIds),
    ),
  ];
}

/**
 * Builds the event that tells the conversation what the app knows about
 * itself. The same shape as the session roster, for the same reason: the
 * standing instructions describe a guide, so one has to actually arrive, and
 * it must never open Luke's mouth by itself — context, not a prompt.
 */
export function appGuideContextEvents(guide: AppGuideSnapshot): readonly Record<string, unknown>[] {
  return [labeledContextEvent("app guide, sent automatically", appGuideContextText(guide))];
}
