/**
 * live.ts -- the reads the desktop follows over Neon Realtime (`live-wire.ts`), sealed for the caller's own account.
 *
 * What waits on the developer across the account, as the address to
 * subscribe at and one sealed statement per part of the account inbox's
 * answer; every inbox item the account reaches, as where each stands and
 * those changed since `?since=` whole; the task list, as its tasks and every agent of them and with no
 * task; and one task's record, pages, and calls, named by `?id=`, as the
 * statements that mark where each stands, and its Browser tabs, the agent's pointer on each among them, and its
 * comments, its plan's own threads or with `&page=` one page's, as their
 * threads, entries, and files; and one
 * coding agent's transcript, or one of its workers' under `&call=`, as the
 * statements its pages are read from, and the run of an automation that
 * started it, as one statement; and the
 * commands of the kinds `?kinds=` names that no Mac of the account has
 * claimed, as one statement; and one plan's inbox, or one agent's, named by
 * `?id=`, as its items, their threads, and their files; and the account's
 * workspaces, as the statements of the workspaces and of the GitHub
 * installations connected to them; and one workspace's people, named by
 * `?workspaceId=`, as its members and who its work names but left, and its
 * pending invitations, to an owner or an admin of it, with the origin each
 * accept link is built on; and one coding agent's pull request's newest
 * chapters, the agent named by `?id=` and the pull request by `&number=`,
 * with whether the reader can generate them; and every integration row the
 * account holds, with the providers it is offered and those that take
 * several accounts; and one workspace's memories, named by `?workspaceId=`,
 * each with its keeper's name and whether the reader may forget it; and the
 * skills the account sees there, named the same way, each with whether it
 * may manage it; and the account's hosts, with the install script's address
 * on the service's own origin; and one workspace's Sentry installations and
 * Slack bot, named by `?workspaceId=`, with whether this deployment holds
 * each integration; and the account's preferences row, its default agent,
 * chapters model, and Slack notifications as stored. Each
 * asked with `?poll=true` answers each statement's rows inline instead, for
 * a reader polling while Realtime fails or is off; with `&after=` too, the
 * poll is held until the rows move past it, or answered unchanged. The task
 * list and the inbox items asked with `&sync=` are answered what moved past
 * that sync id alone, held until something does. Each
 * names the account it was started for under `?userId=`, and a session of
 * any other is answered as signed out. Each output is the wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "../account-inbox-wire.js";
import { accountPreferencesLiveAnswerSchema } from "../account-preferences-live.js";
import { AGENT_ORIGIN_READ } from "../agent-origin-live.js";
import {
  automationRunsLiveAnswerSchema,
  automationsLiveAnswerSchema,
  automationWorkspaceRunsLiveAnswerSchema,
} from "../automation-live.js";
import { AGENT_BROWSER_TABS_READ, TASK_BROWSER_TABS_READ } from "../browser-tabs-live.js";
import { TASK_COMMENTS_READ } from "../description-comment-live.js";
import { HOSTS_READ } from "../host-live.js";
import { installedSkillsLiveAnswerSchema } from "../installed-skill-live.js";
import { integrationStatusesLiveAnswerSchema } from "../integration-live.js";
import { liveProcedure } from "../live-read.js";
import {
  ACCOUNT_INBOX_ITEMS,
  accountInboxItemsLiveAnswerSchema,
  accountInboxLiveAnswerSchema,
  agentTranscriptLiveAnswerSchema,
  LIVE_POLL,
  LIVE_USER_QUERY,
  macCommandsLiveAnswerSchema,
  scopeInboxLiveAnswerSchema,
} from "../live-wire.js";
import { workspaceMemoriesLiveAnswerSchema } from "../memory-live.js";
import { pullRequestChaptersLiveAnswerSchema } from "../pull-request-chapters-live.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { sidebarLiveAnswerSchema } from "../sidebar-live.js";
import { TASK_HISTORY_READ } from "../task-history-live.js";
import { taskListLiveAnswerSchema } from "../task-list-live.js";
import { AGENT_PAGES_READ, TASK_PAGES_READ } from "../task-pages-live.js";
import { TASK_RECORD_READ } from "../task-record-live.js";
import { workspaceIntegrationsLiveAnswerSchema } from "../workspace-integrations-live.js";
import {
  workspaceInvitationsLiveAnswerSchema,
  workspaceMembersLiveAnswerSchema,
  workspacesLiveAnswerSchema,
} from "../workspace-live.js";
import { hostedProcedure } from "./base.js";

/** Whether the reader asks for the rows inline, polling while Realtime fails it (`LIVE_POLL`). */
const pollField = EffectSchema.optionalKey(EffectSchema.Literal(LIVE_POLL.ON));

