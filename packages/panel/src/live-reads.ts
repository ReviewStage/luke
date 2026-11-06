import {
  BROWSER_TABS_PLACE,
  type BrowserTabsPlace,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  type AgentInboxScope,
  type AgentPullRequestReadParams,
  type AgentTranscriptKey,
  agentInboxScopeSchema,
  PULL_REQUEST_PART,
  type PullRequestPart,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import { AUTOMATION_FOLLOW, type AutomationFollow } from "@repo/features/automation-view";
import type { IntegrationProviderParams } from "@repo/features/integration-view";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PagePlace } from "@repo/features/page-wire";
import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
import {
  COMMENT_SUBJECT,
  type TasksCommentsFollow,
  type TasksLinkStandingParams,
  tasksCommentsFollowSchema,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppHostReads,
  type AppStateSnapshot,
  EVERY_WORKSPACE,
  HOST_READ_SLICE,
  KEYS_ON,
  OWN_PULL_REQUEST,
  OWN_TRANSCRIPT,
  READ_KEYS,
} from "@repo/host/app-state";
import { type Query, type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useEffect } from "react";
import { askAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { streamFrom } from "./act-stream.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise } from "./renderer-runtime.js";
import { appStateQuery } from "./use-app-state.js";

type LiveReadName = keyof AppHostReads;

type LiveReadId = string | number;

type LiveReadKey<Read extends LiveReadName> = readonly [Read, ...LiveReadId[]];

export class LiveReadFailed extends Error {
  constructor(readonly read: LiveReadName) {
    super(`The host could not read ${read}.`);
    this.name = "LiveReadFailed";
  }
}

type InboxHolderKey = AgentInboxScope;

type LinkStandingKey = TasksLinkStandingParams;

const readHolder = Schema.decodeUnknownSync(agentInboxScopeSchema);

type LiveFollow = (
  ids: readonly LiveReadId[],
  meta: Readonly<Record<string, unknown>> | undefined,
) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>;

export type CommentSubject = TasksCommentsFollow;

const readCommentSubject = Schema.decodeUnknownSync(tasksCommentsFollowSchema);

function pullRequestAskedOf([agentId, number]: readonly LiveReadId[]): AgentPullRequestReadParams {
  return typeof number === "number"
    ? { agentId: String(agentId), number }
    : { agentId: String(agentId) };
}

function pullRequestPartFollow(part: PullRequestPart): LiveFollow {
  return (ids) =>
    askAct(ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW, { part, ...pullRequestAskedOf(ids) });
}

export type IntegrationServer = Pick<IntegrationProviderParams, "provider" | "connection">;

export function integrationServerOf(name: string): IntegrationServer | undefined {
  const provider = integrationConnectionOf(name)?.provider;
  if (provider === undefined) return undefined;
  return name === provider ? { provider } : { provider, connection: name };
}

export function repositoryScope(workspace: string): { readonly workspaceId?: string } {
  return workspace === EVERY_WORKSPACE ? {} : { workspaceId: workspace };
}

function automationsFollow(kind: AutomationFollow["kind"]): LiveFollow {
  return ([id = ""]) => askAct(ACT_KIND.AUTOMATIONS_FOLLOW, { kind, id: String(id) });
}

function integrationToolsFollow(name: string): ReturnType<LiveFollow> {
  const server = integrationServerOf(name);
  return server === undefined
    ? Promise.reject(new Error(`No integration server is named ${name}.`))
    : askAct(ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW, server);
}

const LIVE_FOLLOWS: { readonly [Read in LiveReadName]?: LiveFollow } = {
  [LIVE_READ.MODELS]: () => askAct(ACT_KIND.AGENTS_MODELS_FOLLOW),
  [LIVE_READ.PROVIDER_KEYS]: () => askAct(ACT_KIND.PROVIDER_KEYS_FOLLOW),
  [LIVE_READ.GITHUB_TOKEN]: () => askAct(ACT_KIND.GITHUB_TOKEN_FOLLOW),
  [LIVE_READ.DEVICE_PRESENCE]: () => askAct(ACT_KIND.HOSTS_PRESENCE_FOLLOW),
  [LIVE_READ.HOSTS]: () => askAct(ACT_KIND.HOSTS_FOLLOW),
  [LIVE_READ.AGENT_ORIGINS]: ([agentId = ""]) =>
    askAct(ACT_KIND.AGENTS_ORIGIN_FOLLOW, { agentId: String(agentId) }),
  [LIVE_READ.HOLDER_INBOX]: ([kind, id]) =>
    askAct(ACT_KIND.AGENTS_INBOX_FOLLOW, readHolder({ kind, id })),
  [LIVE_READ.LINK_STANDINGS]: ([workspaceId = "", address = ""]) =>
    askAct(ACT_KIND.TASKS_LINK_STANDING_FOLLOW, {
      workspaceId: String(workspaceId),
      address: String(address),
    }),
  [LIVE_READ.PAGES]: ([owner, id = ""]) =>
    askAct(
      ACT_KIND.TASKS_PAGES_FOLLOW,
      owner === PAGE_OWNER.TASK ? { taskId: String(id) } : { agentId: String(id) },
    ),
  [LIVE_READ.BROWSER_TABS]: ([kind, id = ""]) =>
    askAct(
      ACT_KIND.TASKS_BROWSER_TABS_FOLLOW,
      kind === BROWSER_TABS_PLACE.TASK ? { taskId: String(id) } : { agentId: String(id) },
    ),
  [LIVE_READ.DESCRIPTION_DOCUMENT]: ([taskId = ""]) =>
    askAct(ACT_KIND.TASKS_DOCUMENT_FOLLOW, { taskId: String(taskId) }),
  [LIVE_READ.DESCRIPTION_COMMENTS]: (_ids, meta) =>
    askAct(ACT_KIND.TASKS_COMMENTS_FOLLOW, readCommentSubject(meta?.follow)),
  [LIVE_READ.PULL_REQUEST]: pullRequestPartFollow(PULL_REQUEST_PART.PULL_REQUEST),
  [LIVE_READ.PULL_REQUEST_CHECKS]: pullRequestPartFollow(PULL_REQUEST_PART.CHECKS),
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: pullRequestPartFollow(PULL_REQUEST_PART.CONVERSATION),
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: pullRequestPartFollow(PULL_REQUEST_PART.PUBLISHED),
  [LIVE_READ.PULL_REQUEST_VIEWED]: pullRequestPartFollow(PULL_REQUEST_PART.VIEWED),
  [LIVE_READ.REVIEW_OPTIONS]: pullRequestPartFollow(PULL_REQUEST_PART.REVIEW_OPTIONS),
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: ([agentId, number]) =>
    askAct(ACT_KIND.CHAPTERS_FOLLOW, { agentId: String(agentId), number: Number(number) }),
  [LIVE_READ.TRANSCRIPT]: ([agentId = "", callId]) =>
    askAct(
      ACT_KIND.AGENTS_TRANSCRIPT,
      transcriptOf(String(agentId), callId === undefined ? undefined : String(callId)),
    ),
  [LIVE_READ.HISTORY]: ([taskId = ""]) =>
    askAct(ACT_KIND.TASKS_HISTORY_FOLLOW, { taskId: String(taskId) }),
  [LIVE_READ.INSTALLED_SKILLS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.INSTALLED_SKILLS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.INTEGRATIONS]: () => askAct(ACT_KIND.INTEGRATIONS_FOLLOW),
  [LIVE_READ.INTEGRATION_TOOLS]: ([name = ""]) => integrationToolsFollow(String(name)),
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_TOOLS]: ([agentId = ""]) =>
    askAct(ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW, { agentId: String(agentId) }),
  [LIVE_READ.MCP_CLIENTS]: () => askAct(ACT_KIND.MCP_CLIENTS_FOLLOW),
  [LIVE_READ.MEMORIES]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.MEMORIES_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.REPOSITORY_LISTS]: ([workspace = ""]) =>
    askAct(ACT_KIND.TASKS_REPOSITORIES_FOLLOW, repositoryScope(String(workspace))),
  [LIVE_READ.SLACK_CHANNELS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.TOKEN_REPOSITORIES]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_MEMBERS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_INVITATIONS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.AUTOMATIONS]: automationsFollow(AUTOMATION_FOLLOW.WORKSPACE),
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: automationsFollow(AUTOMATION_FOLLOW.WORKSPACE_RUNS),
  [LIVE_READ.AUTOMATION_RUNS]: automationsFollow(AUTOMATION_FOLLOW.RUNS),
};

