import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { ISSUE_CALL_FAILURE } from "@luke/features/issue-view";
import {
  createActPortHandler,
  type PlatformActProcedures,
  type WorkspaceProceduresDependencies,
} from "@luke/host/act-port";
import type { ActSender } from "@luke/host/act-router";
import { ACT_KIND } from "@luke/host/acts";
import { Context, Effect } from "effect";
import { afterEach, it } from "vitest";
import { askAct } from "./act.js";
import { installActPort } from "./app-bridge.js";

/**
 * The act door, for a kind on the window's act port, against the port's
 * own server: a refusal reaches the caller as the rejection an `app:act`
 * refusal always was, carrying the sentence the kind's row draws, and an
 * answer reaches it as the host gave it.
 */

const PANEL: ActSender = { sender: Symbol("window"), panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

// SAFETY: this window calls the issue kinds alone, so no platform procedure is reached.
const NO_PLATFORM_PROCEDURES = {} as PlatformActProcedures<unknown>;

/** This window's act port, opened onto the port's server as the bridge opens it, standing as `actor`. */
function openActPort(actor: ActSender): void {
  const unanswered = () => Effect.succeed({ failure: ISSUE_CALL_FAILURE.UNANSWERED });
  const noKeys = () => Effect.succeed({ keys: [] });
  const notTemplated = () => Effect.succeed({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  const handler = createActPortHandler(
    {
      accountAsks: {
        host: {
          providerKeysRead: noKeys,
          providerKeySave: noKeys,
          providerKeyRemove: noKeys,
          planTemplateRead: notTemplated,
          planTemplateWrite: notTemplated,
          planTemplateRevisions: notTemplated,
          planTemplateRevision: notTemplated,
          planTemplateRestore: notTemplated,
          dictationTranscribe: notTemplated,
        },
      },
      issues: {
        host: {
          issueList: unanswered,
          issueRead: unanswered,
          issueCreate: unanswered,
          issueChange: unanswered,
        },
      },
      // SAFETY: no test here calls a workspace kind, so no method of this host is ever read.
      workspaces: {
        host: {} as WorkspaceProceduresDependencies["host"],
        openExternal: () => Promise.resolve(),
      },
    },
    NO_PLATFORM_PROCEDURES,
  );
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  handler.upgrade(port1, {
    context: () => ({ actor, trusted: true, "effect/context": Context.empty() }),
  });
  port1.start();
  installActPort(port2);
}

it("a kind the port refuses rejects the caller with the sentence its row draws", async () => {
  openActPort(VOICE);

  await assert.rejects(
    askAct(ACT_KIND.ISSUES_LIST, { workspaceId: "workspace-1" }),
    (error) =>
      error instanceof Error && error.message === "Could not read the issues on this system.",
  );
});

it("a kind the port answers resolves the caller with the host's answer", async () => {
  openActPort(PANEL);

  assert.deepEqual(await askAct(ACT_KIND.ISSUES_LIST, { workspaceId: "workspace-1" }), {
    failure: ISSUE_CALL_FAILURE.UNANSWERED,
  });
});

it("a kind the port answers that carries nothing is asked with nothing and resolves the caller with the host's answer", async () => {
  openActPort(PANEL);

  assert.deepEqual(await askAct(ACT_KIND.PROVIDER_KEYS_READ), { keys: [] });
});
