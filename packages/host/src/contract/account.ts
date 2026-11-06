import {
  ACCOUNT_PROVIDER,
  accountSnapshotSchema,
  signInAnswerSchema,
} from "@repo/credentials/snapshot";
import { supportAccessAnswerSchema } from "@repo/features/account-wire";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";

/**
 * account.ts -- the account's asks of the host: signing in, signing out, the account deleted, and its grant of support access, declared.
 *
 * Each is answered by the account's composer. The sign-out and the deletion
 * are answered by hand (`act-port/account-procedures.ts`), around their
 * handlers: the sign-out asks first where something would be lost, and both
 * stop the window's recording before the account it files under is gone. A
 * canceled sign-in answers nothing, and a cancel the host could not carry
 * answers that same nothing, as it always has.
 */

/** Which provider a sign-in goes through. */
const providerParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
});

/** Whether the grant of support access is granted for seven days, or revoked. */
const supportAccessParamsSchema = EffectSchema.Struct({ grant: EffectSchema.Boolean });

/** The account's asks, each answered by the account's composer. */
export const ACCOUNT_ACTS = declaredActs({
  ACCOUNT_BEGIN_SIGN_IN: hostAct({
    input: providerParamsSchema,
    output: signInAnswerSchema,
    refusal: "Could not start signing in on this system.",
    panelOnly: false,
    door: ACT.REMOTE_WORK,
  }),
  ACCOUNT_SIGN_IN_AGAIN: hostAct({
    input: providerParamsSchema,
    output: EffectSchema.Boolean,
    refusal: "Sign-in didn't finish.",
    panelOnly: false,
    door: ACT.REMOTE_WORK,
  }),
  ACCOUNT_CANCEL_SIGN_IN: hostAct({
    input: EffectSchema.Undefined,
    output: EffectSchema.Void,
    refusal: "Could not cancel that sign-in on this system.",
    panelOnly: false,
    door: ACT.LOCAL_WRITE,
    unanswered: undefined,
  }),
  ACCOUNT_SIGN_OUT: hostAct({
    input: EffectSchema.Undefined,
    output: accountSnapshotSchema,
    refusal: "Could not sign out on this system.",
    panelOnly: false,
    door: ACT.LOCAL_WRITE,
    byHand: true,
  }),
  ACCOUNT_DELETE: hostAct({
    input: EffectSchema.Undefined,
    output: accountSnapshotSchema,
    refusal: "Could not delete that account on this system.",
    panelOnly: false,
    door: ACT.REMOTE_WORK,
    byHand: true,
  }),
  ACCOUNT_SUPPORT_ACCESS: hostAct({
    input: supportAccessParamsSchema,
    output: supportAccessAnswerSchema,
    refusal: "Couldn't change support access.",
    panelOnly: false,
    door: ACT.REMOTE_WORK,
  }),
});

export const accountActsContract = contractOf(ACCOUNT_ACTS);
