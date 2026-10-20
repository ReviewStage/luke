import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import { PICTURE_TYPE } from "@luke/features/picture-wire";
import { PLAN_COMMENT_ACTION, PLAN_COMMENT_REFUSAL } from "@luke/features/plan-comment-wire";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import { TASK_FILE_REFUSAL } from "@luke/features/task-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksStartAnswer,
} from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import { highlightSnippet } from "../task-code.js";
import { type ActRows, type ActSender, createActRouter } from "./router.js";
import { tasksActRows } from "./tasks-acts.js";

/** The one picture the fake host holds. */
/** A comment thread's id, as the service spells one. */
const THREAD_ID = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";

const PICTURE_ID = "picture-1";

// The platform's handle on the window that asked, which no row here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SERVICE = "https://luke.test";
const ACME = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: { login: "acme", active: true },
};
const CONNECT_PAGE = `${SERVICE}/connect-github.html?intent=intent-1`;
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

/** The task the host has open, as the fixture's main process reads it. */
interface OpenTask {
  activeTaskId: string | undefined;
}

/** What the host answers a start with, and whether voice could open a call now. */
interface StartScript {
  answer: TasksStartAnswer;
  voiceReady: boolean;
  /** Whether a call is already in progress, about whichever task. */
  callStanding: boolean;
}

/** The HTML the service answers for a page's version, none where it does not answer. */
interface PageScript {
  html: string | undefined;
}

