/**
 * support-access.ts -- the member's consent to a maintainer signing in as them, and the doors that sign-in never passes, as a Better Auth plugin.
 *
 * A maintainer signs in as an account through the admin plugin's
 * `/admin/impersonate-user` (`auth-policy.ts`'s `ADMIN_OPTIONS`), and only
 * while the account's member has granted support access: the grant is a
 * date on the user, `supportAccessUntil`, which the member sets seven days
 * out and clears again through this plugin's two endpoints, and which no
 * other endpoint can write (`input: false`). Revoking also ends every
 * impersonation of the account under way, through the internal adapter, so
 * Better Auth's own session delete hooks run as for any sign-out.
 *
 * An impersonation is a session whose `impersonatedBy` names the
 * maintainer, an hour long or until the member's grant runs out, whichever
 * is sooner. Note that the grant is read again once the session is made, so
 * a revoke that cleared it between the check and the session's making, and
 * so listed no session to end, still ends this one. It is held to the web, the one place it is
 * started from: it is refused at every door of Better Auth's own that would
 * turn the session into something that outlasts it, an OAuth authorization
 * (the desktop's client skips consent, and an `offline_access` refresh token
 * outlives the session it was minted under), the Electron hand-off to a Mac
 * session of its own, and a link of a social account to the member.
 *
 * Note that those doors, and the start itself, also refuse any request that
 * carries `Authorization`, because a session the bearer plugin reads off a
 * bearer is not yet a cookie when a before hook runs, so `getSessionFromCtx`
 * here would read past it. Nothing of ours reaches these doors with a
 * bearer: they are a browser's, reached on its cookie.
 */

import type { AuthContext, BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  sessionMiddleware,
} from "better-auth/api";
import { Schema } from "effect";
import {
  SUPPORT_ACCESS_GRANT_SECONDS,
  SUPPORT_ACCESS_PATH,
  standingSupportAccess,
} from "./auth-policy.js";

/** The codes this plugin refuses with, on the refusal's body. */
export const SUPPORT_ACCESS_ERROR = {
  IMPERSONATION_REFUSED: "IMPERSONATION_REFUSED",
  BROWSER_ONLY: "BROWSER_SESSION_REQUIRED",
  NOT_GRANTED: "SUPPORT_ACCESS_NOT_GRANTED",
} as const;

/** The admin plugin's door an impersonation is started at. */
const IMPERSONATE_PATH = "/admin/impersonate-user";

/**
 * Better Auth's own doors that turn the session they read into a credential
 * or a link that outlasts it: the OAuth provider's authorization, consent,
 * and continuation (each answers an authorization code), the Electron
 * plugin's hand-off (a code the Mac trades for a session of its own), and
 * linking a social account.
 */
const SESSION_MINTING_PATHS: ReadonlySet<string> = new Set([
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/continue",
  "/electron/transfer-user",
  "/link-social",
]);

/** A session row the admin plugin started for a maintainer, read leniently: only its mark is wanted. */
const isImpersonation = Schema.is(Schema.Struct({ impersonatedBy: Schema.NonEmptyString }));

/** A user row whose grant of support access has a date, read leniently: only the date is wanted. */
const hasGrant = Schema.is(Schema.Struct({ supportAccessUntil: Schema.Date }));

/** What `/admin/impersonate-user` answers once it made the session, read leniently: only the session is wanted. */
const isStartedImpersonation = Schema.is(
  Schema.Struct({
    session: Schema.Struct({
      token: Schema.String,
      userId: Schema.String,
      expiresAt: Schema.Date,
      impersonatedBy: Schema.NonEmptyString,
    }),
  }),
);

/** The request a hook sees, in the fields read here. */
interface HookRequest {
  readonly request?: Request | undefined;
  readonly headers?: Headers | undefined;
}

/** Whether the request carries `Authorization`, on the request itself or on the headers an `auth.api` call was handed, as the bearer plugin reads it. */
function carriesAuthorization(context: HookRequest): boolean {
  return Boolean(
    context.request?.headers.get("authorization") || context.headers?.get("authorization"),
  );
}

function refuse(code: string, message: string): APIError {
  return new APIError("FORBIDDEN", { code, message });
}

function notGranted(): APIError {
  return refuse(
    SUPPORT_ACCESS_ERROR.NOT_GRANTED,
    "The account's member has not granted support access.",
  );
}

/** When the member's grant of support access ends, read from the store, while it stands; null where none does. */
async function standingGrant(
  ctx: { readonly context: AuthContext },
  userId: string,
): Promise<number | null> {
  const member = await ctx.context.internalAdapter.findUserById(userId);
  return standingSupportAccess(hasGrant(member) ? member.supportAccessUntil : null, Date.now());
}

