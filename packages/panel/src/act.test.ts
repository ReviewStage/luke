import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { FAILURE_KIND, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { type ActSender, accountAskProcedures } from "@repo/host/act-port";
import { type TestActPort, testActPort } from "@repo/host/act-port/testing";
import { ACT_KIND } from "@repo/host/acts";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Effect } from "effect";
import { afterEach, it, vi } from "vitest";
import { askAct, askActResult } from "./act.js";
import { installActPortClient } from "./app-bridge.js";
import { installShownFailureReporter, reportShownFailure } from "./failure-report.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";

/**
 * The act door, against the port's own server: a refusal reaches the caller
 * as a rejection carrying the sentence the kind's procedure draws, and an
 * answer reaches it as the host gave it. A failure that is no refusal, the
 * transport's or a fault's, reaches it as one fixed sentence, its own text
 * kept as the cause and logged, never read by a person.
 */

const PANEL: ActSender = { sender: Symbol("window"), panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

/** This window's act port, served the account asks' procedures alone, standing as `actor`. */
function openActPort(actor: ActSender): void {
  const noKeys = () => Effect.succeed({ keys: [] });
  const noToken = () => Effect.succeed({ token: null });
  const unanswered = () => Effect.succeed({ failure: AGENT_CALL_FAILURE.UNANSWERED });
  const port = testActPort(
    accountAskProcedures({
      host: {
        providerKeysFollow: () => Effect.void,
        providerKeysUnfollow: () => Effect.void,
        providerKeysRetry: () => Effect.void,
        providerKeySave: noKeys,
        providerKeyRemove: noKeys,
        providerKeyForAgents: noKeys,
        chatGptDeviceStart: unanswered,
        chatGptDeviceWait: unanswered,
        chatGptDeviceCancel: unanswered,
        githubTokenFollow: () => Effect.void,
        githubTokenUnfollow: () => Effect.void,
        githubTokenRetry: () => Effect.void,
        githubTokenSave: noToken,
        githubTokenRemove: noToken,
        memoriesFollow: () => Effect.void,
        memoriesUnfollow: () => Effect.void,
        memoriesRetry: () => Effect.void,
        memoryForget: unanswered,
        dictationTranscribe: unanswered,
      },
    }),
  );
  ports.push(port);
  installActPortClient(port.as(actor));
}

it("a kind the port refuses rejects the caller with the sentence its row draws", async () => {
  openActPort(OTHER_WINDOW);

  await assert.rejects(
    askAct(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }),
    (error) =>
      error instanceof Error && error.message === "Couldn't remove your API key on this system.",
  );
});

it("a kind the port answers resolves the caller with the host's answer", async () => {
  openActPort(PANEL);

  assert.deepEqual(
    await askAct(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }),
    { keys: [] },
  );
});

it("a kind the port answers that carries nothing is asked with nothing and resolves the caller with the host's answer", async () => {
  openActPort(PANEL);

  assert.deepEqual(await askAct(ACT_KIND.GITHUB_TOKEN_REMOVE), { token: null });
});

it("a kind whose port fails with no refusal rejects the caller with the fixed sentence, its own error kept as the cause", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const transport = new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:4318");
  fakeActPort({ [ACT_KIND.GITHUB_TOKEN_REMOVE]: () => Promise.reject(transport) });

  await assert.rejects(
    askAct(ACT_KIND.GITHUB_TOKEN_REMOVE),
    (error) =>
      error instanceof Error && error.message === ACT_UNREACHED_WORDS && error.cause === transport,
  );
  assert.ok(
    log.mock.calls.some((args) => args.includes(transport)),
    "the transport's own error is logged",
  );
});

it("a row reading an act's answer is told the fixed sentence for a transport failure and the host's own for a refusal, and the first reports as unexpected", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const kinds: string[] = [];
  const uninstall = installShownFailureReporter((report) => {
    kinds.push(report.kind);
    return undefined;
  });
  const reasonFor = async (failure: Error) => {
    fakeActPort({ [ACT_KIND.GITHUB_TOKEN_REMOVE]: () => Promise.reject(failure) });
    const answer = await askActResult(
      askAct(ACT_KIND.GITHUB_TOKEN_REMOVE).then(() => ({ status: ACTION_RESULT_STATUS.ACCEPTED })),
    );
    reportShownFailure({ surface: FAILURE_SURFACE.SETTING_WRITE, cause: answer }, 0);
    return "reason" in answer ? answer.reason : undefined;
  };

  assert.equal(await reasonFor(new Error("socket hang up")), ACT_UNREACHED_WORDS);
  assert.equal(
    await reasonFor(refusedOnPort("Couldn't read your API keys on this system.")),
    "Couldn't read your API keys on this system.",
  );
  uninstall();
  assert.deepEqual(kinds, [FAILURE_KIND.UNEXPECTED, FAILURE_KIND.REFUSED]);
});