/** Where the rows stood when the reader last polled (`liveDigestOf`); the poll is held until they move past it. */
const afterField = EffectSchema.optionalKey(EffectSchema.String);

/** The sync id the reader holds every row at, as text, past which it is answered what moved alone; empty where it holds none yet (`LIVE_POLL.SYNC`). */
const syncField = EffectSchema.optionalKey(EffectSchema.String);

/** The account the reader started following for, which the session must be (`LIVE_USER_QUERY`). */
const userField = EffectSchema.optionalKey(EffectSchema.String);

/** A live read's own query: whether it polls. */
const liveReadSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The task list as a live read follows it: the sync id the reader holds every row at (`syncField`). */
const liveTasksSchema = EffectSchema.Struct({
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.SYNC]: syncField,
  [LIVE_USER_QUERY]: userField,
});

/** The account's inbox as a live read follows it: whether it is carried the items of agents with no repository (`ACCOUNT_INBOX_REPOSITORYLESS`), which a build from before it never asks for. */
const liveAccountInboxSchema = EffectSchema.Struct({
  [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: EffectSchema.optionalKey(
    EffectSchema.Literal(ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
  ),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The account's inbox items as a live read follows them: the instant the reader holds every item changed since, in epoch milliseconds, as text, none for every item; and the sync id it holds every item at, past which it is answered what moved alone (`LIVE_POLL.SYNC`). */
const liveAccountInboxItemsSchema = EffectSchema.Struct({
  [ACCOUNT_INBOX_ITEMS.SINCE]: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.SYNC]: syncField,
  [LIVE_USER_QUERY]: userField,
});

/** The task a live read is followed for; one that is no UUID is answered as not found, so it is read as text here. */
const liveTaskSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The plan or agent a scope's inbox is followed for; one that is no UUID is answered as not found, so it is read as text here. */
const liveScopeSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/**
 * The agent a transcript is followed for, and the delegation call of the
 * worker where it is a worker's; each read as text, an id or call of no
 * shape answered as not found. A reader that names where it holds the
 * newest messages (`LIVE_POLL.CURSOR`) is answered them past it; one of no
 * shape is refused.
 */
const liveTranscriptSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  call: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_POLL.CURSOR]: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_USER_QUERY]: userField,
});

/** The kinds of command a Mac's live read follows, as its held read names them (`macCommandKindsQuery`). */
const liveMacCommandsSchema = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/**
 * The agent whose pull request's chapters a live read follows, and the
 * pull request's number, as the agent's read of them names it; each read as
 * text, an agent of no shape answered as not found and a number of none
 * refused.
 */
const livePullRequestChaptersSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  number: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

/** The workspace a live read is followed for; one that names no workspace of the account's is answered as not found, so it is read as text here. */
const liveWorkspaceSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  [LIVE_POLL.QUERY]: pollField,
  [LIVE_POLL.AFTER]: afterField,
  [LIVE_USER_QUERY]: userField,
});

