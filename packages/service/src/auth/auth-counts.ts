import { AsyncLocalStorage } from "node:async_hooks";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_SIGN_IN_METHOD,
  type ServerEventActor,
  type ServerEventProperties,
} from "../events/server-events.js";

type AuthCountName =
  | typeof SERVER_EVENT.ACCOUNT_SIGN_UP
  | typeof SERVER_EVENT.WORKSPACE_INVITE_ACCEPT
  | typeof SERVER_EVENT.GITHUB_ACCOUNT_LINK;

export type AuthCount = {
  [Name in AuthCountName]: {
    readonly name: Name;
    readonly actor: ServerEventActor<Name>;
    readonly properties: ServerEventProperties[Name];
  };
}[AuthCountName];

const noted = new AsyncLocalStorage<AuthCount[]>();

interface HookRequest {
  readonly params?: Record<string, string | undefined> | undefined;
}

function signInMethodOf(request: HookRequest | null) {
  const named = request?.params?.["id"];
  return (
    Object.values(SERVER_SIGN_IN_METHOD).find(
      (method) => method !== SERVER_SIGN_IN_METHOD.UNKNOWN && method === named,
    ) ?? SERVER_SIGN_IN_METHOD.UNKNOWN
  );
}

function countFromAuth(count: AuthCount): void {
  noted.getStore()?.push(count);
}

export async function withAuthCounts<A>(
  handle: () => Promise<A>,
): Promise<{ readonly answer: A; readonly counts: readonly AuthCount[] }> {
  const counts: AuthCount[] = [];
  const answer = await noted.run(counts, handle);
  return { answer, counts };
}

export function recordAuthCount(count: AuthCount) {
  switch (count.name) {
    case SERVER_EVENT.ACCOUNT_SIGN_UP:
      return recordServerEvent(count.name, count.actor, count.properties);
    case SERVER_EVENT.WORKSPACE_INVITE_ACCEPT:
      return recordServerEvent(count.name, count.actor, count.properties);
    case SERVER_EVENT.GITHUB_ACCOUNT_LINK:
      return recordServerEvent(count.name, count.actor, count.properties);
  }
}

const GITHUB_PROVIDER_ID = SERVER_SIGN_IN_METHOD.GITHUB;

export const authDatabaseHooks = {
  user: {
    create: {
      after: async (user: { readonly id: string }, request: HookRequest | null) => {
        countFromAuth({
          name: SERVER_EVENT.ACCOUNT_SIGN_UP,
          actor: { userId: user.id },
          properties: { method: signInMethodOf(request) },
        });
      },
    },
  },
  account: {
    create: {
      after: async (account: { readonly userId: string; readonly providerId: string }) => {
        if (account.providerId !== GITHUB_PROVIDER_ID) return;
        const signedUpHere = noted
          .getStore()
          ?.some(
            (count) =>
              count.name === SERVER_EVENT.ACCOUNT_SIGN_UP && count.actor.userId === account.userId,
          );
        if (signedUpHere === true) return;
        countFromAuth({
          name: SERVER_EVENT.GITHUB_ACCOUNT_LINK,
          actor: { userId: account.userId },
          properties: {},
        });
      },
    },
  },
} as const;

export const authOrganizationHooks = {
  afterAcceptInvitation: async (accepted: {
    readonly user: { readonly id: string };
    readonly organization: { readonly id: string };
  }) => {
    countFromAuth({
      name: SERVER_EVENT.WORKSPACE_INVITE_ACCEPT,
      actor: { userId: accepted.user.id, workspaceId: accepted.organization.id },
      properties: {},
    });
  },
} as const;
