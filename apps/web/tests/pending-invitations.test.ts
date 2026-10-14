import assert from "node:assert/strict";
import { test } from "vitest";
import { pendingInvitationsFrom } from "../src/pending-invitations";

/**
 * The invite page's pending invitations, shaped from the organization
 * plugin's listing: only those still waiting on their invitee, and a refused
 * listing told apart from a workspace with nothing pending.
 */

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const LATER = "2026-10-20T12:00:00.000Z";
const EARLIER = "2026-10-13T12:00:00.000Z";

function listed(id: string, status: string, expiresAt: string) {
  return { id, email: `${id}@example.com`, role: "member", status, expiresAt };
}

test("a refused listing answers a failure, not an empty list", () => {
  const answer = pendingInvitationsFrom(
    { data: null, error: { status: 503, statusText: "Service Unavailable" } },
    NOW,
  );

  assert.deepEqual(answer, { ok: false });
});

test("a listing answers its pending invitations, their expiry read as a date", () => {
  const answer = pendingInvitationsFrom(
    { data: [listed("ada", "pending", LATER)], error: null },
    NOW,
  );

  assert.deepEqual(answer, {
    ok: true,
    invitations: [
      { id: "ada", email: "ada@example.com", role: "member", expiresAt: new Date(LATER) },
    ],
  });
});

test("expired, accepted, and canceled invitations are left out", () => {
  const answer = pendingInvitationsFrom(
    {
      data: [
        listed("expired", "pending", EARLIER),
        listed("accepted", "accepted", LATER),
        listed("canceled", "canceled", LATER),
        listed("ada", "pending", LATER),
      ],
      error: null,
    },
    NOW,
  );

  assert.deepEqual(answer.ok ? answer.invitations.map((invitation) => invitation.id) : answer, [
    "ada",
  ]);
});

test("a workspace with nothing pending answers an empty list", () => {
  assert.deepEqual(pendingInvitationsFrom({ data: [], error: null }, NOW), {
    ok: true,
    invitations: [],
  });
});
