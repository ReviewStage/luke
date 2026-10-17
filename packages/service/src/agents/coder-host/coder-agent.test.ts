import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHAT_NOTICE_LEAD } from "@luke/features/chat-wire";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { Duration, Redacted, Schema } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { serializeModelInputSchema } from "eve/tools";
import { test } from "vitest";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { toolsOf } from "../agent-runtime/tools.js";
import { DEPLOYMENT_PRESENCE, lukeAccount } from "../brain-host/auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../brain-host/bounds.js";
import { BRAIN_HOST_TURN_POLICY } from "../brain-host/channel.js";
import { CODER } from "./bounds.js";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "./channel.js";
import { CHAT_TOOLS } from "./chat.js";
import { INBOX_TOOLS } from "./inbox.js";
import { coderInstructions } from "./instructions.js";
import { SLEEP_TOOL } from "./sleep.js";
import { CODER_TOOL, taskToolsOf } from "./tool-set.js";

/** The link of the task an agent on one works on, as its instructions are handed it. */
const TASK_ADDRESS = "https://tryluke.dev/acme/plan/pl_1";

const SECRET = "cron-secret-1";
const ACCOUNT = "user-a";
const CONVERSATION = "5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";
const OWN_SESSION = "wrun_01SESSIONOFACCOUNTA0000000";
const OTHER_SESSION = "wrun_01SESSIONOFACCOUNTB0000000";

/** What the door answered: the principal it admitted, or the word it refused with. */
type DoorAnswer =
  | { readonly admitted: SessionAuthContext; readonly refused?: undefined }
  | { readonly refused: string; readonly admitted?: undefined };

/** The deployment's request on an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentRequest(sessionId: string, turn: string | undefined, method = "POST"): Request {
  return new Request(`https://luke.test/eve/v1/session/${sessionId}`, {
    method,
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      ...(turn === undefined ? undefined : { [BRAIN_HOST_HEADER.TURN]: turn }),
    },
  });
}

/** The deployment's opening of an agent's session under its secret, naming the account, the conversation, and the kind of turn given. */
function deploymentOpening(turn: string): Request {
  return new Request("https://luke.test/eve/v1/session", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      [BRAIN_HOST_HEADER.ACCOUNT]: ACCOUNT,
      [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
      [BRAIN_HOST_HEADER.TURN]: turn,
    },
  });
}

test("a follow-up steers the turn under way; the deployment's typed line on the named account's own agent session, and its typed opening of the account's own conversation, are minted as the developer's own principal, authenticator, type, and id, which is what eve steers the running turn on, with the deployment named as its carrier; a spoken turn, a stream, and another account's session are refused", async () => {
  const channel = coderChannelInput(
    async () => undefined,
    {
      reachesSession: async (userId, sessionId) => userId === ACCOUNT && sessionId === OWN_SESSION,
      reachesConversation: async (userId, conversationId) =>
        userId === ACCOUNT && conversationId === CONVERSATION,
    },
    {
      secret: Redacted.make(SECRET),
      admits: CODER_DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.ACCOUNT,
    },
  );
  assert.equal(channel.turnPolicy, BRAIN_HOST_TURN_POLICY.STEER);
  const door = async (request: Request): Promise<DoorAnswer> => {
    const answer = await routeAuth(request, channel.auth);
    if (!(answer instanceof Response)) return { admitted: answer };
    // SAFETY: eve's own refusal body, whose `error` field is the word the door threw.
    const refusal = (await answer.json()) as { error: string };
    return { refused: refusal.error };
  };

  // The developer's own follow-up on the same session, as the agent's turn runs under it.
  const developer = await lukeAccount(async () => ACCOUNT)(
    new Request(`https://luke.test/eve/v1/session/${OWN_SESSION}`, {
      method: "POST",
      headers: {
        authorization: "Bearer developer-token",
        [BRAIN_HOST_HEADER.CONVERSATION]: CONVERSATION,
        [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
      },
    }),
  );
  const { admitted: carried } = await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.TYPED));
  assert.ok(developer);
  assert.ok(carried);
  assert.deepEqual(
    [carried.authenticator, carried.principalType, carried.principalId],
    [developer.authenticator, developer.principalType, developer.principalId],
  );
  assert.deepEqual(carried.attributes, {
    ...developer.attributes,
    [BRAIN_HOST_ATTRIBUTE.CARRIER]: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  });

  // The start of an agent: the deployment opens the account's own conversation as the developer too.
  const { admitted: opened } = await door(deploymentOpening(BRAIN_HOST_TURN.TYPED));
  assert.ok(opened);
  assert.deepEqual(
    [opened.authenticator, opened.principalType, opened.principalId, opened.attributes],
    [developer.authenticator, developer.principalType, developer.principalId, carried.attributes],
  );

  assert.deepEqual(await door(deploymentRequest(OWN_SESSION, BRAIN_HOST_TURN.SPOKEN)), {
    refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT,
  });
  assert.deepEqual(await door(deploymentOpening(BRAIN_HOST_TURN.SPOKEN)), {
    refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT,
  });
  assert.deepEqual(
    await door(deploymentRequest(`${OWN_SESSION}/stream`, BRAIN_HOST_TURN.TYPED, "GET")),
    { refused: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT },
  );
  assert.deepEqual(await door(deploymentRequest(OTHER_SESSION, BRAIN_HOST_TURN.TYPED)), {
    refused: BRAIN_HOST_REFUSAL.NOT_OWNER,
  });
});

