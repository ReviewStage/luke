import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { ACT_UNREACHED_WORDS } from "@luke/features/words";
import { type ActSender, accountAskProcedures } from "@luke/host/act-port";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import { ACT_KIND } from "@luke/host/acts";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import { afterEach, it, vi } from "vitest";
import { askAct, askActResult } from "./act.js";
import { installActPortClient } from "./app-bridge.js";
import { fakeActPort, refusedOnPort } from "./testing/app-bridge.js";

/**
 * The act door, against the port's own server: a refusal reaches the caller
 * as a rejection carrying the sentence the kind's procedure draws, and an
 * answer reaches it as the host gave it. A failure that is no refusal, the
 * transport's or a fault's, reaches it as one fixed sentence, its own text
 * kept as the cause and logged, never read by a person.
 */

const PANEL: ActSender = { sender: Symbol("window"), panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  vi.restoreAllMocks();
});

/** This window's act port, served the account asks' procedures alone, standing as `actor`. */
function openActPort(actor: ActSender): void {
  const noKeys = () => Effect.succeed({ keys: [] });
  const noToken = () => Effect.succeed({ token: null });
  const notTemplated = () => Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  const port = testActPort(
    accountAskProcedures({
      host: {
        providerKeysRead: noKeys,
        providerKeySave: noKeys,
        providerKeyRemove: noKeys,
        providerKeyForAgents: noKeys,
        chatGptSignIn: noKeys,
        chatGptSignInCancel: () => Effect.void,
        githubTokenRead: noToken,
        githubTokenSave: noToken,
        githubTokenRemove: noToken,
        memoriesRead: notTemplated,
        memoryForget: notTemplated,
        planTemplateRead: notTemplated,
        planTemplateWrite: notTemplated,
        planTemplateRevisions: notTemplated,
        planTemplateRevision: notTemplated,
        planTemplateRestore: notTemplated,
        dictationTranscribe: notTemplated,
      },
    }),
  );
  ports.push(port);
  installActPortClient(port.as(actor));
}

it("a kind the port refuses rejects the caller with the sentence its row draws", async () => {
  openActPort(VOICE);

  await assert.rejects(
    askAct(ACT_KIND.PROVIDER_KEYS_REMOVE, { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }),
    (error) =>
      error instanceof Error && error.message === "Could not remove your API key on this system.",
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

  assert.deepEqual(await askAct(ACT_KIND.PROVIDER_KEYS_READ), { keys: [] });
});

it("a kind whose port fails with no refusal rejects the caller with the fixed sentence, its own error kept as the cause", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const transport = new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:4318");
  fakeActPort({ [ACT_KIND.PROVIDER_KEYS_READ]: () => Promise.reject(transport) });

  await assert.rejects(
    askAct(ACT_KIND.PROVIDER_KEYS_READ),
    (error) =>
      error instanceof Error && error.message === ACT_UNREACHED_WORDS && error.cause === transport,
  );
  assert.ok(
    log.mock.calls.some((args) => args.includes(transport)),
    "the transport's own error is logged",
  );
});

it("a row reading an act's answer is told the fixed sentence for a transport failure and the host's own for a refusal", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reasonFor = async (failure: Error) => {
    fakeActPort({ [ACT_KIND.PROVIDER_KEYS_READ]: () => Promise.reject(failure) });
    const answer = await askActResult(
      askAct(ACT_KIND.PROVIDER_KEYS_READ).then(() => ({ status: ACTION_RESULT_STATUS.ACCEPTED })),
    );
    return "reason" in answer ? answer.reason : undefined;
  };

  assert.equal(await reasonFor(new Error("socket hang up")), ACT_UNREACHED_WORDS);
  assert.equal(
    await reasonFor(refusedOnPort("Could not read your API keys on this system.")),
    "Could not read your API keys on this system.",
  );
});
