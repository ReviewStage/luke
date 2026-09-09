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
import { SessionRow, type SessionWriteHandlers, WorkspaceTrayActs } from "./session-row-view";

const CONDUCTOR = { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };

const STOP = {
  kind: ACTION_KIND.CONTROL,
  id: "cancel-run",
  label: "Stop this run",
  controlKind: SESSION_CONTROL_KIND.STOP,
} as const;

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

function markupOf(session: SessionView, inWorkspaceTray = false): string {
  return renderToStaticMarkup(
    createElement(SessionRow, {
      session,
      index: 0,
      now: 2_000,
      leaving: false,
      inWorkspaceTray,
      onOpen: () => undefined,
      onOpenApplication: () => undefined,
      writes: WRITES,
    }),
  );
}

test("a row draws the composer and each advertised control only where its provider promised them", () => {
  const writable = rowFor({
    providerSessionId: "chat-writable",
    title: "Fix the flaky test",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: 1_000,
    advertises: [{ kind: ACTION_KIND.MESSAGE }, STOP, ANSWER],
  });
  const markup = markupOf(writable);
  // The follow-up field and its send, labelled for a reader by the provider.
  assert.match(markup, /class="row-compose"/);
  assert.match(markup, /placeholder="Send a follow-up…"/);
  assert.match(markup, /aria-label="Message Conductor"/);
  assert.match(markup, /class="row-send"/);
  // A stop is the square glyph carrying the provider's label; any other
  // control is a chip in the provider's own words.
  assert.match(markup, /class="row-stop"[^>]*aria-label="Stop this run"/);
  assert.match(markup, /class="row-action"[^>]*>Allow the edit</);

  const silent = rowFor({
    providerSessionId: "chat-silent",
    title: "Write the release notes",
    status: SESSION_STATUS.COMPLETE,
    lastActivityAt: 1_000,
  });
  const quiet = markupOf(silent);
  assert.doesNotMatch(quiet, /row-compose|row-send|row-stop|row-action/);
});

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
  for (const row of rows) {
    const markup = markupOf(row, true);
    assert.match(markup, />Allow the edit</);
    assert.doesNotMatch(markup, /Archive workspace/);
  }
  // A lone chat is its own workspace: with no tray to carry the control, the row does.
  const [lone] = rows;
  assert.ok(lone);
  assert.match(markupOf(lone), /Archive workspace/);
  // The header says the archive once, whichever chat advertised it.
  const header = renderToStaticMarkup(
    createElement(WorkspaceTrayActs, { acts: workspaceTrayActions(rows), writes: WRITES }),
  );
  assert.equal(header.match(/Archive workspace/g)?.length, 1);
  assert.doesNotMatch(header, /Allow the edit/);
});