function fixture() {
  const asked: string[] = [];
  const page: PageScript = { html: undefined };
  const talked: string[] = [];
  const opened: string[] = [];
  const view: OpenTask = { activeTaskId: TASK_ID };
  /**
   * Whether GitHub is the account's only way to sign in, whether the host
   * names no page to connect the account's own GitHub, and the page it
   * names to connect it.
   */
  const host = {
    lastSignIn: false,
    githubUnanswered: false,
    connectPage: CONNECT_PAGE,
  };
  const start: StartScript = {
    answer: { failure: TASK_CALL_FAILURE.UNANSWERED },
    voiceReady: true,
    callStanding: false,
  };
  const rows = tasksActRows({
    host: {
      tasksRefresh: () => Effect.sync(() => void asked.push("refresh")),
      tasksWorkEarlier: () => Effect.sync(() => void asked.push("earlier")),
      tasksConversationEarlier: () => Effect.sync(() => void asked.push("conversation-earlier")),
      tasksMessages: (params) =>
        Effect.sync(() => {
          asked.push(`messages:${params.taskId}:${params.callId}:${params.after}`);
          return { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;
        }),
      tasksClose: () => Effect.sync(() => void asked.push("close")),
      tasksOpen: (taskId) =>
        Effect.sync(() => {
          asked.push(`open:${taskId}`);
          return true;
        }),
      tasksDelete: (taskId) =>
        Effect.sync(() => {
          asked.push(`delete:${taskId}`);
          return true;
        }),
      tasksRename: (params) =>
        Effect.sync(() => {
          asked.push(`rename:${params.taskId}:${params.name}`);
          return true;
        }),
      tasksSetStanding: (params) =>
        Effect.sync(() => {
          asked.push(`standing:${params.taskId}`);
          return true;
        }),
      tasksPin: (params) =>
        Effect.sync(() => {
          asked.push(`pin:${params.taskId}:${params.pinned}`);
          return true;
        }),
      tasksPinRepository: (params) =>
        Effect.sync(() => {
          asked.push(`pin-repository:${params.repository}:${params.pinned}`);
          return true;
        }),
      tasksWriteSection: (params) =>
        Effect.sync(() => {
          asked.push(`section:${params.kind}`);
          return true;
        }),
      tasksArchive: (params) =>
        Effect.sync(() => {
          asked.push(`archive:${params.taskId}:${params.archived}`);
          return false;
        }),
      tasksStart: (request) =>
        Effect.sync(() => {
          asked.push(`start:${request.repository}`);
          return start.answer;
        }),
      tasksRepositories: (params) =>
        Effect.sync(() => {
          asked.push(`repositories:${params.workspaceId}`);
          return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        }),
      tasksSetRepository: (params) =>
        Effect.sync(() => {
          asked.push(`repository:${params.taskId}:${params.repository}`);
          return { repository: params.repository };
        }),
      tasksMove: (params) =>
        Effect.sync(() => {
          asked.push(`move:${params.taskId}:${params.workspaceId}`);
          return { workspaceId: params.workspaceId };
        }),
      tasksEdit: (params) =>
        Effect.sync(() => {
          const value = "document" in params.edit ? params.edit.document.value : "";
          asked.push(`edit:${params.taskId}:${value}`);
          return { saved: true } as const;
        }),
      tasksBoardSave: (params) =>
        Effect.sync(() => void asked.push(`board:${params.taskId}:${params.appliedDrawing}`)),
      tasksFile: (params) =>
        Effect.sync(() => {
          asked.push(`file:${params.path}:${params.firstLine}-${params.lastLine}`);
          return { refusal: TASK_FILE_REFUSAL.MISSING } as const;
        }),
      tasksTree: (params) =>
        Effect.sync(() => {
          asked.push(`tree:${params.path}`);
          return { refusal: TASK_FILE_REFUSAL.NOT_REACHABLE } as const;
        }),
      tasksSkills: (params) =>
        Effect.sync(() => {
          asked.push(`skills:${"planId" in params ? params.planId : params.repository}`);
          return { refusal: TASK_FILE_REFUSAL.NO_REPOSITORY } as const;
        }),
      tasksPullRequest: (params) =>
        Effect.sync(() => {
          asked.push(`pullRequest:${params.repository}:${params.number}`);
          if (params.number === PULL_REQUEST.number) return { pullRequest: PULL_REQUEST };
          if (params.number === PULL_REQUEST_NONE) return { pullRequest: null };
          return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        }),
      tasksIssue: (params) =>
        Effect.sync(() => {
          asked.push(`issue:${params.repository}:${params.number}`);
          if (params.number === ISSUE.number) return { issue: ISSUE };
          if (params.number === ISSUE_NONE) return { issue: null };
          return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        }),
      tasksRevisions: (params) =>
        Effect.sync(() => {
          asked.push(`revisions:${params.taskId}:${params.before}`);
          return { revisions: [] };
        }),
      tasksRevision: (params) =>
        Effect.sync(() => {
          asked.push(`revision:${params.seq}`);
          return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
        }),
      tasksRestore: (params) =>
        Effect.sync(() => {
          asked.push(`restore:${params.seq}`);
          return true;
        }),
      tasksPictureKeep: (params) =>
        Effect.sync(() => {
          asked.push(`keep:${params.planId}`);
          return { id: PICTURE_ID };
        }),
      tasksComments: (params) =>
        Effect.sync(() => {
          asked.push(`comments:${params.planId}:${params.after}`);
          return { threads: [], cursor: "c1" };
        }),
      tasksCommentStart: (params) =>
        Effect.sync(() => {
          asked.push(`comment:${params.planId}`);
          return { refused: PLAN_COMMENT_REFUSAL.TOO_MANY };
        }),
      tasksCommentAct: (params) =>
        Effect.sync(() => {
          asked.push(`act:${params.threadId}:${params.action.action}`);
          return { deleted: params.threadId };
        }),
      tasksPicture: (params) =>
        Effect.sync(() => {
          asked.push(`picture:${params.planId}:${params.attachmentId}`);
          return params.attachmentId === PICTURE_ID
            ? { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" }
            : ({ failure: TASK_CALL_FAILURE.NOT_FOUND } as const);
        }),
      tasksPage: (params) =>
        Effect.sync(() => {
          asked.push(`page:${params.pageId}:${params.version}`);
          const { html } = page;
          if (html === undefined) return { failure: TASK_CALL_FAILURE.UNANSWERED } as const;
          return { page: { id: params.pageId, title: "Invite funnel", version: 2, at: 0, html } };
        }),
      tasksPages: (params) =>
        Effect.sync(() => {
          asked.push(`pages:${params.taskId}`);
          return { pages: [{ id: "page-1", title: "Invite funnel", version: 2, at: 0 }] };
        }),
      githubConnect: () =>
        Effect.sync((): TasksGitHubPageAnswer => {
          asked.push("github-connect");
          return host.githubUnanswered
            ? { failure: TASK_CALL_FAILURE.UNANSWERED }
            : { url: host.connectPage };
        }),
      githubDisconnect: () =>
        Effect.sync((): TasksGitHubDisconnectAnswer => {
          asked.push("github-disconnect");
          return host.lastSignIn
            ? { failure: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED }
            : { connection: { connected: false, login: null } };
        }),
    },
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    serviceBaseUrl: SERVICE,
    activeTaskId: () => view.activeTaskId,
    talkAboutTask: (taskId) => {
      talked.push(taskId);
    },
    voiceReady: () => start.voiceReady,
    callStanding: () => start.callStanding,
    colourCode: highlightSnippet,
  });
  // SAFETY: only the task rows are under test; the router dispatches on
  // the kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked, talked, opened, view, start, page, host };
}
it.effect(
  "the developer's edit of the text reaches the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const edit = {
        kind: ACT_KIND.TASKS_EDIT,
        payload: {
          taskId: TASK_ID,
          edit: { document: { base: "", value: "Invites expire." } },
        },
      } as const;

      const saved = yield* f.router.performAct(edit, PANEL);
      const fromVoice = yield* f.router.performAct(edit, VOICE);

      assert.deepEqual(saved, { status: ACT_OUTCOME_STATUS.DONE, value: { saved: true } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`edit:${TASK_ID}:Invites expire.`]);
    }),
);
it.effect(
  "a web link opens an http or https address in the browser, and no other scheme nor an address past the cap",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const refused = [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "luke://plan/7",
        "mailto:dean@example.com",
        "//example.com/docs",
        "https://",
        `https://example.com/docs?q=${"a".repeat(2_048)}`,
      ];

      const opened = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        PANEL,
      );
      const plain = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "http://localhost:3000/" } },
        PANEL,
      );
      const fromVoice = yield* f.router.performAct(
        { kind: ACT_KIND.WEB_OPEN, payload: { url: "https://example.com/docs" } },
        VOICE,
      );
      const outcomes = yield* Effect.forEach(refused, (url) =>
        f.router.performAct(
          // SAFETY: an address the schema refuses is sent as the shape it would arrive in.
          { kind: ACT_KIND.WEB_OPEN, payload: { url } } as never,
          PANEL,
        ),
      );

      assert.equal(opened.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(plain.status, ACT_OUTCOME_STATUS.DONE);
      assert.notEqual(fromVoice.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(
        outcomes.map((outcome) => outcome.status === ACT_OUTCOME_STATUS.DONE),
        refused.map(() => false),
      );
      assert.deepEqual(f.opened, ["https://example.com/docs", "http://localhost:3000/"]);
    }),
);