function pullRequestPartIds([agentId = "", number = ""]: readonly string[]): readonly LiveReadId[] {
  return [agentId, number === OWN_PULL_REQUEST ? OWN_PULL_REQUEST : Number(number)];
}

const LIVE_KEY_IDS: {
  readonly [Read in LiveReadName]?: (path: readonly string[]) => readonly LiveReadId[];
} = {
  [LIVE_READ.PULL_REQUEST]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CHECKS]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_VIEWED]: pullRequestPartIds,
  [LIVE_READ.REVIEW_OPTIONS]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: ([agentId = "", number = ""]) => [agentId, Number(number)],
};

function transcriptOf(agentId: string, callId: string | undefined): AgentTranscriptKey {
  const kind = TRANSCRIPT_KIND.AGENT;
  return callId === undefined || callId === OWN_TRANSCRIPT
    ? { kind, agentId }
    : { kind, agentId, callId };
}

const LIVE_QUERY_READS = [
  LIVE_READ.ACCOUNT_PREFERENCES,
  LIVE_READ.MODELS,
  LIVE_READ.PROVIDER_KEYS,
  LIVE_READ.GITHUB_TOKEN,
  LIVE_READ.DEVICE_PRESENCE,
  LIVE_READ.HOSTS,
  LIVE_READ.THIS_MAC_HOST,
  LIVE_READ.AGENT_ORIGINS,
  LIVE_READ.INBOX_ITEMS,
  LIVE_READ.HOLDER_INBOX,
  LIVE_READ.LINK_STANDINGS,
  LIVE_READ.PAGES,
  LIVE_READ.BROWSER_TABS,
  LIVE_READ.DESCRIPTION_DOCUMENT,
  LIVE_READ.DESCRIPTION_COMMENTS,
  LIVE_READ.PULL_REQUEST,
  LIVE_READ.PULL_REQUEST_CHECKS,
  LIVE_READ.PULL_REQUEST_CONVERSATION,
  LIVE_READ.PULL_REQUEST_PUBLISHED,
  LIVE_READ.PULL_REQUEST_VIEWED,
  LIVE_READ.REVIEW_OPTIONS,
  LIVE_READ.PULL_REQUEST_CHAPTERS,
  LIVE_READ.TRANSCRIPT,
  LIVE_READ.HISTORY,
  LIVE_READ.INSTALLED_SKILLS,
  LIVE_READ.INTEGRATIONS,
  LIVE_READ.INTEGRATION_TOOLS,
  LIVE_READ.WORKSPACE_INTEGRATIONS,
  LIVE_READ.WORKSPACE_TOOLS,
  LIVE_READ.MCP_CLIENTS,
  LIVE_READ.MEMORIES,
  LIVE_READ.REPOSITORY_LISTS,
  LIVE_READ.SLACK_CHANNELS,
  LIVE_READ.TOKEN_REPOSITORIES,
  LIVE_READ.WORKSPACE_MEMBERS,
  LIVE_READ.WORKSPACE_INVITATIONS,
  LIVE_READ.WORKSPACE_PHOTOS,
  LIVE_READ.AUTOMATIONS,
  LIVE_READ.AUTOMATION_WORKSPACE_RUNS,
  LIVE_READ.AUTOMATION_RUNS,
] as const satisfies readonly LiveReadName[];

