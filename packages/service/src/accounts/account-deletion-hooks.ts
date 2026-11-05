/**
 * account-deletion-hooks.ts -- the account's deletion steps run from Better Auth's `deleteUser` hooks, on the services the auth route hands the request.
 *
 * Better Auth awaits each of its hooks as a promise and hands it nothing of
 * the runtime's services, so the auth route hands the request's own services
 * in (`withAccountDeletionServices`, over `AsyncLocalStorage`, so two requests
 * on one instance never share them), and each hook runs its step on them
 * (`account-deletion.ts`). A hook reached with none handed, which only a call
 * straight on `auth.api` could do, refuses the delete rather than skip what
 * it owes. A step that fails rejects with the same shape an
 * `Effect.tryPromise` would have caught, so Better Auth answers it as the
 * failure it is. What would end this file's row among the permanent adaptors
 * is a Better Auth that takes an Effect hook.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Cause, type Context, Effect, Exit } from "effect";
import {
  type AccountDeletionPending,
  afterAccountDeletion,
  beforeAccountDeletion,
} from "./account-deletion.js";

type ServicesOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;

/** What the deletion's steps run on: the web runtime's database, clock, environment, HTTP client, harnesses, and Connect. */
export type AccountDeletionServices =
  | ServicesOf<ReturnType<typeof beforeAccountDeletion>>
  | ServicesOf<ReturnType<typeof afterAccountDeletion>>;

const handed = new AsyncLocalStorage<Context.Context<AccountDeletionServices>>();

/** Runs Better Auth's handler for one request with the services its deletion hooks run on. */
export function withAccountDeletionServices<A>(
  services: Context.Context<AccountDeletionServices>,
  handle: () => Promise<A>,
): Promise<A> {
  return handed.run(services, handle);
}

async function run<A, E>(effect: Effect.Effect<A, E, AccountDeletionServices>): Promise<A> {
  const services = handed.getStore();
  if (services === undefined) throw new Error("An account is deleted only through the auth route.");
  const exit = await Effect.runPromiseExitWith(services)(effect);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}

/** The deletion's steps as Better Auth's hooks await them (`auth-policy.ts`'s `accountDeletion`). */
export const accountDeletionSteps = {
  before: (userId: string) => run(beforeAccountDeletion(userId)),
  after: (userId: string, pending: AccountDeletionPending) =>
    run(afterAccountDeletion(userId, pending)),
};
