import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { TERMINAL_RELAY, TERMINAL_RELAY_CLOSE } from "@luke/features/terminal-wire";
import { Effect, Option } from "effect";
import { WebSocket } from "ws";
import type { AgentSandboxService } from "../agents/terminal/agent-sandbox.js";
import { RELAY_UPGRADE_STATUS, type RelayCredential } from "../http/relay-upgrade.js";
import type { RelayAgent, RelayDependencies } from "./relay.js";
import { standTerminalRelay, terminalRelayServer } from "./service.js";

/**
 * The relay as a page and the desktop reach it, over a socket of its own on
 * this machine's loopback, with accounts and agents that answer from a
 * script: the agent a socket reaches is read under the account its
 * credential names, so a page of the deployment's own whose cookie names an
 * account the agent is not reached by, Grace of another workspace, is
 * closed as gone; another site's page carrying Ada's cookie is refused
 * before any account is read; and the desktop's bearer, with no origin,
 * reaches Ada's agent as it always did. The agent has not opened its
 * sandbox, so a socket that reaches it is closed as starting, and nothing
 * past the reach stands. Synthetic ids, cookies, and bearers throughout.
 */

const OWN_ORIGIN = "https://luke.example.test";
const ADA = "user-ada";
const GRACE = "user-grace";
const ADA_AGENT = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const ADA_BEARER = "Bearer token-of-ada";
const ADA_COOKIE = "__Secure-better-auth.session_token=session-of-ada";
const GRACE_COOKIE = "__Secure-better-auth.session_token=session-of-grace";

/** The account store as the scenario has it: Ada's bearer and cookie name Ada, Grace's cookie names Grace, and every read is kept. */
function accounts() {
  const read: RelayCredential[] = [];
  const named = (credential: RelayCredential): string | undefined => {
    if ("bearer" in credential) return credential.bearer === ADA_BEARER ? ADA : undefined;
    const cookie = credential.page.get("cookie");
    if (cookie === ADA_COOKIE) return ADA;
    return cookie === GRACE_COOKIE ? GRACE : undefined;
  };
  const resolveUserId = (credential: RelayCredential) =>
    Effect.sync(() => {
      read.push(credential);
      return Option.fromUndefinedOr(named(credential));
    });
  return { read, resolveUserId };
}

/** Ada's agent as the store reads it for her: it has not opened its sandbox yet. */
const ADA_AGENT_READ: RelayAgent = {
  conversationId: "conversation-of-ada",
  sessionId: undefined,
  repositoryCredential: Effect.die("no credential is minted before a sandbox stands"),
  memberToken: false,
  turnUnderWay: Effect.succeed(false),
};

/** The relay's world: Ada's agent, which Grace, of another workspace, does not reach; every reach kept, and nothing past the reach standing. */
function agents() {
  const reached: { readonly userId: string; readonly agentId: string }[] = [];
  const unused = () => Effect.die("nothing past the reach stands here");
  const sandbox: AgentSandboxService = {
    terminals: unused,
    start: unused,
    rename: unused,
    kill: unused,
    resume: unused,
    attach: unused,
    setCredential: unused,
    withdrawCredential: unused,
  };
  const dependencies: RelayDependencies = {
    reach: (userId, agentId) =>
      Effect.sync(() => {
        reached.push({ userId, agentId });
        return userId === ADA && agentId === ADA_AGENT
          ? Option.some(ADA_AGENT_READ)
          : Option.none();
      }),
    sandbox,
    connect: unused,
    hold: unused,
    claimRenewal: unused,
    releaseRenewal: unused,
  };
  return { reached, dependencies };
}

