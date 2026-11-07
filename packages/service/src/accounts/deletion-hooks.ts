/**
 * deletion-hooks.ts -- the account's and a workspace's deletion steps run from Better Auth's hooks, on the services the request hands them.
 *
 * Better Auth awaits each of its hooks as a promise and hands it nothing of
 * the runtime's services, so whatever calls Better Auth hands the request's
 * own services in (`withDeletionServices`, over `AsyncLocalStorage`, so two
 * requests on one instance never share them), and each hook runs its step
 * on them: `deleteUser`'s (`account-deletion.ts`) and the organization
 * plugin's `deleteOrganization`'s (`workspace-deletion.ts`), which an
 * account's deletion reaches from inside its own hook, and an owner's
 * delete reaches through `workspaceDeleteCall`. A hook reached with
 * none handed refuses the delete rather than skip what it owes. A step that
 * fails rejects with the same shape an `Effect.tryPromise` would have
 * caught, so Better Auth answers it as the failure it is. What would end
 * this file's row among the permanent adaptors is a Better Auth that takes
 * an Effect hook.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, type Context, Effect, Exit } from "effect";
import {
  type AccountDeletionPending,
  afterAccountDeletion,
  beforeAccountDeletion,
} from "./account-deletion.js";
import {
  afterWorkspaceDeletion,
  beforeWorkspaceDeletion,
  type WorkspaceDeletionPending,
} from "./workspace-deletion.js";

type ServicesOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;

/** What the deletions' steps run on: the web runtime's database, clock, environment, HTTP client, harnesses, and Connect. */
export type DeletionServices =
  | ServicesOf<ReturnType<typeof beforeAccountDeletion>>
  | ServicesOf<ReturnType<typeof afterAccountDeletion>>
  | ServicesOf<ReturnType<typeof beforeWorkspaceDeletion>>
  | ServicesOf<ReturnType<typeof afterWorkspaceDeletion>>;

const handed = new AsyncLocalStorage<Context.Context<DeletionServices>>();

/** The part of a Better Auth `api` with the organization plugin that an owner's delete calls. */
export interface WorkspaceDeleteApi {
  readonly deleteOrganization: (input: {
    headers: Headers;
    body: { organizationId: string };
  }) => Promise<object | null>;
}

/** A workspace deleted under the session the headers carry. */
export interface WorkspaceDeleting {
  readonly headers: Headers;
  readonly organizationId: string;
}

/** An owner's delete of a workspace through the plugin, its hooks run on the services of the fiber that asked. */
export type WorkspaceDeleteCall = (
  deleting: WorkspaceDeleting,
) => Effect.Effect<void, MemberFailure, DeletionServices>;

/** Runs a call into Better Auth with the services its deletion hooks run on. */
export function withDeletionServices<A>(
  services: Context.Context<DeletionServices>,
  handle: () => Promise<A>,
): Promise<A> {
  return handed.run(services, handle);
}

/**
 * The plugin's `deleteOrganization` under the session the headers carry,
 * handed the asking fiber's services for the deletion hooks it runs, its
 * refusal kept by status and code as every other plugin call's.
 */
export function workspaceDeleteCall(api: WorkspaceDeleteApi): WorkspaceDeleteCall {
  return ({ headers, organizationId }) =>
    Effect.flatMap(Effect.context<DeletionServices>(), (services) =>
      Effect.asVoid(
        pluginCall(() =>
          withDeletionServices(services, () =>
            api.deleteOrganization({ headers, body: { organizationId } }),
          ),
        ),
      ),
    );
}

async function run<A, E>(effect: Effect.Effect<A, E, DeletionServices>): Promise<A> {
  const services = handed.getStore();
  if (services === undefined) throw new Error("A deletion's services were not handed to it.");
  const exit = await Effect.runPromiseExitWith(services)(effect);
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
}

/** The account's deletion steps as Better Auth's `deleteUser` hooks await them (`auth-policy.ts`'s `accountDeletion`). */
export const accountDeletionSteps = {
  before: (userId: string) => run(beforeAccountDeletion(userId)),
  after: (userId: string, pending: AccountDeletionPending) =>
    run(afterAccountDeletion(userId, pending)),
};

/** A workspace's deletion steps as the organization plugin's hooks await them (`auth-policy.ts`'s `workspaceDeletion`). */
export const workspaceDeletionSteps = {
  before: (organizationId: string) => run(beforeWorkspaceDeletion(organizationId)),
  after: (pending: WorkspaceDeletionPending) => run(afterWorkspaceDeletion(pending)),
};
