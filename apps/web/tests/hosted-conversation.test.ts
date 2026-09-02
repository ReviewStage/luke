import assert from "node:assert/strict";
import test from "node:test";
import { type CloudFetch, VAULT_PROVIDER_ID, type WireRecord } from "../server/core";
import { executeConversationRead, providerReadsConversation } from "../server/hosted/act-execute";
import {
  type ConversationReadOptions,
  handleConversationRead,
} from "../server/hosted/conversation-read";
import { encryptProviderKey } from "../server/hosted/encryption";
import { HOSTED_API_ERROR } from "../server/hosted/http";

const SECRET = "a".repeat(64);
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_UUIDS = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003",
] as const;

function conversationRequest(query: Record<string, string>): Request {
  const url = new URL("https://luke.test/api/sessions/messages");
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return new Request(url, { method: "GET", headers: { authorization: "Bearer token-1" } });
}

function conversationOptions(
  overrides: Partial<ConversationReadOptions> = {},
): ConversationReadOptions {
  return {
    request: conversationRequest({
      providerId: "conductor",
      providerSessionId: SESSION_UUID,
    }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readKey: async () => ({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    execute: async () => ({ messages: [], hasMore: false }),
    ...overrides,
  };
}

// --- Gate checks ---

test("the conversation gate order is method, secret, token", async () => {
  const wrongMethod = await handleConversationRead(
    conversationOptions({
      request: new Request("https://luke.test/api/sessions/messages", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleConversationRead(
    conversationOptions({ encryptionSecret: undefined }),
  );
  assert.equal(noSecret.status, 503);

  const anonymous = await handleConversationRead(
    conversationOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
});

// --- The request is bounded before a key is ever read ---

test("a provider without the documented read is an invalid request", async () => {
  for (const providerId of ["devin", "copilot", "not-a-provider"]) {
    const response = await handleConversationRead(
      conversationOptions({
        request: conversationRequest({ providerId, providerSessionId: SESSION_UUID }),
        execute: async () => {
          throw new Error("execute must not run for a provider without the read");
        },
      }),
    );
    assert.equal(response.status, 400, providerId);
    assert.equal((await response.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  }
});

test("a session id or cursor outside its bound is an invalid request", async () => {
  const missingSession = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({ providerId: "conductor" }),
    }),
  );
  assert.equal(missingSession.status, 400);

  const slashedSession = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({
        providerId: "conductor",
        providerSessionId: "sessions/../../admin",
      }),
    }),
  );
  assert.equal(slashedSession.status, 400);

  const slashedCursor = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({
        providerId: "conductor",
        providerSessionId: SESSION_UUID,
        after: "ids/never/hold/paths",
      }),
    }),
  );
  assert.equal(slashedCursor.status, 400);

  for (const beforeOffset of ["-1", "1.5", "not-a-number", "9999999999"]) {
    const badOffset = await handleConversationRead(
      conversationOptions({
        request: conversationRequest({
          providerId: "conductor",
          providerSessionId: SESSION_UUID,
          beforeOffset,
        }),
      }),
    );
    assert.equal(badOffset.status, 400, beforeOffset);
  }

  // A poll and a history read are different asks, never combined.
  const bothPositions = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({
        providerId: "conductor",
        providerSessionId: SESSION_UUID,
        after: MESSAGE_UUIDS[0],
        beforeOffset: "100",
      }),
    }),
  );
  assert.equal(bothPositions.status, 400);
});

test("a history position rides the query to the executor", async () => {
  let executed: Parameters<ConversationReadOptions["execute"]>[0] | undefined;
  const response = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({
        providerId: "conductor",
        providerSessionId: SESSION_UUID,
        beforeOffset: "240",
      }),
      execute: async (options) => {
        executed = options;
        return { messages: [], hasMore: false, firstOffset: 140, hasOlder: true };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    messages: [],
    hasMore: false,
    firstOffset: 140,
    hasOlder: true,
  });
  assert.equal(executed?.beforeOffset, 240);
  assert.equal(executed?.afterMessageId, undefined);
});

test("a request with no key stored is invalid rather than attempted", async () => {
  const response = await handleConversationRead(
    conversationOptions({
      readKey: async () => undefined,
      execute: async () => {
        throw new Error("execute must not run without a key");
      },
    }),
  );
  assert.equal(response.status, 400);
});

// --- The executor's outcome decides the response ---

test("a refused read answers upstream-error and never echoes the provider", async () => {
  const response = await handleConversationRead(
    conversationOptions({
      execute: async () => ({ refused: "Conductor rejected the stored API key." }),
    }),
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, HOSTED_API_ERROR.UPSTREAM_ERROR);
  assert.equal(body.refused, undefined);
});

