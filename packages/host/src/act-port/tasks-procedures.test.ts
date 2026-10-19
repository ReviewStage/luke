import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  TASK_CALL_FAILURE,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksStartAnswer,
} from "@luke/features/tasks-view";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context, Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { GITHUB_LAST_SIGN_IN_REFUSAL } from "../acts.js";
import {
  ACT_ERROR,
  type ActPortClient,
  type PortActKind,
  type PortActPayload,
  type PortActResult,
  TASKS_ACT_KIND,
} from "../contract/index.js";
import {
  type AccountAskProceduresDependencies,
  createActPortHandler,
  type IssueProceduresDependencies,
  type TasksProceduresDependencies,
  type WorkspaceProceduresDependencies,
} from "./index.js";

/**
 * The task list and lifecycle acts, through the act port as a window calls
 * them: only a panel of this build's own renderer asks; the voice and call
 * windows, and a frame this build does not trust, are refused in each
 * kind's own words before the host is asked; a panel's ask reaches the host
 * with its payload as the kind's schema read it, and answers what the host
 * answered; a started task opens its call where it planned and voice is
 * ready; a microphone press opens a call about the task the host has open;
 * and the browser opens only the addresses each kind may open.
 */

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
} as const;

type TasksKind = keyof typeof REFUSAL;

/** What any port kind takes, the union a test hands one kind or refuses on purpose. */
type AnyPayload = PortActPayload<PortActKind>;

const TASK = { taskId: TASK_ID };
const EDIT = { ...TASK, edit: { document: { base: "", value: "Invites expire." } } };
const BOARD = { ...TASK, elements: [], appliedDrawing: 0 };

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
}

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/**
 * A window's act port, opened as the bridge opens one, over a fake host:
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
  };
  // SAFETY: no account ask is called here, so the account asks' host is never reached.
  const accountAsks = { host: {} } as AccountAskProceduresDependencies;
  // SAFETY: no issue act is called here, so the issues' host is never reached.
  const issues = { host: {} } as IssueProceduresDependencies;
  // SAFETY: no workspace act is called here, so the workspaces' host is never reached.
  const workspaces = { host: {} } as WorkspaceProceduresDependencies;
  const handler = createActPortHandler({
    accountAsks,
    issues,
    tasks: {
      host,
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
    },
    workspaces,
  });
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  handler.upgrade(port1, {
    context: () => ({
      actor,
      trusted: options.trusted ?? true,
      "effect/context": Context.empty(),
    }),
  });
  port1.start();
  const client: ActPortClient = createORPCClient(new RPCLink({ port: port2 }));
  port2.start();
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

it("a payload carrying a key its kind's schema does not name is refused, as app:act refused it, and the host is not asked", async () => {
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