export type LiveQueryRead = (typeof LIVE_QUERY_READS)[number];

const MOVED: ReadonlySet<string> = new Set<LiveReadName>(LIVE_QUERY_READS);

function depthOf(read: LiveReadName): number {
  const slice = HOST_READ_SLICE[read];
  if (slice.on === KEYS_ON.ROWS) return 0;
  return slice.keys === READ_KEYS.TWO ? 2 : 1;
}

function idsOf(read: LiveReadName, path: readonly string[]): readonly LiveReadId[] {
  return LIVE_KEY_IDS[read]?.(path) ?? path;
}

function readsIn(
  held: unknown,
  depth: number,
  ids: readonly string[] = [],
): readonly { readonly ids: readonly string[]; readonly held: unknown }[] {
  if (depth === 0) return held === undefined ? [] : [{ ids, held }];
  if (typeof held !== "object" || held === null) return [];
  return Object.entries(held).flatMap(([id, below]) => readsIn(below, depth - 1, [...ids, id]));
}

function isLiveReadId(id: unknown): id is LiveReadId {
  return typeof id === "string" || typeof id === "number";
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let at = value;
  for (const segment of path) {
    at =
      typeof at === "object" && at !== null && Object.hasOwn(at, segment)
        ? Reflect.get(at, segment)
        : undefined;
  }
  return at;
}

function heldAt<Read extends LiveReadName>(
  document: AppStateSnapshot | undefined,
  read: Read,
  ids: readonly LiveReadId[],
): AppHostRead<AppHostReads[Read]> | undefined {
  return valueAt(document?.[read], ids.map(String)) as AppHostRead<AppHostReads[Read]> | undefined;
}

