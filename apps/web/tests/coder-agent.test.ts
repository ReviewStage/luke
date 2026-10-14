import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { Redacted } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { test } from "vitest";
import { DEPLOYMENT_PRESENCE, lukeAccount } from "../server/hosted/brain-host/auth";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
} from "../server/hosted/brain-host/bounds";
import { BRAIN_HOST_TURN_POLICY } from "../server/hosted/brain-host/channel";
import { CODER_DEPLOYMENT_TURNS, coderChannelInput } from "../server/hosted/coder-host/channel";
import { INBOX_TOOLS } from "../server/hosted/coder-host/inbox";
import { coderInstructions } from "../server/hosted/coder-host/instructions";
import { CODER_TOOL } from "../server/hosted/coder-host/tool-set";

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

test("an agent on a plan is told of the plan's links and pages, and one an automation started with no plan of neither", () => {
  const PLAN_LINK = "`https://tryluke.dev/<workspace>/plan/<id>` link names the plan";
  const PAGES = `show it with \`${CODER_TOOL.SHOW_PAGE}\``;
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    const onPlan = coderInstructions("Acme/Relay", brief, true);
    const planless = coderInstructions("Acme/Relay", brief, true, false);
    assert.deepEqual([onPlan.includes(PLAN_LINK), onPlan.includes(PAGES)], [true, true], brief);
    assert.deepEqual(
      [planless.includes(PLAN_LINK), planless.includes(PAGES)],
      [false, false],
      brief,
    );
    assert.ok(planless.includes("## The developer's inbox"), "a planless agent keeps its inbox");
  }
});

test("the session and the post tool are told never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.ok(
      coderInstructions("Acme/Relay", brief, false).includes(
        "Never ask for a credential or a secret in a form",
      ),
      brief,
    );
  }
  assert.ok(
    INBOX_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
});
