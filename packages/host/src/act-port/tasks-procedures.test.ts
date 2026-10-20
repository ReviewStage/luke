/**
 * tasks-procedures.test.ts -- the task list, lifecycle, and content acts, through the act port as a window calls them.
 *
 * Only a panel of this build's own renderer asks; the voice and call
 * windows, and a frame this build does not trust, are refused in each
 * kind's own words before the host is asked; a panel's ask reaches the host
 * with its payload as the kind's schema read it, and answers what the host
 * answered; a started task opens its call where it planned and voice is
 * ready; a microphone press opens a call about the task the host has open;
 * the browser opens only the addresses each kind may open; and what a task
 * holds is read through the host, a page's source coloured, and a pull
 * request or an issue the service did not answer refused.
 */

import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
} from "@luke/features/plan-comment-wire";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import { TASK_FILE_REFUSAL } from "@luke/features/task-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksPageSourceAnswer,
  type TasksStartAnswer,
} from "@luke/features/tasks-view";
import { ORPCError } from "@orpc/client";
import { Effect } from "effect";
import { GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
} from "../contract/index.js";
import { highlightSnippet } from "../task-code.js";
import type { ActSender } from "./base.js";
import { type TasksProceduresDependencies, tasksProcedures } from "./tasks-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SERVICE = "https://luke.test";
const CONNECT_PAGE = `${SERVICE}/connect-github.html?intent=intent-1`;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [TASKS_ACT_KIND.TASKS_REFRESH]: "Could not read your tasks on this system.",
  [TASKS_ACT_KIND.TASKS_SELECT]: "Could not open that task on this system.",
  [TASKS_ACT_KIND.TASKS_CLOSE]: "Could not leave that task on this system.",
  [TASKS_ACT_KIND.TASKS_START]: "Could not start that task on this system.",
  [TASKS_ACT_KIND.TASKS_DELETE]: "Could not delete that task on this system.",
  [TASKS_ACT_KIND.TASKS_RENAME]: "Could not rename that task on this system.",
  [TASKS_ACT_KIND.TASKS_PIN]: "Could not pin that task on this system.",
  [TASKS_ACT_KIND.TASKS_PIN_REPOSITORY]: "Could not pin that repository on this system.",
  [TASKS_ACT_KIND.TASKS_WRITE_SECTION]: "Could not change that section on this system.",
  [TASKS_ACT_KIND.TASKS_ARCHIVE]: "Could not archive that task on this system.",
  [TASKS_ACT_KIND.TASKS_REPOSITORIES]: "Could not read your GitHub repositories on this system.",
  [TASKS_ACT_KIND.TASKS_SET_REPOSITORY]: "Could not change that task's repository on this system.",
  [TASKS_ACT_KIND.TASKS_MOVE]: "Could not move that task on this system.",
  [TASKS_ACT_KIND.TASKS_EDIT]: "Could not save that edit on this system.",
  [TASKS_ACT_KIND.GITHUB_OPEN]: "Could not open GitHub on this system.",
  [TASKS_ACT_KIND.WEB_OPEN]: "Could not open that link on this system.",
  [TASKS_ACT_KIND.GITHUB_CONNECT]: "Could not open GitHub's connection page on this system.",
  [TASKS_ACT_KIND.GITHUB_DISCONNECT]: "Could not disconnect GitHub on this system.",
  [TASKS_ACT_KIND.TASKS_TALK]: "Could not talk about that task on this system.",
  [TASKS_ACT_KIND.TASKS_BOARD_SAVE]: "Could not save the board on this system.",
  [TASKS_ACT_KIND.TASKS_SET_STANDING]: "Could not change where that task stands on this system.",
  [TASKS_ACT_KIND.TASKS_WORK_EARLIER]: "Could not read that task's earlier work on this system.",
  [TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER]:
    "Could not read that task's earlier conversation on this system.",
  [TASKS_ACT_KIND.TASKS_MESSAGES]: "Could not read that task's conversation on this system.",
  [TASKS_ACT_KIND.TASKS_FILE]: "Could not read that file on this system.",
  [TASKS_ACT_KIND.TASKS_TREE]: "Could not list that folder on this system.",
  [TASKS_ACT_KIND.TASKS_SKILLS]: "Could not read this repository's skills on this system.",
  [TASKS_ACT_KIND.TASKS_PULL_REQUEST]: "Could not read that pull request on this system.",
  [TASKS_ACT_KIND.TASKS_ISSUE]: "Could not read that issue on this system.",
  [TASKS_ACT_KIND.TASKS_COLOUR_CODE]: "Could not colour that code on this system.",
  [TASKS_ACT_KIND.TASKS_REVISIONS]: "Could not read that plan's history on this system.",
  [TASKS_ACT_KIND.TASKS_REVISION]: "Could not read that version on this system.",
  [TASKS_ACT_KIND.TASKS_RESTORE]: "Could not restore that version on this system.",
  [TASKS_ACT_KIND.TASKS_PAGE_SOURCE]: "Could not read that page's source on this system.",
  [TASKS_ACT_KIND.TASKS_PAGES]: "Could not read that plan's pages on this system.",
  [TASKS_ACT_KIND.TASKS_PICTURE_READ]: "Could not read that picture on this system.",
  [TASKS_ACT_KIND.TASKS_PICTURE_KEEP]: "Could not keep that picture on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENTS]: "Could not read the task's comments on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENT_START]: "Could not comment on the task on this system.",
  [TASKS_ACT_KIND.TASKS_COMMENT_ACT]: "Could not change the task's comment on this system.",
} as const;

