import {
  ACCOUNT_PROVIDER,
  accountSnapshotSchema,
  signInAnswerSchema,
} from "@repo/credentials/snapshot";
import { supportAccessAnswerSchema } from "@repo/features/account-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { ACCOUNT_ACT_KIND } from "./kinds.js";

const providerParamsSchema = EffectSchema.Struct({
  provider: EffectSchema.Literals(Object.values(ACCOUNT_PROVIDER)),
});

const supportAccessParamsSchema = EffectSchema.Struct({ grant: EffectSchema.Boolean });

export const accountActsContract = {
  [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: actProcedure(
    "Could not start signing in on this system.",
  )
    .input(exactInput(providerParamsSchema))
    .output(EffectSchema.flip(signInAnswerSchema)),
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
  [ACCOUNT_ACT_KIND.ACCOUNT_SUPPORT_ACCESS]: actProcedure("Couldn't change support access.")
    .input(exactInput(supportAccessParamsSchema))
    .output(EffectSchema.flip(supportAccessAnswerSchema)),
};
