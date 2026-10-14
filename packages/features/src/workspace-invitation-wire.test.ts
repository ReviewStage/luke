import assert from "node:assert/strict";
import { test } from "vitest";
import { invitationAcceptQuery, invitationAcceptUrl } from "./workspace-invitation-wire.js";

test("the accept page reads back the invitation and the address the invite page wrote, plus and ampersand included", () => {
  const link = new URL(
    invitationAcceptUrl("https://tryluke.dev", "inv_1", "ada+luke&co@example.com"),
  );

  assert.equal(link.origin + link.pathname, "https://tryluke.dev/accept-invitation.html");
  assert.deepEqual(invitationAcceptQuery(link.search), {
    id: "inv_1",
    email: "ada+luke&co@example.com",
  });
});

test("an accept link with no address, or an empty id, names nothing it does not carry", () => {
  assert.deepEqual(invitationAcceptQuery("?id=inv_1"), { id: "inv_1", email: undefined });
  assert.deepEqual(invitationAcceptQuery("?id=&email="), { id: undefined, email: undefined });
});
