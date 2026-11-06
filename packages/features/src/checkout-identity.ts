import { Schema } from "effect";

export const checkoutIdentitySchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});

export type CheckoutIdentity = typeof checkoutIdentitySchema.Type;

export const CHECKOUT_IDENTITY_VARIABLE = {
  NAME: "APP_GIT_NAME",
  EMAIL: "APP_GIT_EMAIL",
} as const;

export const CHECKOUT_IDENTITY_SCRIPT = [
  "set -e",
  `git config user.name "$${CHECKOUT_IDENTITY_VARIABLE.NAME}"`,
  `git config user.email "$${CHECKOUT_IDENTITY_VARIABLE.EMAIL}"`,
].join("\n");

export function checkoutIdentityEnv(identity: CheckoutIdentity): Readonly<Record<string, string>> {
  return {
    [CHECKOUT_IDENTITY_VARIABLE.NAME]: identity.name,
    [CHECKOUT_IDENTITY_VARIABLE.EMAIL]: identity.email,
  };
}
