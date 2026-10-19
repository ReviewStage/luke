import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTaskConversation } from "@luke/database/models/task-store";
import { joinWorkspace, openHostedStoreTestDatabase, startTask } from "@luke/database/testing";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Option, Redacted } from "effect";
import { routeAuth } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { DEPLOYMENT_PRESENCE } from "../agents/brain-host/auth.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_TURN,
} from "../agents/brain-host/bounds.js";
import { brainHostChannelInput, DEPLOYMENT_TURNS } from "../agents/brain-host/channel.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { NO_GITHUB } from "../testing/github-app-fake.js";
import { commentAskMessage, handCommentAskOver } from "./comment-ask.js";

/**
 * A plan's comment thread as it is handed over: the words it is handed over
 * in, and the hand-over of one to Luke over the real store on PGlite, to eve
 * at a fake HTTP boundary that walks each request through the brain's door
 * as its eve channel is composed (`apps/luke/channels/eve.ts`), with eve's
 * own route auth. The door's reads are answered from the ids the test made
 * rather than read from the rows, because the dispatch holds the one PGlite
 * connection while eve is asked; who reaches a task's conversation through
 * its workspace is the access suite's (`brain-host-access.test.ts`).
 * Synthetic accounts, bearers, secrets, and sessions throughout.
 */

const NOW = 1_800_000_000_000;
const database = await openHostedStoreTestDatabase({ at: NOW });
afterAll(() => database.close());

const ORIGIN = "https://luke.test";
const SECRET = "cron-secret-1";
/** The one session eve opens for the plan's conversation. */
const SESSION = "wrun_01SESSIONOFTHEPLAN00000000";

/** The deployment's environment with no key of its own, which a test gives the secret it reads. */
const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

const WITH_SECRET = Layer.succeed(HostedEnvironment, {
  ...NO_KEYS,
  cronSecret: Redacted.make(SECRET),
});

