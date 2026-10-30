/**
 * auth-counts.ts -- the counts Better Auth's own hooks make, handed to the route that answers the request.
 *
 * A sign-up and an accepted invitation commit inside Better Auth, whose hooks
 * are promises that know nothing of the runtime's services. A hook therefore
 * only notes the count (`countFromAuth`) on the list the request carries
 * (`withAuthCounts`, over `AsyncLocalStorage`, so two requests on one
 * instance never share a list); the auth route records the list once Better
 * Auth has answered (`recordAuthCount`, from `auth-app.ts`), so each count is
 * made where every other counted event is, after the write and past the answer.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_SIGN_IN_METHOD,
  type ServerEventProperties,
} from "../events/server-events.js";

type AuthCountName =
  | typeof SERVER_EVENT.ACCOUNT_SIGN_UP
  | typeof SERVER_EVENT.WORKSPACE_INVITE_ACCEPT;

/** One count a hook noted: a server event, with the account it is under and its own properties. */
export type AuthCount = {
  [Name in AuthCountName]: {
    readonly name: Name;
    readonly userId: string;
    readonly properties: ServerEventProperties[Name];
  };
}[AuthCountName];

const noted = new AsyncLocalStorage<AuthCount[]>();

/** What a hook says of the request it ran in: the provider's id on a callback's path, `/callback/:id`. */
interface HookRequest {
  readonly params?: Record<string, string | undefined> | undefined;
}

/** The sign-in method a request names, one of the two providers' ids, and `unknown` for anything else. */
function signInMethodOf(request: HookRequest | null) {
  const named = request?.params?.["id"];
  return (
    Object.values(SERVER_SIGN_IN_METHOD).find(
      (method) => method !== SERVER_SIGN_IN_METHOD.UNKNOWN && method === named,
    ) ?? SERVER_SIGN_IN_METHOD.UNKNOWN
  );
}

/** Notes a count on the request being handled; nothing where none is, as a call made straight on `auth.api` has no route to record it. */
function countFromAuth(count: AuthCount): void {
  noted.getStore()?.push(count);
}

/**
 * Runs Better Auth's handler for one request and answers its answer with the
 * counts its hooks noted, for the caller to record.
 */
export async function withAuthCounts<A>(
  handle: () => Promise<A>,
): Promise<{ readonly answer: A; readonly counts: readonly AuthCount[] }> {
  const counts: AuthCount[] = [];
  const answer = await noted.run(counts, handle);
  return { answer, counts };
}

/** One noted count recorded, as `recordServerEvent` records any. */
export function recordAuthCount(count: AuthCount) {
  switch (count.name) {
    case SERVER_EVENT.ACCOUNT_SIGN_UP:
      return recordServerEvent(count.name, count.userId, count.properties);
    case SERVER_EVENT.WORKSPACE_INVITE_ACCEPT:
      return recordServerEvent(count.name, count.userId, count.properties);
  }
}

/** Better Auth's `databaseHooks`: an account made is a sign-up, counted under the new account's own id. */
export const authDatabaseHooks = {
  user: {
    create: {
      after: async (user: { readonly id: string }, request: HookRequest | null) => {
        countFromAuth({
          name: SERVER_EVENT.ACCOUNT_SIGN_UP,
          userId: user.id,
          properties: { method: signInMethodOf(request) },
        });
      },
    },
  },
} as const;

/** The organization plugin's `organizationHooks`: an invitation accepted is counted under the account that accepted it. */
export const authOrganizationHooks = {
  afterAcceptInvitation: async (accepted: { readonly user: { readonly id: string } }) => {
    countFromAuth({
      name: SERVER_EVENT.WORKSPACE_INVITE_ACCEPT,
      userId: accepted.user.id,
      properties: {},
    });
  },
} as const;