type TasksKind = keyof typeof REFUSAL;

/** What any port kind takes, the union a test hands one kind or refuses on purpose. */
type AnyPayload = PortActPayload<PortActKind>;

const TASK = { taskId: TASK_ID };
const EDIT = { ...TASK, edit: { document: { base: "", value: "Invites expire." } } };
const BOARD = { ...TASK, elements: [], appliedDrawing: 0 };

/** A comment thread's id, as the service spells one. */
const THREAD_ID = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";
/** The one picture the fake host holds. */
const PICTURE_ID = "picture-1";
/** The one page the fake host lists, by its id as the service spells one. */
const PAGE_LINE_ID = "5a1c3f7e-8b2d-4e6f-9a0b-1c2d3e4f5a6b";
const PLAN = { planId: "plan-1" };
const PLACE = { workspaceId: "workspace-acme", repository: "acme/relay" };
const PAGE = { ...TASK, pageId: "page-funnel", version: 2 };
const COMMENT_START = {
  ...PLAN,
  start: {
    clientKey: "comment-1",
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "Invites",
    anchor: { from: 0, to: 7 },
    text: "Invites expire.",
    words: "Shorter?",
  },
};
const COMMENT_ACT = {
  ...PLAN,
  threadId: THREAD_ID,
  action: { action: PLAN_COMMENT_ACTION.RESOLVE },
};

/** The one pull request the fake host's service holds; it holds none numbered `PULL_REQUEST_NONE`, and answers nothing for any other number. */
const PULL_REQUEST = {
  number: 42,
  title: "Send invitations in batches",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
};
const PULL_REQUEST_NONE = 43;
/** The one issue the fake host's service holds; it holds none numbered `ISSUE_NONE`, and answers nothing for any other number. */
const ISSUE = {
  number: 7,
  title: "Invitations expire too soon",
  url: "https://github.com/acme/relay/issues/7",
  state: ISSUE_STATE.CLOSED,
};
const ISSUE_NONE = 8;