test("an answered read carries the page to the wire with the parsed fields", async () => {
  let executed: Parameters<ConversationReadOptions["execute"]>[0] | undefined;
  const response = await handleConversationRead(
    conversationOptions({
      request: conversationRequest({
        providerId: "conductor",
        providerSessionId: SESSION_UUID,
        after: MESSAGE_UUIDS[0],
      }),
      execute: async (options) => {
        executed = options;
        return {
          messages: [{ id: MESSAGE_UUIDS[1], author: "agent", text: "Done.", receivedAt: 1_000 }],
          lastMessageId: MESSAGE_UUIDS[2],
          hasMore: true,
        };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    messages: [{ id: MESSAGE_UUIDS[1], author: "agent", text: "Done.", receivedAt: 1_000 }],
    lastMessageId: MESSAGE_UUIDS[2],
    hasMore: true,
  });
  assert.equal(executed?.providerSessionId, SESSION_UUID);
  assert.equal(executed?.afterMessageId, MESSAGE_UUIDS[0]);
});

// --- Rate brake ---

test("the conversation endpoint returns 429 after too many requests in the same window", async () => {
  const now = () => 1_000_000;
  const userId = `ratelimit-${Date.now()}-${process.pid}`;

  for (let i = 0; i < 30; i++) {
    const response = await handleConversationRead(
      conversationOptions({ resolveUserId: async () => userId, now }),
    );
    assert.equal(response.status, 200, `request ${i + 1} should succeed`);
  }

  const limited = await handleConversationRead(
    conversationOptions({ resolveUserId: async () => userId, now }),
  );
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
});

// --- The capability map mirrors the adapters exactly ---

test("only Conductor's adapter carries the conversation read today", () => {
  const supported = Object.values(VAULT_PROVIDER_ID).filter(providerReadsConversation);
  assert.deepEqual(supported, ["conductor"]);
});

// --- The executor re-observes and reads through the provider's adapter ---

/** The read-only Conductor answers one conversation read needs. */
function conductorFetch(options: {
  messages: readonly WireRecord[];
  hasMore?: boolean;
  recordReads?: Array<string>;
}): CloudFetch {
  return async (url) => {
    const parsed = new URL(url);
    const answer = (body: WireRecord) => new Response(JSON.stringify(body), { status: 200 });
    if (parsed.pathname === "/me") return answer({ userId: "user-1" });
    if (parsed.pathname === "/v0/projects") return answer({ data: [], offset: 0, hasMore: false });
    if (parsed.pathname === "/v0/workspaces") {
      return answer({
        data: [
          {
            id: "workspace-1",
            name: "luke",
            state: "ready",
            repoUrl: "https://github.com/reviewstage/luke.git",
            creatorId: "user-1",
            lastActivityAt: new Date().toISOString(),
          },
        ],
        offset: 0,
        hasMore: false,
      });
    }
    if (parsed.pathname === "/v0/workspaces/workspace-1/status") {
      return answer({ status: "ready" });
    }
    if (parsed.pathname === "/v0/workspaces/workspace-1/sessions") {
      return answer({
        data: [{ id: SESSION_UUID, name: "Fix the roster test" }],
        offset: 0,
        hasMore: false,
      });
    }
    if (parsed.pathname === `/v0/sessions/${SESSION_UUID}/status`) {
      return answer({ status: "idle", updatedAt: new Date().toISOString() });
    }
    if (parsed.pathname === "/v0/sql") return answer({ rows: [] });
    if (parsed.pathname === `/v0/sessions/${SESSION_UUID}/messages`) {
      options.recordReads?.push(parsed.search);
      const after = parsed.searchParams.get("after");
      const limit = Math.min(Number(parsed.searchParams.get("limit") ?? "100"), 100);
      let start = Number(parsed.searchParams.get("offset") ?? "0");
      if (after !== null) {
        const index = options.messages.findIndex((message) => message.id === after);
        // The real store refuses a cursor it never issued.
        if (index < 0) return new Response("{}", { status: 404 });
        start = index + 1;
      }
      const data = options.messages.slice(start, start + limit);
      return answer({
        data: [...data],
        offset: start,
        hasMore: start + data.length < options.messages.length,
      });
    }
    return new Response("{}", { status: 500 });
  };
}

/** One stored developer send, for fixtures where only attribution matters. */
function storedSend(id: string, message: string): WireRecord {
  return {
    id,
    sessionId: SESSION_UUID,
    sessionIndex: 1,
    type: "userMessage",
    content: { type: "userMessage", message },
    receivedAt: "2026-09-01T00:00:00.000Z",
  };
}

test("a conversation read re-observes, reads the documented endpoint, and maps the page", async () => {
  const reads: string[] = [];
  const answer = await executeConversationRead({
    providerId: "conductor",
    providerSessionId: SESSION_UUID,
    afterMessageId: MESSAGE_UUIDS[0],
    apiKey: "key-1",
    seams: {
      fetch: conductorFetch({
        recordReads: reads,
        messages: [
          storedSend(MESSAGE_UUIDS[0], "First ask"),
          {
            id: MESSAGE_UUIDS[1],
            sessionId: SESSION_UUID,
            sessionIndex: 2,
            type: "userMessage",
            content: { type: "userMessage", message: "Continue please" },
            receivedAt: "2026-09-01T00:00:00.000Z",
          },
          {
            id: MESSAGE_UUIDS[2],
            sessionId: SESSION_UUID,
            sessionIndex: 3,
            type: "agent",
            content: {
              type: "agent",
              rawPayload: {
                type: "assistant",
                message: { content: [{ type: "text", text: "Continuing." }] },
              },
            },
            receivedAt: "2026-09-01T00:00:01.000Z",
          },
        ],
      }),
    },
  });

  assert.ok(!("refused" in answer));
  if ("refused" in answer) return;
  assert.deepEqual(
    answer.messages.map((message) => [message.id, message.author, message.text]),
    [
      [MESSAGE_UUIDS[1], "user", "Continue please"],
      [MESSAGE_UUIDS[2], "agent", "Continuing."],
    ],
  );
  assert.equal(answer.lastMessageId, MESSAGE_UUIDS[2]);
  assert.equal(answer.hasMore, false);
  // A poll never looks backward, so it reports no history position.
  assert.equal(answer.firstOffset, undefined);
  assert.equal(answer.hasOlder, undefined);
  assert.deepEqual(reads, [`?limit=100&after=${MESSAGE_UUIDS[0]}`]);
});

test("an opening read answers the latest page with the positions to continue from", async () => {
  const answer = await executeConversationRead({
    providerId: "conductor",
    providerSessionId: SESSION_UUID,
    apiKey: "key-1",
    seams: {
      fetch: conductorFetch({
        messages: [
          storedSend(MESSAGE_UUIDS[0], "First ask"),
          storedSend(MESSAGE_UUIDS[1], "Second ask"),
          storedSend(MESSAGE_UUIDS[2], "Third ask"),
        ],
      }),
    },
  });

  assert.ok(!("refused" in answer));
  if ("refused" in answer) return;
  assert.deepEqual(
    answer.messages.map((message) => message.id),
    [MESSAGE_UUIDS[0], MESSAGE_UUIDS[1], MESSAGE_UUIDS[2]],
  );
  assert.equal(answer.lastMessageId, MESSAGE_UUIDS[2]);
  assert.equal(answer.firstOffset, 0);
  assert.equal(answer.hasOlder, false);
});

test("a history read rides its offset to the adapter and back", async () => {
  const reads: string[] = [];
  const answer = await executeConversationRead({
    providerId: "conductor",
    providerSessionId: SESSION_UUID,
    beforeOffset: 2,
    apiKey: "key-1",
    seams: {
      fetch: conductorFetch({
        recordReads: reads,
        messages: [
          storedSend(MESSAGE_UUIDS[0], "First ask"),
          storedSend(MESSAGE_UUIDS[1], "Second ask"),
          storedSend(MESSAGE_UUIDS[2], "Third ask"),
        ],
      }),
    },
  });

  assert.ok(!("refused" in answer));
  if ("refused" in answer) return;
  assert.deepEqual(
    answer.messages.map((message) => message.id),
    [MESSAGE_UUIDS[0], MESSAGE_UUIDS[1]],
  );
  assert.equal(answer.firstOffset, 0);
  assert.equal(answer.hasOlder, false);
  // History must never move the poll: an older page names no forward cursor.
  assert.equal(answer.lastMessageId, undefined);
  assert.deepEqual(reads, ["?limit=2&offset=0"]);
});

test("a conversation read for a session the fresh pass did not observe refuses", async () => {
  const answer = await executeConversationRead({
    providerId: "conductor",
    providerSessionId: "99999999-9999-4999-8999-999999999999",
    apiKey: "key-1",
    seams: { fetch: conductorFetch({ messages: [] }) },
  });
  assert.ok("refused" in answer);
  assert.equal(answer.refused, "Session not found.");
});

test("a key the provider refuses is named as the reason, not a missing session", async () => {
  const answer = await executeConversationRead({
    providerId: "conductor",
    providerSessionId: SESSION_UUID,
    apiKey: "key-1",
    seams: { fetch: async () => new Response("{}", { status: 401 }) },
  });
  assert.ok("refused" in answer);
  assert.match(answer.refused, /rejected the stored API key/);
});
