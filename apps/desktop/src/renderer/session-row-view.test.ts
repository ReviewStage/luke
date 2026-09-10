import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_KIND,
  normalizeSession,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { observedSessions, type SessionView, workspaceTrayActions } from "./session-model";
import { type SessionWriteHandlers, WorkspaceTrayActs } from "./session-row-view";

const CONDUCTOR = { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };

const ANSWER = {
  kind: ACTION_KIND.CONTROL,
  id: "permission-allow",
  label: "Allow the edit",
} as const;

/** Handlers a static render never calls; the row is being read, not pressed. */
const WRITES: SessionWriteHandlers = {
  sendMessage: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  runAction: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  openChange: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }),
};

function rowFor(observation: ProviderSessionObservation): SessionView {
  const [row] = observedSessions([normalizeSession(CONDUCTOR, observation)]);
  assert.ok(row);
  return row;
}

test("inside a tray, a workspace-level control leaves the row for the header", () => {
  const archive = {
    kind: ACTION_KIND.CONTROL,
    id: "archive-workspace",
    label: "Archive workspace",
    controlKind: SESSION_CONTROL_KIND.ARCHIVE,
    target: "ws-1",
  } as const;
  const chat = (providerSessionId: string): SessionView =>
    rowFor({
      providerSessionId,
      title: `Chat ${providerSessionId}`,
      status: SESSION_STATUS.COMPLETE,
      lastActivityAt: 1_000,
      workspace: { providerWorkspaceId: "ws-1", name: "lisbon-v2" },
      advertises: [archive, ANSWER],
    });
  const rows = [chat("chat-a"), chat("chat-b")];
  // A lone chat is its own workspace: with no tray to carry the control, the row does.
  const [lone] = rows;
  assert.ok(lone);
  // The header says the archive once, whichever chat advertised it.
  const header = renderToStaticMarkup(
    createElement(WorkspaceTrayActs, { acts: workspaceTrayActions(rows), writes: WRITES }),
  );
  assert.equal(header.match(/Archive workspace/g)?.length, 1);
});