/** One ask of every task kind, with a payload its schema admits. */
const ACTS: readonly { kind: TasksKind; payload: AnyPayload }[] = [
  { kind: TASKS_ACT_KIND.TASKS_REFRESH, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_SELECT, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_CLOSE, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_START, payload: { name: "Invitations" } },
  { kind: TASKS_ACT_KIND.TASKS_DELETE, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_RENAME, payload: { ...TASK, name: "Expiry" } },
  { kind: TASKS_ACT_KIND.TASKS_PIN, payload: { ...TASK, pinned: true } },
  {
    kind: TASKS_ACT_KIND.TASKS_PIN_REPOSITORY,
    payload: { repository: "acme/relay", pinned: true },
  },
  {
    kind: TASKS_ACT_KIND.TASKS_WRITE_SECTION,
    payload: { kind: TASK_SECTION_WRITE.PLACE, taskId: TASK_ID, sectionId: null },
  },
  { kind: TASKS_ACT_KIND.TASKS_ARCHIVE, payload: { ...TASK, archived: true } },
  { kind: TASKS_ACT_KIND.TASKS_REPOSITORIES, payload: { workspaceId: "workspace-acme" } },
  { kind: TASKS_ACT_KIND.TASKS_SET_REPOSITORY, payload: { ...TASK, repository: "acme/relay" } },
  { kind: TASKS_ACT_KIND.TASKS_MOVE, payload: { ...TASK, workspaceId: "workspace-relay" } },
  { kind: TASKS_ACT_KIND.TASKS_EDIT, payload: EDIT },
  { kind: TASKS_ACT_KIND.GITHUB_OPEN, payload: { url: "https://github.com/acme/relay" } },
  { kind: TASKS_ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
  { kind: TASKS_ACT_KIND.GITHUB_CONNECT, payload: undefined },
  { kind: TASKS_ACT_KIND.GITHUB_DISCONNECT, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_TALK, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_BOARD_SAVE, payload: BOARD },
  { kind: TASKS_ACT_KIND.TASKS_SET_STANDING, payload: { ...TASK, status: "done" } },
  { kind: TASKS_ACT_KIND.TASKS_WORK_EARLIER, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER, payload: undefined },
  { kind: TASKS_ACT_KIND.TASKS_MESSAGES, payload: { ...TASK, after: "0:0" } },
  {
    kind: TASKS_ACT_KIND.TASKS_FILE,
    payload: { ...TASK, path: "README.md", firstLine: 1, lastLine: 2 },
  },
  { kind: TASKS_ACT_KIND.TASKS_TREE, payload: { ...PLAN, path: "src" } },
  { kind: TASKS_ACT_KIND.TASKS_SKILLS, payload: PLAN },
  { kind: TASKS_ACT_KIND.TASKS_PULL_REQUEST, payload: { ...PLACE, number: PULL_REQUEST.number } },
  { kind: TASKS_ACT_KIND.TASKS_ISSUE, payload: { ...PLACE, number: ISSUE.number } },
  { kind: TASKS_ACT_KIND.TASKS_COLOUR_CODE, payload: { language: "ts", code: "const a = 1;" } },
  { kind: TASKS_ACT_KIND.TASKS_REVISIONS, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_REVISION, payload: { ...TASK, seq: 3 } },
  { kind: TASKS_ACT_KIND.TASKS_RESTORE, payload: { ...TASK, seq: 3 } },
  { kind: TASKS_ACT_KIND.TASKS_PAGE_SOURCE, payload: PAGE },
  { kind: TASKS_ACT_KIND.TASKS_PAGES, payload: TASK },
  { kind: TASKS_ACT_KIND.TASKS_PICTURE_READ, payload: { ...PLAN, attachmentId: PICTURE_ID } },
  {
    kind: TASKS_ACT_KIND.TASKS_PICTURE_KEEP,
    payload: { ...PLAN, picture: "data:image/png;base64,iVBORw0KGgo=" },
  },
  { kind: TASKS_ACT_KIND.TASKS_COMMENTS, payload: { ...PLAN, after: "0" } },
  { kind: TASKS_ACT_KIND.TASKS_COMMENT_START, payload: COMMENT_START },
  { kind: TASKS_ACT_KIND.TASKS_COMMENT_ACT, payload: COMMENT_ACT },
];

/** What the fake host and the window's process answer, set by each test before it asks. */
interface Script {
  /** What a start answers. */
  start: TasksStartAnswer;
  /** Whether a call could open now. */
  voiceReady: boolean;
  /** Whether a call is already in progress, about whichever task. */
  callStanding: boolean;
  /** The task the host has open, if any. */
  activeTaskId: string | undefined;
  /** The page the host names to connect the account's own GitHub, or none. */
  connectPage: string | undefined;
  /** Whether GitHub is the account's only way to sign in. */
  lastSignIn: boolean;
  /** A key the host's start answer carries beside what the window reads, as a newer host might. */
  startExtra: boolean;
  /** The HTML the service answers for a page's version, none where it does not answer. */
  pageHtml: string | undefined;
}

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/**
 * A window's act port serving the task procedures alone, opened as the bridge opens one, over a fake host:
 * the window standing as `actor`, trusted or not.
 */
function windowPort(actor: ActSender, options: { trusted?: boolean } = {}) {
  const asked: string[] = [];
  const browsed: string[] = [];
  const talked: string[] = [];
  const script: Script = {
    start: { failure: TASK_CALL_FAILURE.UNANSWERED },
    voiceReady: true,
    callStanding: false,
    activeTaskId: TASK_ID,
    connectPage: CONNECT_PAGE,
    lastSignIn: false,
    startExtra: false,
    pageHtml: undefined,
  };
  const ask = <A>(line: string, answer: () => A) =>
    Effect.sync(() => {
      asked.push(line);
      return answer();
    });
  const host: TasksProceduresDependencies["host"] = {
    tasksRefresh: () => ask("refresh", () => undefined),
    tasksOpen: (taskId) => ask(`open:${taskId}`, () => true),
    tasksClose: () => ask("close", () => undefined),
    tasksDelete: (taskId) => ask(`delete:${taskId}`, () => true),
    tasksRename: (params) => ask(`rename:${params.taskId}:${params.name}`, () => true),
    tasksPin: (params) => ask(`pin:${params.taskId}:${params.pinned}`, () => true),
    tasksPinRepository: (params) =>
      ask(`pin-repository:${params.repository}:${params.pinned}`, () => true),
    tasksWriteSection: (params) => ask(`section:${params.kind}`, () => true),
    tasksArchive: (params) => ask(`archive:${params.taskId}:${params.archived}`, () => false),
    tasksStart: (request) =>
      ask(`start:${request.name ?? ""}`, () =>
        // A key no start answer names, carried on purpose to show the port drops it.
        script.startExtra ? Object.assign({ extra: true }, script.start) : script.start,
      ),
    tasksRepositories: (params) =>
      ask(`repositories:${params.workspaceId}`, () => ({
        failure: TASK_CALL_FAILURE.UNANSWERED,
      })),
    tasksSetRepository: (params) =>
      ask(`repository:${params.taskId}:${params.repository}`, () => ({
        repository: params.repository,
      })),
    tasksMove: (params) =>
      ask(`move:${params.taskId}:${params.workspaceId}`, () => ({
        workspaceId: params.workspaceId,
      })),
    tasksEdit: (params) =>
      ask(
        `edit:${params.taskId}:${"document" in params.edit ? params.edit.document.value : ""}`,
        () => ({ saved: true }) as const,
      ),
    tasksBoardSave: (params) =>
      ask(`board:${params.taskId}:${params.appliedDrawing}`, () => undefined),
    githubConnect: () =>
      ask(
        "github-connect",
        (): TasksGitHubPageAnswer =>
          script.connectPage === undefined
            ? { failure: TASK_CALL_FAILURE.UNANSWERED }
            : { url: script.connectPage },
      ),
    githubDisconnect: () =>
      ask(
        "github-disconnect",
        (): TasksGitHubDisconnectAnswer =>
          script.lastSignIn
            ? { failure: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED }
            : { connection: { connected: false, login: null } },
      ),
    tasksSetStanding: (params) =>
      ask(`standing:${params.taskId}:${params.status ?? ""}`, () => true),
    tasksWorkEarlier: () => ask("earlier", () => undefined),
    tasksConversationEarlier: () => ask("conversation-earlier", () => undefined),
    tasksMessages: (params) =>
      ask(
        `messages:${params.taskId}:${params.callId}:${params.after}`,
        () => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }) as const,
      ),
    tasksFile: (params) =>
      ask(
        `file:${params.path}:${params.firstLine}-${params.lastLine}`,
        () => ({ refusal: TASK_FILE_REFUSAL.MISSING }) as const,
      ),
    tasksTree: (params) =>
      ask(`tree:${params.path}`, () => ({ refusal: TASK_FILE_REFUSAL.NOT_REACHABLE }) as const),
    tasksSkills: (params) =>
      ask(
        `skills:${"planId" in params ? params.planId : params.repository}`,
        () => ({ refusal: TASK_FILE_REFUSAL.NO_REPOSITORY }) as const,
      ),
    tasksPullRequest: (params) =>
      ask(`pullRequest:${params.repository}:${params.number}`, () => {
        if (params.number === PULL_REQUEST.number) return { pullRequest: PULL_REQUEST };
        if (params.number === PULL_REQUEST_NONE) return { pullRequest: null };
        return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
      }),
    tasksIssue: (params) =>
      ask(`issue:${params.repository}:${params.number}`, () => {
        if (params.number === ISSUE.number) return { issue: ISSUE };
        if (params.number === ISSUE_NONE) return { issue: null };
        return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
      }),
    tasksRevisions: (params) =>
      ask(`revisions:${params.taskId}:${params.before}`, () => ({ revisions: [] })),
    tasksRevision: (params) =>
      ask(`revision:${params.seq}`, () => ({ failure: TASK_CALL_FAILURE.UNANSWERED }) as const),
    tasksRestore: (params) => ask(`restore:${params.seq}`, () => true),
    tasksPictureKeep: (params) => ask(`keep:${params.planId}`, () => ({ id: PICTURE_ID })),
    tasksComments: (params) =>
      ask(`comments:${params.planId}:${params.after}`, () => ({ threads: [], cursor: "c1" })),
    tasksCommentStart: (params) =>
      ask(`comment:${params.planId}`, () => ({ refused: PLAN_COMMENT_REFUSAL.TOO_MANY })),
    tasksCommentAct: (params) =>
      ask(`act:${params.threadId}:${params.action.action}`, () => ({ deleted: params.threadId })),
    tasksPicture: (params) =>
      ask(`picture:${params.planId}:${params.attachmentId}`, () =>
        params.attachmentId === PICTURE_ID
          ? { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" }
          : ({ failure: TASK_CALL_FAILURE.NOT_FOUND } as const),
      ),
    tasksPage: (params) =>
      ask(`page:${params.pageId}:${params.version}`, () => {
        const html = script.pageHtml;
        if (html === undefined) return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        return { page: { id: params.pageId, title: "Invite funnel", version: 2, at: 0, html } };
      }),
    tasksPages: (params) =>
      ask(`pages:${params.taskId}`, () => ({
        pages: [{ id: PAGE_LINE_ID, title: "Invite funnel", version: 2, at: 0 }],
      })),
  };
  const port = testActPort(
    tasksProcedures({
      host,
      colourCode: highlightSnippet,
      openExternal: (url) => {
        browsed.push(url);
        return Promise.resolve();
      },
      serviceBaseUrl: SERVICE,
      activeTaskId: () => script.activeTaskId,
      talkAboutTask: (taskId) => {
        talked.push(taskId);
      },
      voiceReady: () => script.voiceReady,
      callStanding: () => script.callStanding,
    }),
  );
  ports.push(port);
  const client = port.as(actor, options);
  return { client, asked, browsed, talked, script };
}