function isAppState(query: Query): boolean {
  return query.queryKey[0] === QUERY_ROOT.APP_STATE;
}

function liveReadOf(
  query: Query,
): { readonly read: LiveReadName; readonly ids: readonly LiveReadId[] } | undefined {
  const [name, ...ids] = query.queryKey;
  if (typeof name !== "string" || !MOVED.has(name)) return undefined;
  const read = name as LiveReadName;
  if (ids.length !== depthOf(read)) return undefined;
  if (!ids.every(isLiveReadId)) return undefined;
  return { read, ids };
}

function firstAnswer<Read extends LiveReadName>(
  client: QueryClient,
  read: Read,
  ids: readonly LiveReadId[],
): Effect.Effect<AppHostReads[Read], LiveReadFailed> {
  return Effect.callback<AppHostReads[Read], LiveReadFailed>((resume) => {
    let stop: (() => void) | undefined;
    let answered = false;
    const settle = (): void => {
      const held = heldAt(client.getQueryData(appStateQuery.queryKey), read, ids);
      if (answered || (held?.rows === undefined && held?.failed !== true)) return;
      answered = true;
      stop?.();
      resume(
        held.rows === undefined ? Effect.fail(new LiveReadFailed(read)) : Effect.succeed(held.rows),
      );
    };
    settle();
    if (answered) return;
    stop = client.getQueryCache().subscribe((event) => {
      if (isAppState(event.query)) settle();
    });
    return Effect.sync(() => stop?.());
  });
}

function liveReadQuery<Read extends LiveReadName>(
  read: Read,
  ids: readonly LiveReadId[] | undefined,
  meta?: Readonly<Record<string, unknown>>,
) {
  const queryKey: LiveReadKey<Read> = ids === undefined ? [read] : [read, ...ids];
  return queryOptions({
    queryKey,
    ...(meta === undefined ? {} : { meta }),
    queryFn: ({ client, signal }) =>
      rendererPromise(firstAnswer(client, read, ids ?? []), signal).then(
        (answered) =>
          heldAt(client.getQueryData(appStateQuery.queryKey), read, ids ?? [])?.rows ?? answered,
      ),
    enabled: ids !== undefined,
    staleTime: Infinity,
    retry: false,
  });
}

function accountIds(accountId: string | undefined): readonly string[] | undefined {
  return accountId === undefined ? undefined : [accountId];
}

export const accountPreferencesQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.ACCOUNT_PREFERENCES, accountIds(accountId));

export const modelsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.MODELS, accountIds(accountId));

export const providerKeysQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.PROVIDER_KEYS, accountIds(accountId));

export const githubTokenQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.GITHUB_TOKEN, accountIds(accountId));

export const devicePresenceQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.DEVICE_PRESENCE, accountIds(accountId));

export const hostsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.HOSTS, accountIds(accountId));

export const thisMacHostQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.THIS_MAC_HOST, accountIds(accountId));

export const agentOriginQuery = (agentId: string | undefined) =>
  liveReadQuery(LIVE_READ.AGENT_ORIGINS, agentId === undefined ? undefined : [agentId]);

export const inboxItemsQuery = () => liveReadQuery(LIVE_READ.INBOX_ITEMS, []);

export const holderInboxQuery = (holder: InboxHolderKey | undefined) =>
  liveReadQuery(
    LIVE_READ.HOLDER_INBOX,
    holder === undefined ? undefined : [holder.kind, holder.id],
  );

export const linkStandingQuery = (link: LinkStandingKey | undefined) =>
  liveReadQuery(
    LIVE_READ.LINK_STANDINGS,
    link === undefined ? undefined : [link.workspaceId, link.address],
  );
export const transcriptQuery = (transcript: AgentTranscriptKey | undefined) =>
  liveReadQuery(
    LIVE_READ.TRANSCRIPT,
    transcript === undefined
      ? undefined
      : [transcript.agentId, transcript.callId ?? OWN_TRANSCRIPT],
  );

export const historyQuery = (taskId: string | undefined) =>
  liveReadQuery(LIVE_READ.HISTORY, taskId === undefined ? undefined : [taskId]);

export const pagesQuery = (place: PagePlace | undefined) =>
  liveReadQuery(
    LIVE_READ.PAGES,
    place === undefined
      ? undefined
      : "taskId" in place
        ? [PAGE_OWNER.TASK, place.taskId]
        : [PAGE_OWNER.AGENT, place.agentId],
  );