/** Refuses a bearer, and an impersonation session, at a door that mints from the session. */
const refuseAtMintingDoor = createAuthMiddleware(async (ctx) => {
  if (carriesAuthorization(ctx)) {
    throw refuse(SUPPORT_ACCESS_ERROR.BROWSER_ONLY, "Only a browser's own session may do this.");
  }
  const session = await getSessionFromCtx(ctx);
  if (isImpersonation(session?.session)) {
    throw refuse(
      SUPPORT_ACCESS_ERROR.IMPERSONATION_REFUSED,
      "A support sign-in cannot do this for the account.",
    );
  }
});

/**
 * Refuses an impersonation started from anything but a browser's cookie
 * session, or of an account whose member has not granted support access or
 * whose grant has run out. A caller with no session is left to the admin
 * plugin's own refusal. Note that the grant is checked for every other
 * caller, not for an admin alone, because the role a session's cookie cache
 * answers may be a minute stale where the admin plugin reads it afresh.
 */
const refuseUnconsentedImpersonation = createAuthMiddleware(async (ctx) => {
  if (carriesAuthorization(ctx)) {
    throw refuse(
      SUPPORT_ACCESS_ERROR.BROWSER_ONLY,
      "A support sign-in starts only from a browser's own session.",
    );
  }
  if ((await getSessionFromCtx(ctx)) === null) return;
  const userId: unknown = ctx.body?.userId;
  if (typeof userId !== "string" || (await standingGrant(ctx, userId)) === null) {
    throw notGranted();
  }
});

/**
 * Holds a support sign-in the admin plugin just made to the member's grant
 * as it now stands: ended where a revoke cleared the grant meanwhile, and
 * otherwise made to end when the grant does, where that is within its hour.
 * Note that a browser's cookie cache may read the hour for its minute.
 */
const holdToGrant = createAuthMiddleware(async (ctx) => {
  const started = ctx.context.returned;
  if (!isStartedImpersonation(started)) return;
  const { token, userId, expiresAt } = started.session;
  const until = await standingGrant(ctx, userId);
  if (until === null) {
    await ctx.context.internalAdapter.deleteSession(token);
    throw notGranted();
  }
  if (until >= expiresAt.getTime()) return;
  const capped = new Date(until);
  await ctx.context.internalAdapter.updateSession(token, { expiresAt: capped });
  return ctx.json({ ...started, session: { ...started.session, expiresAt: capped } });
});

/**
 * Better Auth's plugin for support access: the grant on the user, the
 * member's grant and revoke, the refusals above as its before hooks, and the
 * hold of a support sign-in to the grant as its after hook.
 */
export const supportAccess = () =>
  ({
    id: "support-access",
    schema: {
      user: {
        fields: {
          supportAccessUntil: { type: "date", required: false, input: false },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (context) => SESSION_MINTING_PATHS.has(context.path ?? ""),
          handler: refuseAtMintingDoor,
        },
        {
          matcher: (context) => context.path === IMPERSONATE_PATH,
          handler: refuseUnconsentedImpersonation,
        },
      ],
      after: [
        {
          matcher: (context) => context.path === IMPERSONATE_PATH,
          handler: holdToGrant,
        },
      ],
    },
    endpoints: {
      /**
       * The member grants support access for seven days from now, answering
       * when it runs out. A support sign-in is refused, so a maintainer
       * cannot extend their own access.
       */
      grantSupportAccess: createAuthEndpoint(
        SUPPORT_ACCESS_PATH.GRANT,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const { session } = ctx.context.session;
          if (isImpersonation(session)) {
            throw refuse(
              SUPPORT_ACCESS_ERROR.IMPERSONATION_REFUSED,
              "A support sign-in cannot grant support access.",
            );
          }
          const supportAccessUntil = new Date(Date.now() + SUPPORT_ACCESS_GRANT_SECONDS * 1000);
          await ctx.context.internalAdapter.updateUser(session.userId, { supportAccessUntil });
          return ctx.json({ supportAccessUntil });
        },
      ),
      /**
       * The member revokes support access, and every support sign-in to the
       * account ends with it: a session still answered from a browser's
       * cookie cache stands until that cache runs out.
       */
      revokeSupportAccess: createAuthEndpoint(
        SUPPORT_ACCESS_PATH.REVOKE,
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const { userId } = ctx.context.session.session;
          await ctx.context.internalAdapter.updateUser(userId, { supportAccessUntil: null });
          const sessions = await ctx.context.internalAdapter.listSessions(userId);
          const impersonations = sessions.flatMap((row) =>
            isImpersonation(row) ? [row.token] : [],
          );
          if (impersonations.length > 0) {
            await ctx.context.internalAdapter.deleteSessions(impersonations);
          }
          return ctx.json({ supportAccessUntil: null });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
