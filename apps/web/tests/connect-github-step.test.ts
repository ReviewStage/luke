import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONNECT_STEP,
  connectStepFromSearch,
  failedLinkAddress,
  LINK_FAILED,
  linkErrorWords,
} from "../src/connect-github-step";

/**
 * What the connect page reads off its address, and the words it draws for
 * Better Auth's refusals. Better Auth returns a refused link to the page's
 * `errorCallbackURL` with its own `error` code appended after the page's
 * `error=1`, so the code the page draws is the other value.
 */

test("Better Auth's code is read past the page's own error flag and drawn in Luke's words", () => {
  const step = connectStepFromSearch("?error=1&error=account_already_linked_to_different_user");

  assert.deepEqual(step, {
    kind: CONNECT_STEP.FAILED,
    code: "account_already_linked_to_different_user",
    retry: undefined,
  });
  assert.equal(
    linkErrorWords(LINK_FAILED.CONNECT, "account_already_linked_to_different_user"),
    "This GitHub account belongs to another Luke account. Sign in with GitHub instead.",
  );
});

test("a refusal Luke has no words for is drawn with Better Auth's own message or code", () => {
  assert.equal(
    linkErrorWords(LINK_FAILED.CONNECT, "state_mismatch"),
    "GitHub could not be connected: state_mismatch",
  );
  assert.equal(
    linkErrorWords(LINK_FAILED.DISCONNECT, "ACCOUNT_NOT_FOUND", "Account not found"),
    "GitHub could not be disconnected: Account not found",
  );
  assert.equal(linkErrorWords(LINK_FAILED.CONNECT, undefined), "GitHub could not be connected.");
});

test("the address asks for a connect by its intent, a disconnect, or a finished link, and nothing else asks anything", () => {
  assert.deepEqual(connectStepFromSearch("?intent=opaque"), {
    kind: CONNECT_STEP.CONNECT,
    intent: "opaque",
  });
  assert.deepEqual(connectStepFromSearch("?disconnect=1"), { kind: CONNECT_STEP.DISCONNECT });
  assert.deepEqual(connectStepFromSearch("?done=1"), { kind: CONNECT_STEP.DONE });
  assert.deepEqual(connectStepFromSearch("?intent="), { kind: CONNECT_STEP.NOTHING });
  assert.deepEqual(connectStepFromSearch(""), { kind: CONNECT_STEP.NOTHING });
});

test("a link GitHub refused or the developer canceled comes back with its intent, which the page offers again", () => {
  // Better Auth appends its own code to the error address the page handed it.
  const returned = new URL(
    `${failedLinkAddress("opaque/1")}&error=access_denied`,
    "https://luke.test",
  );
  const step = connectStepFromSearch(returned.search);
  assert.equal(step.kind, CONNECT_STEP.FAILED);
  assert.equal(step.kind === CONNECT_STEP.FAILED ? step.code : undefined, "access_denied");
  const retry = step.kind === CONNECT_STEP.FAILED ? step.retry : undefined;
  assert.deepEqual(connectStepFromSearch(new URL(retry ?? "/", "https://luke.test").search), {
    kind: CONNECT_STEP.CONNECT,
    intent: "opaque/1",
  });
  const plain = connectStepFromSearch("?error=1&error=access_denied");
  assert.equal(plain.kind === CONNECT_STEP.FAILED ? plain.retry : "absent", undefined);
});
