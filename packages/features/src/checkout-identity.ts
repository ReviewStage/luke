import { Schema } from "effect";

/**
 * checkout-identity.ts -- who a coding agent's commits are by, and the one step that sets it in its checkout, whichever machine the checkout stands on.
 *
 * The service settles the identity once per checkout, through the coding
 * agent's own reads (`packages/service`'s `coder-host/checkout.ts`): the
 * developer's GitHub account, the account a member's own token belongs to,
 * or the Luke GitHub App's bot. A cloud sandbox has it set as its checkout
 * deepens (`repository-shell.ts`'s `setCheckoutIdentity`); a device has it
 * handed on the launch line (`device-agent-wire.ts`) and sets it in the
 * agent's own repository before the runner starts
 * (`@luke/host`'s `compose-local-agents.ts`). Both run this script, in the
 * checkout, with the identity in these variables, so neither splices a name
 * into shell text and the two can never set it differently.
 */

/** A git identity as git takes it: a name and an address. */
export const checkoutIdentitySchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});

export type CheckoutIdentity = typeof checkoutIdentitySchema.Type;

/** The variables the script reads the identity from. */
export const CHECKOUT_IDENTITY_VARIABLE = {
  NAME: "LUKE_GIT_NAME",
  EMAIL: "LUKE_GIT_EMAIL",
} as const;

/**
 * The identity set in the checkout's own config, never a global one, so the
 * agent's commits are by whoever the checkout names wherever git reads them.
 * Run with the checkout as its working directory.
 */
export const CHECKOUT_IDENTITY_SCRIPT = [
  "set -e",
  `git config user.name "$${CHECKOUT_IDENTITY_VARIABLE.NAME}"`,
  `git config user.email "$${CHECKOUT_IDENTITY_VARIABLE.EMAIL}"`,
].join("\n");

/** The script's variables for the identity given. */
export function checkoutIdentityEnv(identity: CheckoutIdentity): Readonly<Record<string, string>> {
  return {
    [CHECKOUT_IDENTITY_VARIABLE.NAME]: identity.name,
    [CHECKOUT_IDENTITY_VARIABLE.EMAIL]: identity.email,
  };
}
