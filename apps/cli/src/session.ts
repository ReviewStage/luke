/**
 * session.ts -- who and where a `vespin` command calls: the service origin, the account client and store for it, the bearer a call carries, and the hosted contract's client over it.
 *
 * The service is `--url`, then `VESPIN_URL`, then production's origin, as
 * the desktop's is. The bearer is `VESPIN_TOKEN` where it is set, read
 * first and never written, else the account the store keeps for that
 * origin, renewed through `account-call.ts`'s one retry on a 401
 * (`@repo/credentials/cli`). A command asks a procedure with `askService`,
 * which ends a failure with the exit code it stands for and words that never
 * carry a token.
 */

import { AccountClient } from "@repo/credentials";
import { type CliAccountStore, storedAccountCredential } from "@repo/credentials/cli";
import { type CallCredential, fixedBearer, HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT, cliExitOfHostedFailure } from "@repo/features/cli-exit";
import {
  askHosted,
  type HostedClient,
  type HostedFailure,
  type HostedProcedure,
  hostedClient,
} from "@repo/features/hosted-link";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option } from "effect";
import { URL_FLAG } from "./flags.js";
import { CommandFailed } from "./output.js";
import { accountStore } from "./token-store.js";

/** The environment variables a command reads. */
const ENVIRONMENT = {
  URL: "VESPIN_URL",
  TOKEN: "VESPIN_TOKEN",
} as const;

/** The account service's routes, under the service origin, as the desktop's `accountBaseUrlFor` puts them. */
const ACCOUNT_PATH = "/api/auth";

/** What to run when a call has no sign-in, or one the service no longer takes. */
export const SIGN_IN_HINT = "Run vespin login to sign in.";

function environmentValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

/** The service origin this run calls: `--url`, then `VESPIN_URL`, then production; anything after the origin is dropped. */
export const serviceOrigin = Effect.gen(function* () {
  const flag = yield* URL_FLAG;
  const named = Option.getOrUndefined(flag) ?? environmentValue(ENVIRONMENT.URL) ?? LINK_ORIGIN;
  if (!URL.canParse(named)) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: `${named} is not a service address, such as ${LINK_ORIGIN}.`,
    });
  }
  return new URL(named).origin;
});

/** The account service's base address for a service origin. */
export function accountBaseUrl(origin: string): string {
  return `${origin}${ACCOUNT_PATH}`;
}

/** The token client the command signs in, renews, and signs out with, under its own client id. */
export function accountClient(origin: string): AccountClient {
  return new AccountClient({
    baseUrl: accountBaseUrl(origin),
    clientId: FIRST_PARTY_OAUTH_CLIENT_ID.CLI,
  });
}

/** The store this machine keeps the origin's account in. */
export function storeFor(origin: string) {
  return accountStore(origin, { platform: process.platform, environment: process.env });
}

/** Where a call's bearer comes from. */
export const CREDENTIAL_SOURCE = {
  ENVIRONMENT: "environment",
  STORE: "store",
} as const;

type CredentialSource = (typeof CREDENTIAL_SOURCE)[keyof typeof CREDENTIAL_SOURCE];

/**
 * The bearer a call carries: a token the environment names, which is
 * never renewed or stored, over the account the store keeps.
 */
function credentialFor(input: {
  readonly environmentToken: string | undefined;
  readonly store: CliAccountStore;
  readonly client: AccountClient;
}): { readonly credential: CallCredential; readonly source: CredentialSource } {
  return input.environmentToken === undefined
    ? {
        credential: storedAccountCredential(input.store, input.client),
        source: CREDENTIAL_SOURCE.STORE,
      }
    : { credential: fixedBearer(input.environmentToken), source: CREDENTIAL_SOURCE.ENVIRONMENT };
}

/** Everything a command needs to call the service as the signed-in member. */
export const session = Effect.gen(function* () {
  const origin = yield* serviceOrigin;
  const client = accountClient(origin);
  const store = yield* storeFor(origin);
  const { credential, source } = credentialFor({
    environmentToken: environmentValue(ENVIRONMENT.TOKEN),
    store,
    client,
  });
  const hosted: HostedClient = hostedClient({ baseUrl: origin, credential });
  return { origin, client, store, credential, source, hosted };
});

/** A hosted failure in words: never the token, and never more of the service's answer than its slug and status. */
function failureWords(failed: HostedFailure): string {
  const exit = cliExitOfHostedFailure(failed);
  if (exit === CLI_EXIT.AUTH) return `Not signed in, or the sign-in lapsed. ${SIGN_IN_HINT}`;
  if (failed._tag === "HostedRefused") {
    return failed.refusal === HOSTED_API_ERROR.UNAVAILABLE
      ? `${PRODUCT_NAME} is unavailable right now.`
      : `${PRODUCT_NAME} refused: ${failed.refusal}.`;
  }
  if (failed.status !== undefined) return `${PRODUCT_NAME} failed (${failed.status}).`;
  return `Could not reach ${PRODUCT_NAME}.`;
}

/** One hosted procedure asked, its failure ended as the exit code and words it stands for. */
export function askService<Input, Output>(procedure: HostedProcedure<Input, Output>, input: Input) {
  return Effect.mapError(
    askHosted(procedure, input),
    (failed) =>
      new CommandFailed({ exit: cliExitOfHostedFailure(failed), message: failureWords(failed) }),
  );
}
