import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { Effect } from "effect";
import { ACCOUNT_ACT_KIND } from "../contract/index.js";
import { accountProcedures } from "./account-procedures.js";
import type { ActSender } from "./base.js";
import type { AccountProceduresDependencies } from "./index.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The account's acts, through the act port as a window calls them: a
 * sign-in reaches the host with its provider and the host's answer crosses
 * back; a sign-out or a deletion stops the recording before it runs, and
 * gives it back where the host never answered; and a frame this build does
 * not trust is refused each act in its own words, before the host is asked.
 */

const PANEL: ActSender = { sender: Symbol("window"), panel: true, voice: false, call: false };

const SIGNED_IN: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-1",
  email: "dev@example.com",
  name: "Dev",
  provider: ACCOUNT_PROVIDER.GITHUB,
};
const SIGNED_OUT: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: "Could not start signing in on this system.",
  [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: "Sign-in didn't finish.",
  [ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: "Could not cancel that sign-in on this system.",
  [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: "Could not sign out on this system.",
  [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: "Could not delete that account on this system.",
} as const;

let port: TestActPort<unknown> | undefined;

afterEach(() => {
  port?.close();
  port = undefined;
});

/**
 * A window's act port onto the account procedures, over a host whose
 * sign-out and deletion answer `ended`, recording every ask and every halt
 * and resume of the recording, in order.
 */
function windowPort(options: { trusted?: boolean; ended?: Effect.Effect<AccountSnapshot> } = {}) {
  const happened: unknown[] = [];
  const ended = options.ended ?? Effect.succeed(SIGNED_OUT);
  const host: AccountProceduresDependencies["host"] = {
    beginSignIn: (provider) =>
      Effect.sync(() => happened.push(["beginSignIn", provider])).pipe(Effect.as(SIGNED_IN)),
    signInAgain: (provider) =>
      Effect.sync(() => happened.push(["signInAgain", provider])).pipe(Effect.as(true)),
    cancelSignIn: () => Effect.sync(() => void happened.push(["cancelSignIn"])),
    signOut: () => Effect.sync(() => happened.push(["signOut"])).pipe(Effect.andThen(ended)),
    deleteAccount: () =>
      Effect.sync(() => happened.push(["deleteAccount"])).pipe(Effect.andThen(ended)),
  };
  port = testActPort(
    accountProcedures({
      host,
      haltSessionReplay: () => happened.push(["halt"]),
      resumeSessionReplay: () => happened.push(["resume"]),
    }),
  );
  const client = port.as(PANEL, { trusted: options.trusted ?? true });
  return { client, happened };
}

/** A call settled to the sentence of its refusal, or a failure where it answered. */
async function refusal(call: Promise<unknown>): Promise<string> {
  const settled = await settledAct(call);
  return "refused" in settled
    ? settled.refused
    : assert.fail("the call was answered rather than refused");
}

it("a sign-in reaches the host with its provider, and the host's answer crosses back", async () => {
  const { client, happened } = windowPort();

  assert.deepEqual(
    await client[ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]({ provider: ACCOUNT_PROVIDER.GITHUB }),
    SIGNED_IN,
  );
  assert.equal(
    await client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]({ provider: ACCOUNT_PROVIDER.GOOGLE }),
    true,
  );
  assert.equal(await client[ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN](), undefined);
  assert.deepEqual(happened, [
    ["beginSignIn", ACCOUNT_PROVIDER.GITHUB],
    ["signInAgain", ACCOUNT_PROVIDER.GOOGLE],
    ["cancelSignIn"],
  ]);
});

it("a sign-out and a deletion stop the recording before the host is asked, and answer the account as it then stands", async () => {
  const { client, happened } = windowPort();

  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT](), SIGNED_OUT);
  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_DELETE](), SIGNED_OUT);
  assert.deepEqual(happened, [["halt"], ["signOut"], ["halt"], ["deleteAccount"]]);
});

it("a sign-out or a deletion the host never answered gives the recording back, and is refused in the kind's own words", async () => {
  const { client, happened } = windowPort({ ended: Effect.die(new Error("secret detail")) });

  assert.equal(
    await refusal(client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]()),
    REFUSAL[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT],
  );
  assert.equal(
    await refusal(client[ACCOUNT_ACT_KIND.ACCOUNT_DELETE]()),
    REFUSAL[ACCOUNT_ACT_KIND.ACCOUNT_DELETE],
  );
  assert.deepEqual(happened, [
    ["halt"],
    ["signOut"],
    ["resume"],
    ["halt"],
    ["deleteAccount"],
    ["resume"],
  ]);
});

it("a frame this build does not trust is refused every account act in the kind's own words, and the host is not asked", async () => {
  const { client, happened } = windowPort({ trusted: false });

  assert.deepEqual(
    {
      [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: await refusal(
        client[ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]({ provider: ACCOUNT_PROVIDER.GITHUB }),
      ),
      [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: await refusal(
        client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]({ provider: ACCOUNT_PROVIDER.GITHUB }),
      ),
      [ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: await refusal(
        client[ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN](),
      ),
      [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: await refusal(
        client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT](),
      ),
      [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: await refusal(client[ACCOUNT_ACT_KIND.ACCOUNT_DELETE]()),
    },
    REFUSAL,
  );
  assert.deepEqual(happened, []);
});

it("a sign-in carrying a key its payload does not take is refused in the kind's own words, and the host is not asked", async () => {
  const { client, happened } = windowPort();
  const extra = { provider: ACCOUNT_PROVIDER.GITHUB, unexpected: true } as const;

  assert.equal(
    await refusal(client[ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN](extra)),
    REFUSAL[ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN],
  );
  assert.deepEqual(happened, []);
});