const THREAD: PlanCommentThread = {
  id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  scope: PLAN_COMMENT_SCOPE.WORDS,
  quote: "a retry",
  anchor: { from: 20, to: 27 },
  section: "Testing",
  status: PLAN_COMMENT_STATUS.OPEN,
  createdAt: 1_792_108_800_000,
  updatedAt: 1_792_108_800_000,
  revision: 1,
  entries: [
    {
      id: "5f2b0c1e-8d3a-4c7b-9e6f-1a2b3c4d5e6f",
      kind: PLAN_COMMENT_ENTRY.COMMENT,
      writer: { actor: PLAN_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
      words: "Is this covered already?",
      at: 1_792_108_800_000,
    },
  ],
};

/** What the brain's door made of one request eve received: its route, what named its caller, and the principal it admitted, or nothing for a refusal. */
interface AtTheDoor {
  readonly route: string;
  readonly authorization: string | null;
  readonly account: string | null;
  readonly cookie: string | null;
  readonly turn: string | null;
  readonly admitted: SessionAuthContext | undefined;
}

/**
 * The brain behind its door, composed as its eve channel is, over a store in
 * which the plan's members reach its conversation and the session eve opens
 * for it, and nobody else does; a bearer `Bearer <account>` names its
 * account. Past the door eve answers as its routes document: an opening
 * names the session, a follow-up its delivery.
 */
function brainBehindDoor(members: ReadonlySet<string>, conversationId: string) {
  const received: AtTheDoor[] = [];
  const door = brainHostChannelInput(
    async (incoming) => incoming.headers.get("authorization")?.replace(/^Bearer /u, ""),
    {
      reachesSession: async (userId, sessionId) => members.has(userId) && sessionId === SESSION,
      reachesConversation: async (userId, id) => members.has(userId) && id === conversationId,
    },
    {
      secret: Redacted.make(SECRET),
      admits: DEPLOYMENT_TURNS,
      presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
    },
  ).auth;
  const layer = fakeHttpClientLayer(async (url, init) => {
    const route = new URL(url).pathname;
    const headers = new Headers(init.headers);
    const caller = await routeAuth(
      new Request(new URL(route, ORIGIN), { method: init.method ?? "GET", headers }),
      door,
    );
    received.push({
      route,
      authorization: headers.get("authorization"),
      account: headers.get(BRAIN_HOST_HEADER.ACCOUNT),
      cookie: headers.get("cookie"),
      turn: headers.get(BRAIN_HOST_HEADER.TURN),
      admitted: caller instanceof Response ? undefined : caller,
    });
    if (caller instanceof Response) return caller;
    return route === "/eve/v1/session"
      ? Response.json({ sessionId: SESSION }, { status: 202 })
      : Response.json(
          { sessionId: SESSION, deliveryId: `delivery-${received.length}` },
          { status: 202 },
        );
  });
  return { received, layer };
}

/** A task its owner started in their workspace, which a teammate joined, with its planning conversation. */
async function sharedTask() {
  const owner = await database.createUser();
  const teammate = await database.createUser();
  const started = await database.run(startTask(owner, { name: "Teammate invitations" }));
  await database.run(joinWorkspace(started.workspaceId, teammate));
  const conversation = Option.getOrThrow(
    await database.run(openTaskConversation(owner, started.id)),
  );
  return { owner, teammate, taskId: started.id, conversationId: conversation.conversationId };
}

/** The request a comment's route answers, as its caller sent it: over a bearer, or over a browser's session cookie alone. */
function commentRequest(headers: Readonly<Record<string, string>>): Request {
  return new Request(new URL("/api/plans/comments", ORIGIN), { method: "POST", headers });
}

/** A member's comment to Luke handed over, as the comments route hands it, to the brain given. */
function handedToLuke(
  brain: ReturnType<typeof brainBehindDoor>,
  request: Request,
  member: { readonly userId: string; readonly taskId: string },
  words: string,
) {
  return database.run(
    handCommentAskOver({ eveOrigin: () => ORIGIN }, request, {
      ...member,
      to: { actor: PLAN_COMMENT_ACTOR.LUKE },
      clientKey: randomUUID(),
      text: `A member sent you a comment thread to answer.\n\n${words}`,
      words,
    }).pipe(Effect.provide(brain.layer), Effect.provide(Layer.merge(WITH_SECRET, NO_GITHUB))),
  );
}

test("a thread is handed over as its quoted words, its section's name, and its comments, and never the plan's text", () => {
  const message = commentAskMessage({
    taskName: "Invites",
    thread: THREAD,
    sender: "Dean",
    toLuke: false,
  });

  assert.ok(message.startsWith('Dean sent you a comment thread on the plan "Invites"'));
  assert.ok(message.includes('On: "a retry" (section "Testing")'));
  assert.ok(message.includes("Dean: Is this covered already?"));
  assert.ok(message.includes("Read the thread, then answer"));
  assert.equal(message.includes("as the plan now reads"), false);
});

test("a teammate's comment to Luke on the owner's plan, sent from a browser's session cookie alone, reaches the brain's door as the deployment acting for the teammate and is admitted as the teammate's own principal, the identity the teammate's bearer is admitted as, the deployment named only as its carrier: never the deployment's own, and never the owner's", async () => {
  const { owner, teammate, taskId, conversationId } = await sharedTask();
  const brain = brainBehindDoor(new Set([owner, teammate]), conversationId);
  const member = { userId: teammate, taskId };
  const fromBrowser = commentRequest({ cookie: `better-auth.session_token=${teammate}` });
  const fromDesktop = commentRequest({ authorization: `Bearer ${teammate}` });

  // The browser's comment opens the plan's session, the desktop's follows it up, and the browser's next one too.
  await handedToLuke(brain, fromBrowser, member, "Is withdrawing an invite in v1?");
  await handedToLuke(brain, fromDesktop, member, "And re-sending one?");
  await handedToLuke(brain, fromBrowser, member, "Or expiring them?");

  assert.deepEqual(
    brain.received.map(({ route, authorization, account, cookie, turn }) => ({
      route,
      authorization,
      account,
      cookie,
      turn,
    })),
    [
      {
        route: "/eve/v1/session",
        authorization: `Bearer ${SECRET}`,
        account: teammate,
        cookie: null,
        turn: BRAIN_HOST_TURN.TYPED,
      },
      {
        route: `/eve/v1/session/${SESSION}`,
        authorization: `Bearer ${teammate}`,
        account: null,
        cookie: null,
        turn: BRAIN_HOST_TURN.TYPED,
      },
      {
        route: `/eve/v1/session/${SESSION}`,
        authorization: `Bearer ${SECRET}`,
        account: teammate,
        cookie: null,
        turn: BRAIN_HOST_TURN.TYPED,
      },
    ],
  );
  // eve steers a running turn, and folds the messages that waited, by the principal's
  // authenticator, issuer, type, and id: the browser's asks are the desktop's.
  const identity = (principal: SessionAuthContext | undefined) => [
    principal?.authenticator,
    principal?.issuer,
    principal?.principalType,
    principal?.principalId,
  ];
  const [opened, overBearer, followed] = brain.received.map(({ admitted }) => admitted);
  assert.deepEqual(identity(overBearer), [
    BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
    undefined,
    BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
    teammate,
  ]);
  assert.deepEqual(identity(opened), identity(overBearer));
  assert.deepEqual(identity(followed), identity(overBearer));
  assert.deepEqual(
    [opened, overBearer, followed].map((principal) => [
      principal?.attributes[BRAIN_HOST_ATTRIBUTE.CONVERSATION],
      principal?.attributes[BRAIN_HOST_ATTRIBUTE.CARRIER],
    ]),
    [
      [conversationId, BRAIN_HOST_DEPLOYMENT_PRINCIPAL],
      [conversationId, undefined],
      [conversationId, BRAIN_HOST_DEPLOYMENT_PRINCIPAL],
    ],
  );
});
