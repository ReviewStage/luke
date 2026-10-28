// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import { test } from "vitest";
import { BILLING, EXPIRY, INVITES, THRESHOLD } from "../testing/desktop-inbox.js";
import { heldInboxes } from "./held-inboxes.js";

test("an inbox the account's feed holds nothing of keeps its own follow's items once that follow is let go", () => {
  let lapse: (() => void) | undefined;
  const held = heldInboxes({
    linger: (letGo) => {
      lapse = letGo;
      return () => undefined;
    },
    forget: false,
  });
  // The feed answers for the invites task alone, as it leaves out a task whose items all settled past its bound.
  held.feed({
    whole: true,
    scopes: [{ scope: { kind: INBOX_SCOPE_KIND.PLAN, id: INVITES.id }, items: [EXPIRY] }],
  });
  const release = held.hold(INBOX_SCOPE_KIND.PLAN, BILLING.id, (_scope, hear) => {
    hear({ items: [THRESHOLD] });
    return () => undefined;
  });

  release();
  lapse?.();
  assert.deepEqual(
    held.heldOf(INBOX_SCOPE_KIND.PLAN).items.get(BILLING.id),
    [THRESHOLD],
    "the billing task's items as its own follow last pushed them",
  );
});

test("an inbox's items kept from a follow let go give way to the account's feed once it holds that inbox again", () => {
  let lapse: (() => void) | undefined;
  const held = heldInboxes({
    linger: (letGo) => {
      lapse = letGo;
      return () => undefined;
    },
    forget: false,
  });
  held.feed({ whole: true, scopes: [] });
  const release = held.hold(INBOX_SCOPE_KIND.PLAN, BILLING.id, (_scope, hear) => {
    hear({ items: [THRESHOLD] });
    return () => undefined;
  });
  release();
  lapse?.();

  // The item is answered again, so the feed holds the billing task anew, its item newer than the one kept.
  const answered = {
    ...THRESHOLD,
    revision: THRESHOLD.revision + 1,
    updatedAt: THRESHOLD.updatedAt + 1,
  };
  held.feed({
    whole: false,
    scopes: [{ scope: { kind: INBOX_SCOPE_KIND.PLAN, id: BILLING.id }, items: [answered] }],
  });
  assert.deepEqual(
    held.heldOf(INBOX_SCOPE_KIND.PLAN).items.get(BILLING.id),
    [answered],
    "the feed's newer word is drawn",
  );
});