/** Any port kind's procedure, erased to the union of what every one takes and answers. */
type PortCall = (payload: PortActPayload<PortActKind>) => Promise<PortActResult<PortActKind>>;

/** One act called on the port, settled to its answer or the sentence of its refusal. */
async function settled(client: ActPortClient, kind: TasksKind, payload: AnyPayload) {
  // SAFETY: each test pairs a kind with the payload its own procedure takes, or one it refuses on purpose.
  const call = client[kind] as PortCall;
  try {
    return { answer: await call(payload) };
  } catch (error) {
    assert.ok(error instanceof ORPCError);
    assert.equal(error.code, ACT_ERROR.REFUSED);
    return { refused: error.message };
  }
}

it("the voice and call windows are refused every task act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked, browsed, talked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(client, act.kind, act.payload), {
        refused: REFUSAL[act.kind],
      });
    }
    assert.deepEqual(asked, []);
    assert.deepEqual(browsed, []);
    assert.deepEqual(talked, []);
  }
});

it("a frame this build does not trust is refused every task act, even as a panel, and the host is not asked", async () => {
  const { client, asked, browsed, talked } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await settled(client, act.kind, act.payload), {
      refused: REFUSAL[act.kind],
    });
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(browsed, []);
  assert.deepEqual(talked, []);
});

