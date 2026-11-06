import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { workspaceSeams } from "@repo/database/models/workspace-seams";
import { member } from "@repo/database/schemas/auth";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { openMigratedPglite, sqlClientOverPglite } from "@repo/database/testing";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Clock, ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { WELCOME_MAIL_ENVIRONMENT, welcomeMailFromEnvironment } from "../accounts/welcome-mail.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { authApp } from "./auth-app.js";
import { authDatabaseHooks } from "./auth-counts.js";
import { authDatabaseAdapter } from "./auth-database.js";
import { DISABLED_AUTH_PATHS, ORGANIZATION_OPTIONS } from "./auth-policy.js";

/**
 * A new account, signed up through the auth route over Better Auth's own
 * hooks and organization plugin as `auth.ts` configures them, on a migrated
 * PGlite: it comes away owning its personal workspace, with nothing else
 * asked of the service, and is sent one welcome email, which signing in again
 * does not repeat. Email and password sign-up stands in for the Google
 * or GitHub sign-in, whose provider this test cannot be. Synthetic account
 * throughout.
 */

const BASE_URL = "http://127.0.0.1";

const WELCOME_FROM = "Charles <charles@app.test>";

const ADA = { name: "Ada Lovelace", email: "ada@example.com", password: "a-password-long-enough" };

/** When the test signs up, a day past the epoch, so the email's hour is counted from it. */
const SIGNED_UP_AT = Date.parse("1970-01-02T00:00:00.000Z");

const decodeSignedUp = Schema.decodeUnknownSync(
  Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
);

it.effect(
  "a new account signed up through the auth route owns its personal workspace and is welcomed once",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(SIGNED_UP_AT);
      const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
        Effect.promise(() => opened.close()),
      );
      const auth = betterAuth({
        database: authDatabaseAdapter(drizzle({ client })),
        baseURL: BASE_URL,
        secret: "auth-sign-up-test-secret-of-enough-length",
        emailAndPassword: { enabled: true },
        databaseHooks: authDatabaseHooks,
        disabledPaths: [...DISABLED_AUTH_PATHS],
        plugins: [organization(ORGANIZATION_OPTIONS)],
      });
      yield* Effect.gen(function* () {
        const resend = recordingHttpClient(() => jsonResponse({ id: "email-1" }));
        const welcomeMail = welcomeMailFromEnvironment.pipe(
          Layer.provide(
            Layer.merge(
              resend.layer,
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({
                  [WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY]: "re_test",
                  [WELCOME_MAIL_ENVIRONMENT.FROM]: WELCOME_FROM,
                }),
              ),
            ),
          ),
        );
        const services = Layer.mergeAll(
          Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
          Layer.succeed(Database, yield* Database),
          Layer.succeed(Clock.Clock, yield* Clock.Clock),
          welcomeMail,
        );
        const { handler, dispose } = HttpRouter.toWebHandler(
          authApp((request) => auth.handler(request), workspaceSeams(auth.api)).pipe(
            HttpRouter.provideRequest(services),
          ),
          { disableLogger: true },
        );
        const post = (path: string, body: object) =>
          Effect.promise(() =>
            handler(
              new Request(`${BASE_URL}/api/auth/${path}`, {
                method: "POST",
                headers: { origin: BASE_URL, "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
            ),
          );
        const answered = yield* post("sign-up/email", ADA);
        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        const userId = decodeSignedUp(yield* Effect.promise(() => answered.json())).user.id;
        const signedIn = yield* post("sign-in/email", { email: ADA.email, password: ADA.password });
        assert.equal(signedIn.status, HOSTED_HTTP_STATUS.OK);
        yield* Effect.promise(() => dispose());

        const emails = resend.requests.map(
          (request) =>
            JSON.parse(request.body ?? "{}") as {
              from: string;
              to: string[];
              scheduled_at: string;
              template: { id: string; variables: { GREETING: string } };
            },
        );
        assert.equal(emails.length, 1);
        assert.equal(emails[0]?.from, WELCOME_FROM);
        assert.deepEqual(emails[0]?.to, [ADA.email]);
        assert.deepEqual(emails[0]?.template, {
          id: "founder-welcome",
          variables: { GREETING: "Hey Ada," },
        });
        assert.equal(emails[0]?.scheduled_at, "1970-01-02T01:00:00.000Z");

        const [personal, ...others] = yield* Database.use((db) =>
          db
            .select({ organizationId: personalWorkspace.organizationId })
            .from(personalWorkspace)
            .where(eq(personalWorkspace.userId, userId)),
        );
        assert.ok(personal);
        assert.equal(others.length, 0);
        assert.deepEqual(
          yield* Database.use((db) =>
            db
              .select({ organizationId: member.organizationId, role: member.role })
              .from(member)
              .where(eq(member.userId, userId)),
          ),
          [{ organizationId: personal.organizationId, role: WORKSPACE_ROLE.OWNER }],
        );
      }).pipe(Effect.provide(sqlClientOverPglite(client)));
    }),
);
