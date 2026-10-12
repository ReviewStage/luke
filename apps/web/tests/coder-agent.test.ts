import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF, ROLLOUT_ROLE } from "@sidecar/hosted/coding-agent-wire";
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

/** A plain agent's row as its instructions read it: the repository, no rollout position, no base. */
const RELAY_AGENT = {
  repository: "Acme/Relay",
  planId: "5f3c2a1e-0000-4000-8000-000000000001",
  position: null,
  baseBranch: null,
  role: null,
} as const;

/** A rollout's third pull request, based on the second's branch. */
const STACKED_WORKER = {
  ...RELAY_AGENT,
  position: 3,
  baseBranch: "luke/5f3c2a1e/2-route",
  role: ROLLOUT_ROLE.BUILDER,
} as const;

/** The rollout's keeper: no position and no base. */
const KEEPER = { ...RELAY_AGENT, role: ROLLOUT_ROLE.KEEPER } as const;

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

test("the session and the post tool are told never to ask for a credential or a secret in a form, since the answer reaches the transcript", () => {
  for (const brief of Object.values(CODING_AGENT_BRIEF)) {
    assert.ok(
      coderInstructions(RELAY_AGENT, brief, false).includes(
        "Never ask for a credential or a secret in a form",
      ),
      brief,
    );
  }
  assert.ok(
    INBOX_TOOLS.POST.description.includes("never ask for a credential or a secret in a form"),
  );
});

/** Every brief of an agent that writes code and cuts a branch of its own: all but the stack keeper's. */
const BUILDING_BRIEFS = Object.values(CODING_AGENT_BRIEF).filter(
  (brief) => brief !== CODING_AGENT_BRIEF.STACK_KEEPER,
);

test("a rollout's builder is told it is checked out at its base, to cut its branch under the plan's prefix with its position and open onto the base, and never to push the base or the default branch; a plain agent is told the default branch, and the keeper the rollout's branches beside it", () => {
  for (const brief of BUILDING_BRIEFS) {
    const stacked = coderInstructions(STACKED_WORKER, brief, false);
    for (const kept of [
      "at the branch `luke/5f3c2a1e/2-route`",
      "`luke/5f3c2a1e/3-<slug>`, cut from `luke/5f3c2a1e/2-route`",
      "`gh pr create --base luke/5f3c2a1e/2-route`",
      "Never commit to or push `luke/5f3c2a1e/2-route` or the default branch",
    ]) {
      assert.ok(stacked.includes(kept), `${brief}: ${kept}`);
    }
    assert.ok(!stacked.includes("at its current default branch"), brief);
    const plain = coderInstructions(RELAY_AGENT, brief, false);
    assert.ok(plain.includes("at its current default branch"), brief);
    assert.ok(plain.includes("cut from the default branch"), brief);
    assert.ok(!plain.includes("--base"), brief);
    const keeper = coderInstructions(KEEPER, brief, false);
    assert.ok(keeper.includes("every branch of this plan's rollout, `luke/5f3c2a1e/*`"), brief);
  }
});

test("a rollout's builder is told to push its own branch alone, never to touch the stack, and to reset to its remote head on a resync; an agent outside a rollout is told none of it", () => {
  const onBase = coderInstructions(STACKED_WORKER, CODING_AGENT_BRIEF.PULL_REQUEST, true);
  const onMain = coderInstructions(
    { ...RELAY_AGENT, position: 1 },
    CODING_AGENT_BRIEF.PULL_REQUEST,
    true,
  );
  for (const builder of [onBase, onMain]) {
    for (const kept of [
      "Push your own branch and nothing else",
      "never run `gh stack`, never rebase onto a base that moved, never retarget your pull request, and never merge",
      "`git fetch origin <your branch> && git reset --hard origin/<your branch>`",
    ]) {
      assert.ok(builder.includes(kept), kept);
    }
    for (const command of ["gh pr merge", "gh pr edit", "gh stack link", "gh stack sync"]) {
      assert.ok(!builder.includes(command), command);
    }
  }
  const plain = coderInstructions(RELAY_AGENT, CODING_AGENT_BRIEF.PLAN, true);
  assert.ok(!plain.includes("gh stack"));
  assert.ok(!plain.includes("resync"));
});

test("the stack keeper is told it writes no code beyond a mechanical conflict, cuts no branch and opens no pull request, pushes with a lease, and reports; it is told nothing of publishing work of its own", () => {
  const keeper = coderInstructions(KEEPER, CODING_AGENT_BRIEF.STACK_KEEPER, true);

  for (const kept of [
    "keep the stacks of the plan's rollout",
    "Change no code but what a mechanical conflict needs",
    "Cut no branch of your own",
    "Never open a pull request of your own",
    "`--force-with-lease`",
    "report tool",
  ]) {
    assert.ok(keeper.includes(kept), kept);
  }
  for (const left of [
    "worth publishing",
    "gh pr create",
    "Decide whether to open a pull request",
    "`edit_plan`",
  ]) {
    assert.ok(!keeper.includes(left), left);
  }
});