it("the task acts reach the host from a panel and answer what it answered", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (kind: TasksKind, payload: AnyPayload) => settled(client, kind, payload);

  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REFRESH, undefined), { answer: undefined });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SELECT, TASK), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_CLOSE, undefined), { answer: undefined });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_DELETE, TASK), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_RENAME, { ...TASK, name: "  Expiry " }), {
    answer: true,
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_PIN, { ...TASK, pinned: true }), {
    answer: true,
  });
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_PIN_REPOSITORY, { repository: "acme/relay", pinned: false }),
    { answer: true },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_WRITE_SECTION, {
      kind: TASK_SECTION_WRITE.PLACE,
      taskId: TASK_ID,
      sectionId: null,
    }),
    { answer: true },
  );
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_ARCHIVE, { ...TASK, archived: true }), {
    answer: false,
  });
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_REPOSITORIES, { workspaceId: "workspace-acme" }),
    { answer: { failure: TASK_CALL_FAILURE.UNANSWERED } },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_SET_REPOSITORY, { ...TASK, repository: "acme/relay" }),
    { answer: { repository: "acme/relay" } },
  );
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_MOVE, { ...TASK, workspaceId: "workspace-relay" }),
    { answer: { workspaceId: "workspace-relay" } },
  );
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_EDIT, EDIT), { answer: { saved: true } });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_BOARD_SAVE, BOARD), { answer: undefined });

  assert.deepEqual(asked, [
    "refresh",
    `open:${TASK_ID}`,
    "close",
    `delete:${TASK_ID}`,
    `rename:${TASK_ID}:Expiry`,
    `pin:${TASK_ID}:true`,
    "pin-repository:acme/relay:false",
    `section:${TASK_SECTION_WRITE.PLACE}`,
    `archive:${TASK_ID}:true`,
    "repositories:workspace-acme",
    `repository:${TASK_ID}:acme/relay`,
    `move:${TASK_ID}:workspace-relay`,
    `edit:${TASK_ID}:Invites expire.`,
    `board:${TASK_ID}:0`,
  ]);
});

