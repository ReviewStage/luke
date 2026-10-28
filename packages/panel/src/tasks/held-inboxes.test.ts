// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
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
