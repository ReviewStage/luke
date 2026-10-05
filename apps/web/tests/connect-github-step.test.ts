import assert from "node:assert/strict";
import { test } from "vitest";
import { CONNECT_STEP, connectStep, returnAddress } from "../src/connect-github-step";

/**
 * Which step the Connect GitHub page shows, from the browser's session and
 * the address the Mac opened it at (or Better Auth returned it to): a link
 * is only ever offered to the Luke account the Mac named.
 *
 * Synthetic account ids throughout.
 */

const MAC_ACCOUNT = "user-mac";
const query = (search: string) => new URLSearchParams(search);

test("a browser with no Luke session signs in before anything is linked", () => {
  assert.deepEqual(connectStep(undefined, query(`?account=${MAC_ACCOUNT}`)), {
    step: CONNECT_STEP.SIGN_IN,
  });
});

test("a browser signed in as another account than the Mac's is told so, not linked", () => {
  assert.deepEqual(connectStep("user-other", query(`?account=${MAC_ACCOUNT}`)), {
    step: CONNECT_STEP.WRONG_ACCOUNT,
  });
  assert.deepEqual(connectStep("user-other", query(`?account=${MAC_ACCOUNT}&connected=1`)), {
    step: CONNECT_STEP.WRONG_ACCOUNT,
  });
});

test("the Mac's account is offered the link, and told once it landed", () => {
  assert.deepEqual(connectStep(MAC_ACCOUNT, query(`?account=${MAC_ACCOUNT}`)), {
    step: CONNECT_STEP.READY,
  });
  assert.deepEqual(connectStep(MAC_ACCOUNT, query(`?account=${MAC_ACCOUNT}&connected=1`)), {
    step: CONNECT_STEP.CONNECTED,
  });
});

test("a refused link says why in the page's words, and a reason it does not know stays generic", () => {
  assert.deepEqual(
    connectStep(MAC_ACCOUNT, query("?error=account_already_linked_to_different_user")),
    {
      step: CONNECT_STEP.FAILED,
      message: "That GitHub account is already connected to another Luke account.",
    },
  );
  assert.deepEqual(connectStep(MAC_ACCOUNT, query("?error=something_new")), {
    step: CONNECT_STEP.FAILED,
    message: "GitHub could not be connected. Try again.",
  });
});

test("where Better Auth returns to keeps the Mac's account and drops everything else", () => {
  const here = new URL(`https://tryluke.dev/connect-github.html?account=${MAC_ACCOUNT}&error=x`);

  assert.equal(
    returnAddress(here, "connected"),
    `/connect-github.html?account=${MAC_ACCOUNT}&connected=1`,
  );
  assert.equal(returnAddress(here, ""), `/connect-github.html?account=${MAC_ACCOUNT}`);
});
