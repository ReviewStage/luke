/**
 * account-deletion-services.ts -- the services an account's deletion hooks run on, for a test of the auth route.
 *
 * The auth route hands each request's services to Better Auth's deletion
 * hooks (`accounts/deletion-hooks.ts`), so a test that mounts the
 * route provides them: an environment with no analytics key, so no person is
 * asked to be erased; a Connect that revokes any grant; and no network, so
 * nothing leaves the test.
 */

import { noNetwork } from "@repo/wire/testing";
import { Effect, Layer } from "effect";
import { HostedEnvironment } from "../environment.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "./integration-connect.js";

/** The deletion hooks' services bar the database, which the test's own layer provides. */
export const accountDeletionTestServices = Layer.mergeAll(
  Layer.succeed(HostedEnvironment, {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: undefined,
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    titleAnthropicApiKey: undefined,
    previewApiKeys: {},
  }),
  integrationConnectOf(() => ({ ...CONNECTOR_ASKED_NOTHING, revoke: () => Effect.void })),
  noNetwork,
);