export const liveContract = {
  inbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX }))
    .input(liveAccountInboxSchema)
    .output(EffectSchema.flip(accountInboxLiveAnswerSchema)),
  inboxItems: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INBOX_ITEMS }))
    .input(liveAccountInboxItemsSchema)
    .output(EffectSchema.flip(accountInboxItemsLiveAnswerSchema)),
  [TASK_RECORD_READ.name]: liveProcedure(TASK_RECORD_READ),
  [TASK_PAGES_READ.name]: liveProcedure(TASK_PAGES_READ),
  [AGENT_PAGES_READ.name]: liveProcedure(AGENT_PAGES_READ),
  [AGENT_ORIGIN_READ.name]: liveProcedure(AGENT_ORIGIN_READ),
  [TASK_HISTORY_READ.name]: liveProcedure(TASK_HISTORY_READ),
  [TASK_COMMENTS_READ.name]: liveProcedure(TASK_COMMENTS_READ),
  [TASK_BROWSER_TABS_READ.name]: liveProcedure(TASK_BROWSER_TABS_READ),
  [AGENT_BROWSER_TABS_READ.name]: liveProcedure(AGENT_BROWSER_TABS_READ),
  tasks: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASKS }))
    .input(liveTasksSchema)
    .output(EffectSchema.flip(taskListLiveAnswerSchema)),
  automations: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AUTOMATIONS }))
    .input(
      EffectSchema.Struct({
        workspaceId: EffectSchema.String,
        [LIVE_POLL.QUERY]: pollField,
        [LIVE_POLL.AFTER]: afterField,
        [LIVE_USER_QUERY]: userField,
      }),
    )
    .output(EffectSchema.flip(automationsLiveAnswerSchema)),
  automationWorkspaceRuns: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_WORKSPACE_RUNS,
      }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(automationWorkspaceRunsLiveAnswerSchema)),
  automationRuns: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AUTOMATION_RUNS }))
    .input(liveTaskSchema)
    .output(EffectSchema.flip(automationRunsLiveAnswerSchema)),
  agentTranscript: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_TRANSCRIPT }))
    .input(liveTranscriptSchema)
    .output(EffectSchema.flip(agentTranscriptLiveAnswerSchema)),
  macCommands: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_MAC_COMMANDS }))
    .input(liveMacCommandsSchema)
    .output(EffectSchema.flip(macCommandsLiveAnswerSchema)),
  taskInbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_TASK_INBOX }))
    .input(liveScopeSchema)
    .output(EffectSchema.flip(scopeInboxLiveAnswerSchema)),
  agentInbox: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_AGENT_INBOX }))
    .input(liveScopeSchema)
    .output(EffectSchema.flip(scopeInboxLiveAnswerSchema)),
  sidebar: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_SIDEBAR }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(sidebarLiveAnswerSchema)),
  workspaces: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(workspacesLiveAnswerSchema)),
  workspaceMembers: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMBERS }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceMembersLiveAnswerSchema)),
  workspaceInvitations: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INVITATIONS }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceInvitationsLiveAnswerSchema)),
  [HOSTS_READ.name]: liveProcedure(HOSTS_READ),
  workspaceMemories: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMORIES }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceMemoriesLiveAnswerSchema)),
  installedSkills: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INSTALLED_SKILLS }))
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(installedSkillsLiveAnswerSchema)),
  workspaceIntegrations: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INTEGRATIONS }),
    )
    .input(liveWorkspaceSchema)
    .output(EffectSchema.flip(workspaceIntegrationsLiveAnswerSchema)),
  pullRequestChapters: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_PULL_REQUEST_CHAPTERS }),
    )
    .input(livePullRequestChaptersSchema)
    .output(EffectSchema.flip(pullRequestChaptersLiveAnswerSchema)),
  integrationStatuses: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_INTEGRATION_STATUSES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(integrationStatusesLiveAnswerSchema)),
  accountPreferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_ACCOUNT_PREFERENCES }))
    .input(liveReadSchema)
    .output(EffectSchema.flip(accountPreferencesLiveAnswerSchema)),
};