it.effect(
  "a started task opens its call, and one started without planning or with an agent opens none",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      f.start.answer = { planId: TASK_ID };

      const planned = yield* f.router.performAct(
        { kind: ACT_KIND.TASKS_START, payload: { name: "Invitations" } },
        PANEL,
      );
      const unplanned = yield* f.router.performAct(
        { kind: ACT_KIND.TASKS_START, payload: { name: "Typo", planning: false } },
        PANEL,
      );
      const withAgent = yield* f.router.performAct(
        {
          kind: ACT_KIND.TASKS_START,
          payload: {
            name: "Expiry",
            repository: "acme/relay",
            agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
          },
        },
        PANEL,
      );

      assert.deepEqual(planned, { status: ACT_OUTCOME_STATUS.DONE, value: { planId: TASK_ID } });
      assert.deepEqual(unplanned, planned);
      assert.deepEqual(withAgent, planned);
      assert.deepEqual(f.talked, [TASK_ID]);
    }),
);

it.effect("the voice window does not reach the plans", () =>
  Effect.gen(function* () {
    const f = fixture();
    const board = { taskId: TASK_ID, elements: [], appliedDrawing: 0 };

    const selected = yield* f.router.performAct(
      { kind: ACT_KIND.TASKS_SELECT, payload: { taskId: TASK_ID } },
      VOICE,
    );
    const saved = yield* f.router.performAct(
      { kind: ACT_KIND.TASKS_BOARD_SAVE, payload: board },
      VOICE,
    );
    assert.deepEqual(selected, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.TASKS_SELECT].refusal,
    });
    const sectioned = yield* f.router.performAct(
      {
        kind: ACT_KIND.TASKS_WRITE_SECTION,
        payload: { kind: TASK_SECTION_WRITE.PLACE, taskId: TASK_ID, sectionId: null },
      },
      VOICE,
    );
    assert.deepEqual(saved, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.TASKS_BOARD_SAVE].refusal,
    });
    assert.deepEqual(sectioned, {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.TASKS_WRITE_SECTION].refusal,
    });
    assert.deepEqual(f.asked, []);
  }),
);

