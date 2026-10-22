import { ACCOUNT_PROVIDER, accountSnapshotSchema } from "@luke/credentials/snapshot";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { ACCOUNT_ACT_KIND } from "./kinds.js";

/**
 * account.ts -- the account's asks of the host: signing in, signing out, and the account deleted, as procedures.
 *
 * Each output is its schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, the convention every act contract
 * keeps (`agents.ts`).
 */

/** Which provider a sign-in goes through. */
const providerParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
});

export const accountActsContract = {
  [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: actProcedure(
    "Could not start signing in on this system.",
  )
    .input(exactInput(providerParamsSchema))
    .output(EffectSchema.flip(accountSnapshotSchema)),
  [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: actProcedure("Sign-in didn't finish.")
    .input(exactInput(providerParamsSchema))
    .output(EffectSchema.flip(EffectSchema.Boolean)),
  [ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: actProcedure(
    "Could not cancel that sign-in on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(EffectSchema.Void)),
  [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: actProcedure("Could not sign out on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(accountSnapshotSchema)),
  [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: actProcedure("Could not delete that account on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(accountSnapshotSchema)),
};