it("a started task opens its call, and one started without planning, with an agent, without voice ready, or over a standing call opens none", async () => {
  const { client, talked, script } = windowPort(PANEL);
  script.start = { planId: TASK_ID };
  const start = (payload: AnyPayload) => settled(client, TASKS_ACT_KIND.TASKS_START, payload);

  const planned = await start({ name: "Invitations" });
  const unplanned = await start({ name: "Typo", planning: false });
  const withAgent = await start({
    name: "Expiry",
    repository: "acme/relay",
    agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
  });
  script.voiceReady = false;
  const unready = await start({ name: "Quiet" });
  script.voiceReady = true;
  script.callStanding = true;
  const overCall = await start({ name: "Busy" });

  assert.deepEqual(planned, { answer: { planId: TASK_ID } });
  for (const other of [unplanned, withAgent, unready, overCall]) assert.deepEqual(other, planned);
  assert.deepEqual(talked, [TASK_ID]);
});

it("a key the host's answer carries beside what the kind's schema names reaches the window no more, the answer encoded by the kind's own schema", async () => {
  const { client, script } = windowPort(PANEL);
  script.start = { planId: TASK_ID };
  script.startExtra = true;

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_START, { name: "Invitations" }), {
    answer: { planId: TASK_ID },
  });
});

it("a start the host could not make is answered with why, and opens no call", async () => {
  const { client, talked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_START, { name: "Invitations" }), {
    answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
  });
  assert.deepEqual(talked, []);
});

it("the microphone's press opens a call about the task the host has open, and is refused in its own words where none is open", async () => {
  const { client, talked, script } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_TALK, undefined), {
    answer: undefined,
  });
  script.activeTaskId = undefined;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_TALK, undefined), {
    refused: REFUSAL[TASKS_ACT_KIND.TASKS_TALK],
  });
  assert.deepEqual(talked, [TASK_ID]);
});

it("a web link opens an http or https address in the browser, and no other scheme nor an address past the cap", async () => {
  const { client, browsed } = windowPort(PANEL);
  const refused = [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "luke://plan/7",
    "mailto:dean@example.com",
    "//example.com/docs",
    "https://",
    `https://example.com/docs?q=${"a".repeat(2_048)}`,
  ];
  const open = (url: string) => settled(client, TASKS_ACT_KIND.WEB_OPEN, { url });

  assert.deepEqual(await open("https://example.com/docs"), { answer: undefined });
  assert.deepEqual(await open("http://localhost:3000/"), { answer: undefined });
  for (const url of refused) {
    assert.deepEqual(await open(url), { refused: REFUSAL[TASKS_ACT_KIND.WEB_OPEN] });
  }
  assert.deepEqual(browsed, ["https://example.com/docs", "http://localhost:3000/"]);
});

it("a GitHub link opens GitHub's own addresses in the browser and no other", async () => {
  const { client, browsed } = windowPort(PANEL);
  const open = (url: string) => settled(client, TASKS_ACT_KIND.GITHUB_OPEN, { url });

  assert.deepEqual(await open("https://github.com/acme/relay"), { answer: undefined });
  assert.deepEqual(await open("https://example.com/acme/relay"), {
    refused: REFUSAL[TASKS_ACT_KIND.GITHUB_OPEN],
  });
  assert.deepEqual(browsed, ["https://github.com/acme/relay"]);
});

it("Connect GitHub opens the page the host named in the browser, Disconnect asks the host and opens nothing, and the last way to sign in is refused in words that say so", async () => {
  const { client, asked, browsed, script } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    answer: undefined,
  });
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_DISCONNECT, undefined), {
    answer: undefined,
  });
  script.connectPage = undefined;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
    refused: REFUSAL[TASKS_ACT_KIND.GITHUB_CONNECT],
  });
  script.lastSignIn = true;
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_DISCONNECT, undefined), {
    refused: GITHUB_LAST_SIGN_IN_REFUSAL,
  });

  assert.deepEqual(browsed, [CONNECT_PAGE]);
  assert.deepEqual(asked, [
    "github-connect",
    "github-disconnect",
    "github-connect",
    "github-disconnect",
  ]);
});

it("a GitHub page the host names off the service's own origin is refused and nothing opens", async () => {
  const { client, browsed, script } = windowPort(PANEL);

  for (const page of [
    "file:///etc/passwd",
    "luke-evil://connect",
    "https://evil.test/connect-github.html",
  ]) {
    script.connectPage = page;
    assert.deepEqual(await settled(client, TASKS_ACT_KIND.GITHUB_CONNECT, undefined), {
      refused: REFUSAL[TASKS_ACT_KIND.GITHUB_CONNECT],
    });
  }
  assert.deepEqual(browsed, []);
});

