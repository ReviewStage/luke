import assert from "node:assert/strict";
import { test } from "vitest";
import {
  invitationAcceptQuery,
  invitationAcceptUrl,
  inviteesOf,
} from "./workspace-invitation-wire.js";

test("the accept page reads back the invitation and the address the invite page wrote, plus and ampersand included", () => {
  const link = new URL(
    invitationAcceptUrl("https://vespin.dev", "inv_1", "ada+luke&co@example.com"),
  );

  assert.equal(link.origin + link.pathname, "https://vespin.dev/accept-invitation");
  assert.deepEqual(invitationAcceptQuery(link.search), {
    id: "inv_1",
    email: "ada+luke&co@example.com",
  });
});

test("an accept link with no address, or an empty id, names nothing it does not carry", () => {
  assert.deepEqual(invitationAcceptQuery("?id=inv_1"), { id: "inv_1", email: undefined });
  assert.deepEqual(invitationAcceptQuery("?id=&email="), { id: undefined, email: undefined });
});

test("a pasted To line splits into its addresses, each named where it was, a name's comma kept and a repeat dropped", () => {
  assert.deepEqual(
    inviteesOf(
      '"Ruiz, Dana" <dana@acme.dev>, Theo Park <theo@acme.dev>; THEO@acme.dev mailto:priya@acme.dev\nsam@gmail',
    ).map(({ email, name, invitable }) => ({ email, name, invitable })),
    [
      { email: "dana@acme.dev", name: "Ruiz, Dana", invitable: true },
      { email: "theo@acme.dev", name: "Theo Park", invitable: true },
      { email: "priya@acme.dev", name: undefined, invitable: true },
      { email: "sam@gmail", name: undefined, invitable: false },
    ],
  );
});