export const browserTabsQuery = (place: BrowserTabsPlace | undefined) =>
  liveReadQuery(
    LIVE_READ.BROWSER_TABS,
    place === undefined ? undefined : [browserTabsPlaceKind(place), browserTabsPlaceId(place)],
  );

export const descriptionDocumentQuery = (taskId: string | undefined) =>
  liveReadQuery(LIVE_READ.DESCRIPTION_DOCUMENT, taskId === undefined ? undefined : [taskId]);

function commentsFollowOf({ taskId, pageId }: CommentSubject): CommentSubject {
  return pageId === undefined ? { taskId } : { taskId, pageId };
}

export const descriptionCommentsQuery = (subject: CommentSubject | undefined) =>
  liveReadQuery(
    LIVE_READ.DESCRIPTION_COMMENTS,
    subject === undefined
      ? undefined
      : subject.pageId === undefined
        ? [COMMENT_SUBJECT.DESCRIPTION, subject.taskId]
        : [COMMENT_SUBJECT.PAGE, subject.pageId],
    subject === undefined ? undefined : { follow: commentsFollowOf(subject) },
  );

function pullRequestIds(
  key: AgentPullRequestReadParams | undefined,
): readonly LiveReadId[] | undefined {
  return key === undefined ? undefined : [key.agentId, key.number ?? OWN_PULL_REQUEST];
}

export const pullRequestQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST, pullRequestIds(key));

export const pullRequestChecksQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_CHECKS, pullRequestIds(key));

export const pullRequestConversationQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_CONVERSATION, pullRequestIds(key));

export const pullRequestPublishedQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_PUBLISHED, pullRequestIds(key));

export const pullRequestViewedQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_VIEWED, pullRequestIds(key));

export const reviewOptionsQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.REVIEW_OPTIONS, pullRequestIds(key));

export const pullRequestChaptersQuery = (key: PullRequestChaptersReadParams | undefined) =>
  liveReadQuery(
    LIVE_READ.PULL_REQUEST_CHAPTERS,
    key === undefined ? undefined : [key.agentId, key.number],
  );

function oneId(id: string | undefined): readonly string[] | undefined {
  return id === undefined ? undefined : [id];
}

export const installedSkillsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.INSTALLED_SKILLS, oneId(workspaceId));

export const integrationsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.INTEGRATIONS, accountIds(accountId));

export const integrationToolsQuery = (name: string | undefined) =>
  liveReadQuery(LIVE_READ.INTEGRATION_TOOLS, oneId(name));

export const workspaceIntegrationsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_INTEGRATIONS, oneId(workspaceId));

export const workspaceToolsQuery = (agentId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_TOOLS, oneId(agentId));

export const mcpClientsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.MCP_CLIENTS, accountIds(accountId));

export const memoriesQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.MEMORIES, oneId(workspaceId));

export const repositoryListsQuery = (workspace: string | undefined) =>
  liveReadQuery(LIVE_READ.REPOSITORY_LISTS, oneId(workspace));

export const slackChannelsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.SLACK_CHANNELS, oneId(workspaceId));

export const tokenRepositoriesQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.TOKEN_REPOSITORIES, oneId(workspaceId));

export const workspaceMembersQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_MEMBERS, oneId(workspaceId));

export const workspaceInvitationsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_INVITATIONS, oneId(workspaceId));

export const workspacePhotoQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_PHOTOS, oneId(workspaceId));

export const automationsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.AUTOMATIONS, oneId(workspaceId));

export const automationWorkspaceRunsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.AUTOMATION_WORKSPACE_RUNS, oneId(workspaceId));

export const automationRunsQuery = (automationId: string | undefined) =>
  liveReadQuery(LIVE_READ.AUTOMATION_RUNS, oneId(automationId));

export const accountPreferencesRetryMutation = () => actMutation(ACT_KIND.AGENTS_PREFERENCES_RETRY);

export const modelsRetryMutation = () => actMutation(ACT_KIND.AGENTS_MODELS_RETRY);

export const providerKeysRetryMutation = () => actMutation(ACT_KIND.PROVIDER_KEYS_RETRY);

export const githubTokenRetryMutation = () => actMutation(ACT_KIND.GITHUB_TOKEN_RETRY);

export const devicePresenceRefreshMutation = () => actMutation(ACT_KIND.HOSTS_PRESENCE_REFRESH);