it("a payload its kind's schema refuses is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_SELECT, { taskId: "   " }), {
    refused: REFUSAL[TASKS_ACT_KIND.TASKS_SELECT],
  });
  assert.deepEqual(
    // SAFETY: a payload sent to a kind that takes none, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_REFRESH, TASK as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_REFRESH] },
  );
  assert.deepEqual(asked, []);
});

it("a payload carrying a key its kind's schema does not name is refused, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    // SAFETY: a key the schema does not name, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_EDIT, { ...EDIT, extra: true } as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_EDIT] },
  );
  assert.deepEqual(
    // SAFETY: a key the schema does not name, refused on purpose.
    await settled(client, TASKS_ACT_KIND.TASKS_DELETE, { ...TASK, extra: true } as AnyPayload),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_DELETE] },
  );
  assert.deepEqual(asked, []);
});

it("what a task holds is read through the host from a panel, and answers what it answered", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (kind: TasksKind, payload: AnyPayload) => settled(client, kind, payload);

  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SET_STANDING, { ...TASK, status: "done" }), {
    answer: true,
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_WORK_EARLIER, undefined), { answer: undefined });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_CONVERSATION_EARLIER, undefined), {
    answer: undefined,
  });
  assert.deepEqual(
    await ask(TASKS_ACT_KIND.TASKS_FILE, { ...TASK, path: "README.md", firstLine: 1, lastLine: 2 }),
    { answer: { refusal: TASK_FILE_REFUSAL.MISSING } },
  );
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_TREE, { ...PLAN, path: "src" }), {
    answer: { refusal: TASK_FILE_REFUSAL.NOT_REACHABLE },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_SKILLS, PLACE), {
    answer: { refusal: TASK_FILE_REFUSAL.NO_REPOSITORY },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REVISIONS, TASK), { answer: { revisions: [] } });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_REVISION, { ...TASK, seq: 3 }), {
    answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_RESTORE, { ...TASK, seq: 3 }), { answer: true });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_PAGES, TASK), {
    answer: { pages: [{ id: PAGE_LINE_ID, title: "Invite funnel", version: 2, at: 0 }] },
  });
  assert.deepEqual(await ask(TASKS_ACT_KIND.TASKS_COMMENT_START, COMMENT_START), {
    answer: { refused: PLAN_COMMENT_REFUSAL.TOO_MANY },
  });

  assert.deepEqual(asked, [
    `standing:${TASK_ID}:done`,
    "earlier",
    "conversation-earlier",
    "file:README.md:1-2",
    "tree:src",
    "skills:acme/relay",
    `revisions:${TASK_ID}:undefined`,
    "revision:3",
    "restore:3",
    `pages:${TASK_ID}`,
    "comment:plan-1",
  ]);
});

it("a fenced block is coloured for a panel, its lines answered as the highlighter drew them", async () => {
  const { client } = windowPort(PANEL);

  const coloured = await settled(client, TASKS_ACT_KIND.TASKS_COLOUR_CODE, {
    language: "ts",
    code: "const a = 1;",
  });

  assert.ok("answer" in coloured && Array.isArray(coloured.answer));
  const [line] = coloured.answer;
  assert.ok(Array.isArray(line));
  assert.equal(line.map((run) => run.text).join(""), "const a = 1;");
  assert.ok(line.some((run) => run.color !== undefined));
});

it("a page's source is read through the host and coloured as HTML for a panel, plain past the bound, and its silence answered", async () => {
  const { client, asked, script } = windowPort(PANEL);
  const source = () => settled(client, TASKS_ACT_KIND.TASKS_PAGE_SOURCE, PAGE);
  const long = `<p>${"a".repeat(70_000)}</p>`;

  const unanswered = await source();
  script.pageHtml = "<h1>Invites</h1>\n<p>sent</p>";
  const read = await source();
  script.pageHtml = long;
  const plain = await source();

  assert.deepEqual(unanswered, { answer: { failure: TASK_CALL_FAILURE.UNANSWERED } });
  // SAFETY: the page-source procedure answers a page source, which the assertion below reads.
  const answer = ("answer" in read ? read.answer : undefined) as TasksPageSourceAnswer | undefined;
  assert.ok(answer !== undefined && "lines" in answer);
  const { lines } = answer;
  assert.deepEqual(
    lines.map((line) => line.map((run) => run.text).join("")),
    ["<h1>Invites</h1>", "<p>sent</p>"],
  );
  assert.ok(lines[0]?.some((run) => run.color !== undefined));
  assert.deepEqual(plain, { answer: { lines: [[{ text: long }]] } });
  assert.deepEqual(asked, ["page:page-funnel:2", "page:page-funnel:2", "page:page-funnel:2"]);
});

