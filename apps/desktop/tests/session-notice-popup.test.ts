import assert from "node:assert/strict";
import test from "node:test";
import { PANEL_PRESENTATION } from "../src/renderer/panel-state";
import {
  enqueueNoticePopups,
  MAXIMUM_QUEUED_POPUPS,
  NOTICE_POPUP_MAX_AGE_MS,
  noticePopupAllowed,
  takeNoticePopup,
} from "../src/renderer/session-notice-popup";
import type { SessionNoticePopup } from "../src/shared/contracts";

function popup(overrides: Partial<SessionNoticePopup> = {}): SessionNoticePopup {
  return {
    providerId: "claude-code",
    providerSessionId: "run:1",
    body: "Finished on luke.",
    decidedAt: 1_000,
    ...overrides,
  };
}

/** Titles every session, the way a roster that still holds them all would. */
function anyTitle(): string {
  return "Implement better notifications";
}

test("the resting shapes may draw a popup; every other state holds it back", () => {
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.CAPSULE, captionDrawn: false }),
    true,
  );
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.PEEK, captionDrawn: false }),
    true,
  );
  // The open panel is already showing the session's row, and the slot and the
  // composer are shapes someone asked for.
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.PANEL, captionDrawn: false }),
    false,
  );
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.SLOT, captionDrawn: false }),
    false,
  );
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.FEEDBACK, captionDrawn: false }),
    false,
  );
});

test("words on screen hold the popup back: the caption owns the same band", () => {
  assert.equal(
    noticePopupAllowed({ presentation: PANEL_PRESENTATION.CAPSULE, captionDrawn: true }),
    false,
  );
});

test("popups come back out in arrival order", () => {
  const queue = enqueueNoticePopups(
    [],
    [popup(), popup({ providerSessionId: "run:2", body: "Waiting on you." })],
  );

  const first = takeNoticePopup(queue, 1_000, anyTitle);
  assert.equal(first.drawn?.popup.providerSessionId, "run:1");
  assert.equal(first.drawn?.title, "Implement better notifications");
  const second = takeNoticePopup(first.queue, 1_000, anyTitle);
  assert.equal(second.drawn?.popup.providerSessionId, "run:2");
  assert.equal(second.queue.length, 0);
});

test("newer news about a session replaces what it had queued", () => {
  let queue = enqueueNoticePopups([], [popup({ body: "Waiting on you." })]);
  queue = enqueueNoticePopups(queue, [popup({ body: "Finished on luke.", decidedAt: 2_000 })]);

  const { queue: rest, drawn } = takeNoticePopup(queue, 2_000, anyTitle);
  assert.equal(drawn?.popup.body, "Finished on luke.");
  // The stale entry went with its replacement; nothing else waits.
  assert.equal(rest.length, 0);
});

test("news delayed past its own relevance is dropped rather than drawn", () => {
  const queue = enqueueNoticePopups([], [popup({ decidedAt: 1_000 })]);

  const { queue: rest, drawn } = takeNoticePopup(
    queue,
    1_000 + NOTICE_POPUP_MAX_AGE_MS + 1,
    anyTitle,
  );
  assert.equal(drawn, undefined);
  assert.equal(rest.length, 0);
});

test("a popup whose session the roster no longer titles is skipped", () => {
  const queue = enqueueNoticePopups(
    [],
    [popup(), popup({ providerSessionId: "run:2", body: "Waiting on you." })],
  );

  const { queue: rest, drawn } = takeNoticePopup(queue, 1_000, (candidate) =>
    candidate.providerSessionId === "run:2" ? "Still rostered" : undefined,
  );
  // There is no row the first popup's press could stand for, so the second is
  // what gets drawn — and everything inspected was consumed.
  assert.equal(drawn?.popup.providerSessionId, "run:2");
  assert.equal(drawn?.title, "Still rostered");
  assert.equal(rest.length, 0);
});

test("a backlog sheds its oldest: only so many popups ever wait", () => {
  const queue = enqueueNoticePopups(
    [],
    Array.from({ length: MAXIMUM_QUEUED_POPUPS + 2 }, (_, index) =>
      popup({ providerSessionId: `run:${index}` }),
    ),
  );

  assert.equal(queue.length, MAXIMUM_QUEUED_POPUPS);
  // The first two are gone; the survivors read out in order.
  assert.equal(takeNoticePopup(queue, 1_000, anyTitle).drawn?.popup.providerSessionId, "run:2");
});
