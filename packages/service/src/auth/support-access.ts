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

export const SUPPORT_ACCESS_ERROR = {
  IMPERSONATION_REFUSED: "IMPERSONATION_REFUSED",
  BROWSER_ONLY: "BROWSER_SESSION_REQUIRED",
  NOT_GRANTED: "SUPPORT_ACCESS_NOT_GRANTED",
} as const;

const IMPERSONATE_PATH = "/admin/impersonate-user";

const SESSION_MINTING_PATHS: ReadonlySet<string> = new Set([
  "/oauth2/authorize",
  "/oauth2/consent",
  "/oauth2/continue",
  "/electron/transfer-user",
  "/link-social",
]);

const isImpersonation = Schema.is(Schema.Struct({ impersonatedBy: Schema.NonEmptyString }));

const hasGrant = Schema.is(Schema.Struct({ supportAccessUntil: Schema.Date }));

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

interface HookRequest {
  readonly request?: Request | undefined;
  readonly headers?: Headers | undefined;
}

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

async function standingGrant(
  ctx: { readonly context: AuthContext },
  userId: string,
): Promise<number | null> {
  const member = await ctx.context.internalAdapter.findUserById(userId);
  return standingSupportAccess(hasGrant(member) ? member.supportAccessUntil : null, Date.now());
}

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
