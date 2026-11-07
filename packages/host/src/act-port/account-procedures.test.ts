import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect, Option } from "effect";
import { ACCOUNT_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import { accountProcedures } from "./account-procedures.js";
import type { ActSender } from "./base.js";
import { type SettledAct, settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The account's acts, through the act port as a window calls them: the
 * asks relayed as declared answer any window of this build's own and refuse
 * a frame it does not trust in each ask's own words; the sign-out and the
 * deletion each stop the recording before they run, and give it back where
 * the host never answered; and a sign-out the developer cancels at the
 * shell's question answers the account as it stands and stops nothing.
 */

const PANEL: ActSender = { sender: Symbol("window"), panel: true };
const OTHER_WINDOW: ActSender = { sender: Symbol("other window"), panel: false };

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
  [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: "Could not sign out on this system.",
  [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: "Could not delete that account on this system.",
} as const;

/** Each relayed ask with a payload its schema takes, what any window of this build's own hears of it, and its refusal. */
const RELAYED: readonly {
  readonly kind: string & (typeof ACCOUNT_ACT_KIND)[keyof typeof ACCOUNT_ACT_KIND];
  readonly payload: WireBoundaryInput;
  readonly settled: SettledAct<WireBoundaryInput>;
  readonly refusal: string;
}[] = [
  {
    kind: ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN,
    payload: { provider: ACCOUNT_PROVIDER.GITHUB },
    settled: { answer: { account: SIGNED_IN } },
    refusal: "Could not start signing in on this system.",
  },
  {
    kind: ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN,
    payload: { provider: ACCOUNT_PROVIDER.GITHUB },
    settled: { answer: false },
    refusal: "Sign-in didn't finish.",
  },
  {
    kind: ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN,
    payload: undefined,
    settled: { answer: undefined },
    refusal: "Could not cancel that sign-in on this system.",
  },
  {
    kind: ACCOUNT_ACT_KIND.ACCOUNT_SUPPORT_ACCESS,
    payload: { grant: false },
    // Note that the test's host holds no session of the service's to write a grant under, so the grant is refused before anything travels.
    settled: { refused: "Couldn't change support access." },
    refusal: "Couldn't change support access.",
  },
];

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
function windowPort(
  options: {
    ended?: Effect.Effect<AccountSnapshot, unknown>;
    askBeforeSignOut?: () => Promise<boolean>;
  } = {},
) {
  const happened: unknown[] = [];
  const ended = options.ended ?? Effect.succeed(SIGNED_OUT);
  port = testActPort(
    accountProcedures({
      host: { accountSnapshot: () => Effect.succeed(Option.some(SIGNED_IN)) },
      acts: {
        ACCOUNT_SIGN_OUT: () =>
          Effect.sync(() => happened.push(["signOut"])).pipe(Effect.andThen(ended)),
        ACCOUNT_DELETE: () =>
          Effect.sync(() => happened.push(["deleteAccount"])).pipe(Effect.andThen(ended)),
      },
      haltSessionReplay: () => happened.push(["halt"]),
      resumeSessionReplay: () => happened.push(["resume"]),
      ...(options.askBeforeSignOut === undefined
        ? {}
        : { askBeforeSignOut: options.askBeforeSignOut }),
    }),
  );
  const client = port.as(PANEL, { trusted: true });
  return { client, happened };
}

/** A call settled to the sentence of its refusal, or a failure where it answered. */
async function refusal(call: Promise<unknown>): Promise<string> {
  const settled = await settledAct(call);
  return "refused" in settled
    ? settled.refused
    : assert.fail("the call was answered rather than refused");
}

it("a sign-out and a deletion stop the recording before the host is asked, and answer the account as it then stands", async () => {
  const { client, happened } = windowPort();

  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT](), SIGNED_OUT);
  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_DELETE](), SIGNED_OUT);
  assert.deepEqual(happened, [["halt"], ["signOut"], ["halt"], ["deleteAccount"]]);
});

it("a sign-out the developer cancels at the shell's question answers the account as it stands, and stops nothing", async () => {
  const { client, happened } = windowPort({ askBeforeSignOut: async () => false });

  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT](), SIGNED_IN);
  assert.deepEqual(happened, []);
});

it("a sign-out the developer agrees to at the shell's question signs out", async () => {
  const { client, happened } = windowPort({ askBeforeSignOut: async () => true });

  assert.deepEqual(await client[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT](), SIGNED_OUT);
  assert.deepEqual(happened, [["halt"], ["signOut"]]);
});

it("a sign-out or a deletion the host refused gives the recording back, and is refused in the kind's own words", async () => {
  const { client, happened } = windowPort({ ended: Effect.fail(new Error("secret detail")) });

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

it.effect.each(RELAYED)(
  "$kind answers a window that is no panel, and refuses a frame this build does not trust in its own words",
  ({ kind, payload, settled, refusal }) =>
    Effect.gen(function* () {
      const { port: host } = yield* hostActPort({ account: SIGNED_IN });

      assert.deepEqual(yield* host.perform({ kind, payload }, OTHER_WINDOW), settled);
      assert.deepEqual(yield* host.perform({ kind, payload }, PANEL, { trusted: false }), {
        refused: refusal,
      });
    }),
);