/** The relay stood for the scope on a loopback server of its own, answering at the address its sockets open for Ada's agent. */
const standing = (
  resolveUserId: (credential: RelayCredential) => Effect.Effect<Option.Option<string>>,
  dependencies: RelayDependencies,
) =>
  Effect.gen(function* () {
    const relay = terminalRelayServer();
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        relay.server.listen(0, "127.0.0.1");
        await once(relay.server, "listening");
      }),
      () =>
        Effect.sync(() => {
          relay.server.closeAllConnections();
          relay.server.close();
        }),
    );
    yield* standTerminalRelay({
      server: relay,
      ownOrigins: new Set([OWN_ORIGIN]),
      resolveUserId,
      dependencies,
    });
    // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
    const { port } = relay.server.address() as AddressInfo;
    const query = new URLSearchParams({
      [TERMINAL_RELAY.QUERY.AGENT]: ADA_AGENT,
      [TERMINAL_RELAY.QUERY.TERMINAL]: SHELL,
      [TERMINAL_RELAY.QUERY.COLUMNS]: "120",
      [TERMINAL_RELAY.QUERY.ROWS]: "32",
    });
    return `ws://127.0.0.1:${port}${TERMINAL_RELAY.PATH}?${query}`;
  });

/** What one upgrade with the headers given comes to: the status it was refused with, or the code its socket was closed with. */
const upgraded = (url: string, headers: Readonly<Record<string, string>>) =>
  Effect.callback<{ readonly refused: number } | { readonly closed: number }>((resume) => {
    let settled = false;
    const settle = (end: { readonly refused: number } | { readonly closed: number }) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(end));
    };
    const socket = new WebSocket(url, { headers: { ...headers } });
    socket.once("unexpected-response", (_request, response) => {
      settle({ refused: response.statusCode ?? 0 });
      socket.terminate();
    });
    socket.once("close", (code: number) => settle({ closed: code }));
    // A close follows every error, and it is the close that is read.
    socket.on("error", () => undefined);
    return Effect.sync(() => socket.terminate());
  });

it.effect(
  "a page of the deployment's own reaches only the agents the account its cookie names reaches",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { resolveUserId } = accounts();
        const { reached, dependencies } = agents();
        const url = yield* standing(resolveUserId, dependencies);

        assert.deepEqual(yield* upgraded(url, { origin: OWN_ORIGIN, cookie: ADA_COOKIE }), {
          closed: TERMINAL_RELAY_CLOSE.STARTING,
        });
        assert.deepEqual(
          yield* upgraded(url, { origin: OWN_ORIGIN, cookie: GRACE_COOKIE }),
          { closed: TERMINAL_RELAY_CLOSE.GONE },
          "Grace's page reaches no shell of an agent her account does not reach",
        );
        assert.deepEqual(reached, [
          { userId: ADA, agentId: ADA_AGENT },
          { userId: GRACE, agentId: ADA_AGENT },
        ]);
      }),
    ),
);

it.effect(
  "another site's page carrying the member's cookie is refused before any account is read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { read, resolveUserId } = accounts();
        const { reached, dependencies } = agents();
        const url = yield* standing(resolveUserId, dependencies);

        for (const headers of [
          { origin: "https://evil.test", cookie: ADA_COOKIE },
          { origin: "https://evil.test", cookie: ADA_COOKIE, authorization: ADA_BEARER },
        ]) {
          assert.deepEqual(yield* upgraded(url, headers), {
            refused: RELAY_UPGRADE_STATUS.FORBIDDEN,
          });
        }
        assert.deepEqual(read, [], "no cookie or bearer of another site's page is read");
        assert.deepEqual(reached, []);
      }),
    ),
);

it.effect(
  "the desktop's bearer with no origin reaches its member's agent as it always did, and a cookie without a page's origin reaches nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { read, resolveUserId } = accounts();
        const { reached, dependencies } = agents();
        const url = yield* standing(resolveUserId, dependencies);

        assert.deepEqual(yield* upgraded(url, { authorization: ADA_BEARER }), {
          closed: TERMINAL_RELAY_CLOSE.STARTING,
        });
        assert.deepEqual(read, [{ bearer: ADA_BEARER }]);
        assert.deepEqual(reached, [{ userId: ADA, agentId: ADA_AGENT }]);

        assert.deepEqual(yield* upgraded(url, { cookie: ADA_COOKIE }), {
          refused: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
        });
        assert.deepEqual(yield* upgraded(url, { origin: OWN_ORIGIN }), {
          refused: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
        });
        assert.deepEqual(yield* upgraded(url, { authorization: "Bearer not-ada" }), {
          refused: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
        });
        assert.equal(
          reached.length,
          1,
          "no socket the account did not answer for reached any agent",
        );
      }),
    ),
);