it.effect(
  "a page's source is read through the host and coloured as HTML for a panel, plain past the bound, and not for the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const source = {
        kind: ACT_KIND.TASKS_PAGE_SOURCE,
        payload: { taskId: TASK_ID, pageId: "page-funnel", version: 2 },
      } as const;
      const long = `<p>${"a".repeat(70_000)}</p>`;

      const unanswered = yield* f.router.performAct(source, PANEL);
      f.page.html = "<h1>Invites</h1>\n<p>sent</p>";
      const read = yield* f.router.performAct(source, PANEL);
      const fromVoice = yield* f.router.performAct(source, VOICE);
      f.page.html = long;
      const plain = yield* f.router.performAct(source, PANEL);

      assert.deepEqual(unanswered, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: TASK_CALL_FAILURE.UNANSWERED },
      });
      assert.ok(read.status === ACT_OUTCOME_STATUS.DONE && "lines" in read.value);
      const { lines } = read.value;
      assert.deepEqual(
        lines.map((line) => line.map((run) => run.text).join("")),
        ["<h1>Invites</h1>", "<p>sent</p>"],
      );
      assert.ok(lines[0]?.some((run) => run.color !== undefined));
      assert.deepEqual(fromVoice, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.TASKS_PAGE_SOURCE].refusal,
      });
      assert.deepEqual(plain, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { lines: [[{ text: long }]] },
      });
      assert.deepEqual(f.asked, ["page:page-funnel:2", "page:page-funnel:2", "page:page-funnel:2"]);
    }),
);

it.effect(
  "a planning worker's page is read through the host from a panel, and not from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const page = {
        kind: ACT_KIND.TASKS_MESSAGES,
        payload: { taskId: TASK_ID, callId: "call-models", after: "0:0" },
      } as const;

      const read = yield* f.router.performAct(page, PANEL);
      const fromVoice = yield* f.router.performAct(page, VOICE);

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, [`messages:${TASK_ID}:call-models:0:0`]);
    }),
);

it.effect(
  "a plan's picture is read through the host from a panel, its absence answered rather than refused, and never from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const ask = (attachmentId: string) => ({
        kind: ACT_KIND.TASKS_PICTURE_READ,
        payload: { planId: "plan-1", attachmentId },
      });

      const read = yield* f.router.performAct(ask(PICTURE_ID), PANEL);
      const gone = yield* f.router.performAct(ask("picture-gone"), PANEL);
      const fromVoice = yield* f.router.performAct(ask(PICTURE_ID), VOICE);

      assert.deepEqual(read, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { contentType: PICTURE_TYPE.WEBP, base64: "UklGRg==" },
      });
      assert.deepEqual(gone, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { failure: TASK_CALL_FAILURE.NOT_FOUND },
      });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
    }),
);

it.effect(
  "a plan's comments are read and written through the host from a panel alone, never from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const read = { kind: ACT_KIND.TASKS_COMMENTS, payload: { planId: "plan-1", after: "0" } };
      const act = {
        kind: ACT_KIND.TASKS_COMMENT_ACT,
        payload: {
          planId: "plan-1",
          threadId: THREAD_ID,
          action: { action: PLAN_COMMENT_ACTION.RESOLVE },
        },
      };

      const readFromPanel = yield* f.router.performAct(read, PANEL);
      const actFromPanel = yield* f.router.performAct(act, PANEL);
      const readFromVoice = yield* f.router.performAct(read, VOICE);

      assert.deepEqual(readFromPanel, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { threads: [], cursor: "c1" },
      });
      assert.deepEqual(actFromPanel, {
        status: ACT_OUTCOME_STATUS.DONE,
        value: { deleted: THREAD_ID },
      });
      assert.equal(readFromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, ["comments:plan-1:0", `act:${THREAD_ID}:resolve`]);
    }),
);

it.effect(
  "a picture is kept through the host from a panel alone, never from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const keep = {
        kind: ACT_KIND.TASKS_PICTURE_KEEP,
        payload: { planId: "plan-1", picture: "data:image/png;base64,iVBORw0KGgo=" },
      };

      const kept = yield* f.router.performAct(keep, PANEL);
      const fromVoice = yield* f.router.performAct(keep, VOICE);

      assert.deepEqual(kept, { status: ACT_OUTCOME_STATUS.DONE, value: { id: PICTURE_ID } });
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(f.asked, ["keep:plan-1"]);
    }),
);

