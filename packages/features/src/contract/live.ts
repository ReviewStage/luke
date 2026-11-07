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
 * any other is answered as signed out. Each is declared once
 * (`../live-read.ts`), and its procedure is that declaration's
 * (`liveProcedure`): its query, its answer flipped
 * (`packages/service/src/orpc/base.ts`), and its refusals.
 */

import { ACCOUNT_PREFERENCES_READ } from "../account-preferences-live.js";
import { AGENT_ORIGIN_READ } from "../agent-origin-live.js";
import { AGENT_TRANSCRIPT_READ } from "../agent-transcript-live.js";
import {
  AUTOMATION_RUNS_READ,
  AUTOMATION_WORKSPACE_RUNS_READ,
  AUTOMATIONS_READ,
} from "../automation-live.js";
import { AGENT_BROWSER_TABS_READ, TASK_BROWSER_TABS_READ } from "../browser-tabs-live.js";
import { TASK_COMMENTS_READ } from "../description-comment-live.js";
import { HOSTS_READ } from "../host-live.js";
import {
  ACCOUNT_INBOX_READ,
  AGENT_INBOX_READ,
  INBOX_ITEMS_READ,
  TASK_INBOX_READ,
} from "../inbox-live.js";
import { INSTALLED_SKILLS_READ } from "../installed-skill-live.js";
import { INTEGRATION_STATUSES_READ } from "../integration-live.js";
import { liveProcedure } from "../live-read.js";
import { MAC_COMMANDS_READ } from "../mac-command-live.js";
import { WORKSPACE_MEMORIES_READ } from "../memory-live.js";
import { PULL_REQUEST_CHAPTERS_READ } from "../pull-request-chapters-live.js";
import { SIDEBAR_READ } from "../sidebar-live.js";
import { TASK_HISTORY_READ } from "../task-history-live.js";
import { TASK_LIST_READ } from "../task-list-live.js";
import { AGENT_PAGES_READ, TASK_PAGES_READ } from "../task-pages-live.js";
import { TASK_RECORD_READ } from "../task-record-live.js";
import { WORKSPACE_INTEGRATIONS_READ } from "../workspace-integrations-live.js";
import {
  WORKSPACE_INVITATIONS_READ,
  WORKSPACE_MEMBERS_READ,
  WORKSPACES_READ,
} from "../workspace-live.js";

export const liveContract = {
  [ACCOUNT_INBOX_READ.name]: liveProcedure(ACCOUNT_INBOX_READ),
  [INBOX_ITEMS_READ.name]: liveProcedure(INBOX_ITEMS_READ),
  [TASK_RECORD_READ.name]: liveProcedure(TASK_RECORD_READ),
  [TASK_PAGES_READ.name]: liveProcedure(TASK_PAGES_READ),
  [AGENT_PAGES_READ.name]: liveProcedure(AGENT_PAGES_READ),
  [AGENT_ORIGIN_READ.name]: liveProcedure(AGENT_ORIGIN_READ),
  [TASK_HISTORY_READ.name]: liveProcedure(TASK_HISTORY_READ),
  [TASK_COMMENTS_READ.name]: liveProcedure(TASK_COMMENTS_READ),
  [TASK_BROWSER_TABS_READ.name]: liveProcedure(TASK_BROWSER_TABS_READ),
  [AGENT_BROWSER_TABS_READ.name]: liveProcedure(AGENT_BROWSER_TABS_READ),
  [TASK_LIST_READ.name]: liveProcedure(TASK_LIST_READ),
  [AUTOMATIONS_READ.name]: liveProcedure(AUTOMATIONS_READ),
  [AUTOMATION_WORKSPACE_RUNS_READ.name]: liveProcedure(AUTOMATION_WORKSPACE_RUNS_READ),
  [AUTOMATION_RUNS_READ.name]: liveProcedure(AUTOMATION_RUNS_READ),
  [AGENT_TRANSCRIPT_READ.name]: liveProcedure(AGENT_TRANSCRIPT_READ),
  [MAC_COMMANDS_READ.name]: liveProcedure(MAC_COMMANDS_READ),
  [TASK_INBOX_READ.name]: liveProcedure(TASK_INBOX_READ),
  [AGENT_INBOX_READ.name]: liveProcedure(AGENT_INBOX_READ),
  [SIDEBAR_READ.name]: liveProcedure(SIDEBAR_READ),
  [WORKSPACES_READ.name]: liveProcedure(WORKSPACES_READ),
  [WORKSPACE_MEMBERS_READ.name]: liveProcedure(WORKSPACE_MEMBERS_READ),
  [WORKSPACE_INVITATIONS_READ.name]: liveProcedure(WORKSPACE_INVITATIONS_READ),
  [HOSTS_READ.name]: liveProcedure(HOSTS_READ),
  [WORKSPACE_MEMORIES_READ.name]: liveProcedure(WORKSPACE_MEMORIES_READ),
  [INSTALLED_SKILLS_READ.name]: liveProcedure(INSTALLED_SKILLS_READ),
  [WORKSPACE_INTEGRATIONS_READ.name]: liveProcedure(WORKSPACE_INTEGRATIONS_READ),
  [PULL_REQUEST_CHAPTERS_READ.name]: liveProcedure(PULL_REQUEST_CHAPTERS_READ),
  [INTEGRATION_STATUSES_READ.name]: liveProcedure(INTEGRATION_STATUSES_READ),
  [ACCOUNT_PREFERENCES_READ.name]: liveProcedure(ACCOUNT_PREFERENCES_READ),
};