test("an agent on a task is told of the task's links and pages, and one an automation started with no task of neither", () => {
  const TASK_LINK = "`https://tryluke.dev/<workspace>/plan/<id>` link names a task";
  const PAGES = `show it with \`${CODER_TOOL.SHOW_PAGE}\``;
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const onTask = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS);
    const taskless = coderInstructions("Acme/Relay", brief, true, null);
    assert.deepEqual([onTask.includes(TASK_LINK), onTask.includes(PAGES)], [true, true], brief);
    assert.deepEqual(
      [taskless.includes(TASK_LINK), taskless.includes(PAGES)],
      [false, false],
      brief,
    );
    assert.ok(taskless.includes("## The developer's inbox"), "a planless agent keeps its inbox");
    assert.ok(!taskless.includes("luke://plan/"), "nor an older message's plan link");
  }
});

test("an agent handed its task's plan is offered edit_plan and show_page, one handed a prompt on a task show_page alone, and one an automation started with no task neither", () => {
  const offered = (agent: Parameters<typeof taskToolsOf>[0]) => [...taskToolsOf(agent)].sort();
  assert.deepEqual(offered({ taskId: "plan-1", prompt: null }), [
    CODER_TOOL.EDIT_PLAN,
    CODER_TOOL.SHOW_PAGE,
  ]);
  assert.deepEqual(offered({ taskId: "plan-1", prompt: "Fix the flaky test." }), [
    CODER_TOOL.SHOW_PAGE,
  ]);
  assert.deepEqual(offered({ taskId: null, prompt: "Sweep the flaky tests." }), []);
});

test("the session and the post tool are told never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.ok(
      coderInstructions("Acme/Relay", brief, false, TASK_ADDRESS).includes(
        "Never ask for a credential or a secret in a form",
      ),
      brief,
    );
  }
  assert.ok(
    INBOX_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
  assert.ok(
    CHAT_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
});

test("the session and the post tool send whatever is ready for the developer to look at or review to the inbox, a pull request among it, and a test only the developer can run", () => {
  const READY = "ready for them to look at or review";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const taskLink of [TASK_ADDRESS, null]) {
      const inbox = coderInstructions("Acme/Relay", brief, true, taskLink).split(
        "## The developer's inbox",
      )[1];
      assert.ok(inbox?.includes(READY), brief);
      assert.ok(inbox?.includes("a pull request you opened or marked ready"), brief);
      assert.ok(inbox?.includes("needs to test something by hand"), brief);
    }
  }
  assert.ok(INBOX_TOOLS.POST.description.includes(READY));
  assert.ok(
    INBOX_TOOLS.POST.description.includes("testing by hand what you could not test yourself"),
  );
});

test("an agent writing as its developer is told to end every commit on the trailer naming Luke as co-author, one writing as the App is told never to add one, and both open a pull request through the service, never gh", () => {
  const TRAILER = "Co-authored-by: luke[bot] <90001+luke[bot]@users.noreply.github.com>";
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const developer = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS, TRAILER);
    const app = coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS);
    assert.ok(developer.includes(`exactly as written: \`${TRAILER}\``), brief);
    assert.ok(!developer.includes("add a `Co-authored-by` trailer"), brief);
    assert.ok(app.includes("add a `Co-authored-by` trailer"), brief);
    assert.ok(!app.includes(TRAILER), brief);
    for (const instructions of [developer, app]) {
      assert.ok(
        instructions.includes(
          `open the pull request with \`${CODER_TOOL.OPEN_PULL_REQUEST}\`, never \`gh pr create\``,
        ),
        brief,
      );
    }
  }
});