it.effect(
  "a pull request is answered to a panel as the host read it, or as none, a service that did not answer is refused in its kind's own words, and the voice window is refused before the host is asked",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const ask = (number: number) =>
        ({
          kind: ACT_KIND.TASKS_PULL_REQUEST,
          payload: { workspaceId: ACME.id, repository: "acme/relay", number },
        }) as const;

      const fromVoice = yield* f.router.performAct(ask(PULL_REQUEST.number), VOICE);
      const read = yield* f.router.performAct(ask(PULL_REQUEST.number), PANEL);
      const none = yield* f.router.performAct(ask(PULL_REQUEST_NONE), PANEL);
      const unanswered = yield* f.router.performAct(ask(44), PANEL);

      const refused = {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.TASKS_PULL_REQUEST].refusal,
      };
      assert.deepEqual(fromVoice, refused);
      assert.deepEqual(read, { status: ACT_OUTCOME_STATUS.DONE, value: PULL_REQUEST });
      assert.deepEqual(none, { status: ACT_OUTCOME_STATUS.DONE, value: null });
      assert.deepEqual(unanswered, refused);
      assert.deepEqual(f.asked, [
        `pullRequest:acme/relay:${PULL_REQUEST.number}`,
        `pullRequest:acme/relay:${PULL_REQUEST_NONE}`,
        "pullRequest:acme/relay:44",
      ]);
    }),
);

it.effect(
  "an issue is answered to a panel as the host read it, or as none, a service that did not answer is refused in its kind's own words, and the voice window is refused before the host is asked",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const ask = (number: number) =>
        ({
          kind: ACT_KIND.TASKS_ISSUE,
          payload: { workspaceId: ACME.id, repository: "acme/relay", number },
        }) as const;

      const fromVoice = yield* f.router.performAct(ask(ISSUE.number), VOICE);
      const read = yield* f.router.performAct(ask(ISSUE.number), PANEL);
      const none = yield* f.router.performAct(ask(ISSUE_NONE), PANEL);
      const unanswered = yield* f.router.performAct(ask(9), PANEL);

      const refused = {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.TASKS_ISSUE].refusal,
      };
      assert.deepEqual(fromVoice, refused);
      assert.deepEqual(read, { status: ACT_OUTCOME_STATUS.DONE, value: ISSUE });
      assert.deepEqual(none, { status: ACT_OUTCOME_STATUS.DONE, value: null });
      assert.deepEqual(unanswered, refused);
      assert.deepEqual(f.asked, [
        `issue:acme/relay:${ISSUE.number}`,
        `issue:acme/relay:${ISSUE_NONE}`,
        "issue:acme/relay:9",
      ]);
    }),
);

it.effect(
  "Connect GitHub opens the page the host named in the browser, Disconnect asks the host and opens nothing, and neither from the voice window",
  () =>
    Effect.gen(function* () {
      const f = fixture();

      const connected = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);
      const disconnected = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_DISCONNECT }, PANEL);
      const fromVoice = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, VOICE);
      f.host.githubUnanswered = true;
      const unanswered = yield* f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);

      assert.equal(connected.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(disconnected.status, ACT_OUTCOME_STATUS.DONE);
      assert.equal(fromVoice.status, ACT_OUTCOME_STATUS.REFUSED);
      assert.deepEqual(unanswered, {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.GITHUB_CONNECT].refusal,
      });
      assert.deepEqual(f.opened, [CONNECT_PAGE]);
      assert.equal(f.asked.includes("github-disconnect"), true);
      f.host.lastSignIn = true;
      assert.deepEqual(yield* f.router.performAct({ kind: ACT_KIND.GITHUB_DISCONNECT }, PANEL), {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: GITHUB_LAST_SIGN_IN_REFUSAL,
      });
    }),
);

it.effect(
  "a GitHub page the host names off the service's own origin is refused and nothing opens",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pages = [
        "file:///etc/passwd",
        "luke-evil://connect",
        "https://evil.test/connect-github.html",
      ];

      const refused = yield* Effect.forEach(pages, (page) => {
        f.host.connectPage = page;
        return f.router.performAct({ kind: ACT_KIND.GITHUB_CONNECT }, PANEL);
      });

      assert.deepEqual(
        refused,
        pages.map(() => ({
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: ACT[ACT_KIND.GITHUB_CONNECT].refusal,
        })),
      );
      assert.deepEqual(f.opened, []);
    }),
);