it("a planning worker's page is read through the host from a panel", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_MESSAGES, {
      ...TASK,
      callId: "call-models",
      after: "0:0",
    }),
    { answer: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } },
  );
  assert.deepEqual(asked, [`messages:${TASK_ID}:call-models:0:0`]);
});

it("a plan's picture is read through the host from a panel, its absence answered rather than refused, and one is kept", async () => {
  const { client, asked } = windowPort(PANEL);
  const read = (attachmentId: string) =>
    settled(client, TASKS_ACT_KIND.TASKS_PICTURE_READ, { ...PLAN, attachmentId });

  assert.deepEqual(await read(PICTURE_ID), {
    answer: { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" },
  });
  assert.deepEqual(await read("picture-gone"), {
    answer: { failure: TASK_CALL_FAILURE.NOT_FOUND },
  });
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_PICTURE_KEEP, {
      ...PLAN,
      picture: "data:image/png;base64,iVBORw0KGgo=",
    }),
    { answer: { id: PICTURE_ID } },
  );
  assert.deepEqual(asked, [
    `picture:plan-1:${PICTURE_ID}`,
    "picture:plan-1:picture-gone",
    "keep:plan-1",
  ]);
});

it("a plan's comments are read and acted on through the host from a panel", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COMMENTS, { ...PLAN, after: "0" }), {
    answer: { threads: [], cursor: "c1" },
  });
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_COMMENT_ACT, COMMENT_ACT), {
    answer: { deleted: THREAD_ID },
  });
  assert.deepEqual(asked, ["comments:plan-1:0", `act:${THREAD_ID}:resolve`]);
});

it("a pull request is answered to a panel as the host read it, or as none, and a service that did not answer is refused in its kind's own words", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (number: number) =>
    settled(client, TASKS_ACT_KIND.TASKS_PULL_REQUEST, { ...PLACE, number });

  assert.deepEqual(await ask(PULL_REQUEST.number), { answer: PULL_REQUEST });
  assert.deepEqual(await ask(PULL_REQUEST_NONE), { answer: null });
  assert.deepEqual(await ask(44), { refused: REFUSAL[TASKS_ACT_KIND.TASKS_PULL_REQUEST] });
  assert.deepEqual(asked, [
    `pullRequest:acme/relay:${PULL_REQUEST.number}`,
    `pullRequest:acme/relay:${PULL_REQUEST_NONE}`,
    "pullRequest:acme/relay:44",
  ]);
});

it("an issue is answered to a panel as the host read it, or as none, and a service that did not answer is refused in its kind's own words", async () => {
  const { client, asked } = windowPort(PANEL);
  const ask = (number: number) => settled(client, TASKS_ACT_KIND.TASKS_ISSUE, { ...PLACE, number });

  assert.deepEqual(await ask(ISSUE.number), { answer: ISSUE });
  assert.deepEqual(await ask(ISSUE_NONE), { answer: null });
  assert.deepEqual(await ask(9), { refused: REFUSAL[TASKS_ACT_KIND.TASKS_ISSUE] });
  assert.deepEqual(asked, [
    `issue:acme/relay:${ISSUE.number}`,
    `issue:acme/relay:${ISSUE_NONE}`,
    "issue:acme/relay:9",
  ]);
});

it("a content act's payload carrying a key its schema does not name, or past its bound, is refused in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL);

  for (const act of ACTS.slice(
    ACTS.findIndex((each) => each.kind === TASKS_ACT_KIND.TASKS_SET_STANDING),
  )) {
    // SAFETY: every content kind but the two earlier-page presses takes an object payload, which ACTS gives it.
    const payload =
      act.payload === undefined ? { extra: true } : { ...(act.payload as object), extra: true };
    assert.deepEqual(
      // SAFETY: a key the schema does not name, refused on purpose.
      await settled(client, act.kind, payload as AnyPayload),
      { refused: REFUSAL[act.kind] },
    );
  }
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_COLOUR_CODE, {
      language: "ts",
      code: "a".repeat(20_001),
    }),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_COLOUR_CODE] },
  );
  assert.deepEqual(
    await settled(client, TASKS_ACT_KIND.TASKS_COLOUR_CODE, { language: "  ", code: "a" }),
    { refused: REFUSAL[TASKS_ACT_KIND.TASKS_COLOUR_CODE] },
  );
  assert.deepEqual(await settled(client, TASKS_ACT_KIND.TASKS_SET_STANDING, TASK), {
    refused: REFUSAL[TASKS_ACT_KIND.TASKS_SET_STANDING],
  });
  assert.deepEqual(asked, []);
});