export const hostsRetryMutation = () => actMutation(ACT_KIND.HOSTS_RETRY);

export const inboxItemsRetryMutation = () => actMutation(ACT_KIND.AGENTS_INBOX_ITEMS_RETRY);

export const holderInboxRetryMutation = () => actMutation(ACT_KIND.AGENTS_INBOX_RETRY);
export const descriptionCommentsRetryMutation = () => actMutation(ACT_KIND.TASKS_COMMENTS_RETRY);

export const descriptionDocumentRetryMutation = () => actMutation(ACT_KIND.TASKS_DOCUMENT_RETRY);

export const pullRequestPartRetryMutation = () =>
  actMutation(ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY);

export const pullRequestChaptersRetryMutation = () => actMutation(ACT_KIND.CHAPTERS_RETRY);

export const transcriptRetryMutation = () => actMutation(ACT_KIND.AGENTS_TRANSCRIPT_RETRY);

export const historyRetryMutation = () => actMutation(ACT_KIND.TASKS_HISTORY_RETRY);

export const installedSkillsRetryMutation = () => actMutation(ACT_KIND.INSTALLED_SKILLS_RETRY);

export const integrationsRetryMutation = () => actMutation(ACT_KIND.INTEGRATIONS_RETRY);

export const integrationToolsRetryMutation = () => actMutation(ACT_KIND.INTEGRATIONS_TOOLS_RETRY);

export const workspaceIntegrationsRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY);

export const mcpClientsRetryMutation = () => actMutation(ACT_KIND.MCP_CLIENTS_RETRY);

export const memoriesRetryMutation = () => actMutation(ACT_KIND.MEMORIES_RETRY);

export const repositoryListsRetryMutation = () => actMutation(ACT_KIND.TASKS_REPOSITORIES_RETRY);

export const tokenRepositoriesRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY);

export const workspaceMembersRetryMutation = () => actMutation(ACT_KIND.WORKSPACE_MEMBERS_RETRY);

export const workspaceInvitationsRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_INVITATIONS_RETRY);

export const automationsRetryMutation = () => actMutation(ACT_KIND.AUTOMATIONS_RETRY);

function writeLiveReads(client: QueryClient): void {
  const document = client.getQueryData(appStateQuery.queryKey);
  if (document === undefined) return;
  for (const read of LIVE_QUERY_READS) {
    for (const { ids, held } of readsIn(document[read], depthOf(read))) {
      const rows = (held as AppHostRead<AppHostReads[typeof read]>).rows;
      const queryKey = [read, ...idsOf(read, ids)];
      if (rows !== undefined && rows !== client.getQueryData(queryKey)) {
        client.setQueryData(queryKey, rows);
      }
    }
  }
  for (const query of client.getQueryCache().getAll()) {
    const live = liveReadOf(query);
    if (live === undefined) continue;
    const held = heldAt(document, live.read, live.ids);
    const cleared = query.state.status === "success" && held?.rows === undefined;
    const recovered = query.state.status === "error" && held?.failed !== true;
    if (cleared || recovered) {
      void client.resetQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

export function useLiveReadSubscription(): void {
  const client = useQueryClient();
  useEffect(() => {
    const cache = client.getQueryCache();
    const follows = new Map<Query, () => void>();
    const letGo = (query: Query): void => {
      follows.get(query)?.();
      follows.delete(query);
    };
    const hold = (query: Query): void => {
      const live = liveReadOf(query);
      const follow = live === undefined ? undefined : LIVE_FOLLOWS[live.read];
      if (live === undefined || follow === undefined) return;
      const followed = follows.has(query);
      if (query.isActive() && !followed) {
        follows.set(
          query,
          streamFrom(
            () => follow(live.ids, query.meta),
            () => undefined,
          ),
        );
      }
      if (!query.isActive() && followed) letGo(query);
    };
    const unsubscribe = cache.subscribe((event) => {
      if (isAppState(event.query)) {
        if (event.type === "updated") writeLiveReads(client);
        return;
      }
      if (event.type === "removed") letGo(event.query);
      if (
        event.type === "observerAdded" ||
        event.type === "observerRemoved" ||
        event.type === "observerOptionsUpdated"
      ) {
        hold(event.query);
      }
    });
    writeLiveReads(client);
    for (const query of cache.getAll()) hold(query);
    return () => {
      unsubscribe();
      for (const release of follows.values()) release();
    };
  }, [client]);
}

export function LiveReadSubscription(): null {
  useLiveReadSubscription();
  return null;
}