test("an agent whose credential reads its checks waits on them with sleep, which it is offered and its read-only worker is not", () => {
  const WAIT = `wait with \`${CODER_TOOL.SLEEP}\``;
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.ok(coderInstructions("Acme/Relay", brief, true, TASK_ADDRESS).includes(WAIT), brief);
    assert.ok(!coderInstructions("Acme/Relay", brief, false, TASK_ADDRESS).includes(WAIT), brief);
  }
  assert.deepEqual(
    [
      toolsOf(AGENT_ROLE.CODER).has(CODER_TOOL.SLEEP),
      toolsOf(AGENT_ROLE.CODER_WORKER).has(CODER_TOOL.SLEEP),
    ],
    [true, false],
  );
});

test("one pause is held inside what is left of the GitHub credential its background commands use, and the model is told the bound and to wait again for longer", () => {
  const shown = serializeModelInputSchema(SLEEP_TOOL.inputSchema);
  assert.equal(
    JSON.stringify(shown).includes(`"maximum":${Duration.toSeconds(CODER.SLEEP_MAX)}`),
    true,
  );
  assert.ok(
    Duration.isLessThan(
      Duration.sum(CODER.SLEEP_MAX, CODER.GITHUB_TOKEN_REFRESH),
      Duration.hours(1),
    ),
  );
  assert.ok(SLEEP_TOOL.description?.includes("to wait longer, wait again"));
});

test("every agent is told that what happens on its pull request after its turn reaches it from GitHub, and to read its reviews before it ends a turn", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const ciReadable of [true, false]) {
      const instructions = coderInstructions("Acme/Relay", brief, ciReadable, TASK_ADDRESS);
      assert.ok(instructions.includes("reaches you as a message from GitHub"), brief);
      assert.ok(instructions.includes("before you end a turn on an open pull request"), brief);
    }
  }
});

test("every agent is told to look at a UI it built in the image's Chromium and show the developer what it saw", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    for (const onTask of [true, false]) {
      const instructions = coderInstructions(
        "Acme/Relay",
        brief,
        true,
        onTask ? TASK_ADDRESS : null,
      );
      assert.ok(instructions.includes("playwright screenshot"), brief);
      assert.ok(instructions.includes('NODE_PATH="$(npm root -g)"'), brief);
      assert.ok(instructions.includes(`with \`${CODER_TOOL.SHOW_IMAGE}\``), brief);
    }
  }
});

/** The task link the golden's on-task prompts were composed with. */
const TASK_LINK = "https://tryluke.dev/acme/task/5f3c2a1e-9b8d-4c7a-8e6f-1a2b3c4d5e6f";

/**
 * Main's own instructions as they stood before Chat, recorded from main's
 * code for each brief, on a task and on none: what an agent whose starter
 * has not turned Chat on must still read, byte for byte.
 */
const BEFORE_CHAT = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ onTask: Schema.String, taskless: Schema.String })),
)(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../fixtures/coder-instructions/chat-off.json", import.meta.url)),
      "utf8",
    ),
  ),
);

test("with Chat off the instructions are main's own, byte for byte, and with it on they add the chat section alone", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const before = BEFORE_CHAT[brief];
    assert.ok(before, brief);
    const off = {
      onTask: coderInstructions("Acme/Relay", brief, true, TASK_LINK),
      taskless: coderInstructions("Acme/Relay", brief, false, null),
    };
    assert.equal(off.onTask, before.onTask, brief);
    assert.equal(off.taskless, before.taskless, brief);
    const on = coderInstructions("Acme/Relay", brief, true, TASK_LINK, undefined, true);
    assert.ok(on.includes("## Chat with other agents"), brief);
    const section = on.slice(on.indexOf("\n\n## Chat with other agents"));
    const end = section.indexOf("\n\n## ", 2);
    assert.equal(on.replace(section.slice(0, end), ""), before.onTask, brief);
    for (const tool of Object.values(CHAT_TOOLS)) {
      assert.ok(!off.onTask.includes(tool.name), `${brief} with Chat off names ${tool.name}`);
    }
  }
});

test("with Chat on the session keeps the developer's inbox for what it needs of the developer, and is told of chat for the other agents, @luke, and people, with which to use when", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const instructions = coderInstructions("Acme/Relay", brief, false, null, undefined, true);
    assert.ok(instructions.includes("## The developer's inbox"), brief);
    assert.ok(instructions.includes("## Chat with other agents"), brief);
    for (const tool of [...Object.values(CHAT_TOOLS), ...Object.values(INBOX_TOOLS)]) {
      assert.ok(instructions.includes(tool.name), `${brief} names ${tool.name}`);
    }
    assert.ok(instructions.includes(`\`${CHAT_NOTICE_LEAD} ·\``), brief);
    assert.ok(instructions.includes("Never put one question in both places."), brief);
  }
});
