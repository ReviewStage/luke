import { AccountClient } from "@repo/credentials";
import { type CliAccountStore, storedAccountCredential } from "@repo/credentials/cli";
import { type CallCredential, fixedBearer, HOSTED_API_ERROR } from "@repo/features";
import { CLI_EXIT, cliExitOfHostedFailure } from "@repo/features/cli-exit";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedDeadline,
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

const ENVIRONMENT = {
  URL: "VESPIN_URL",
  TOKEN: "VESPIN_TOKEN",
} as const;

const ACCOUNT_PATH = "/api/auth";

const OPAQUE_ORIGIN = "null";

export const SIGN_IN_HINT = "Run vespin login to sign in.";

function environmentValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

export const serviceOrigin = Effect.gen(function* () {
  const flag = yield* URL_FLAG;
  const named = Option.getOrUndefined(flag) ?? environmentValue(ENVIRONMENT.URL) ?? LINK_ORIGIN;
  const origin = URL.canParse(named) ? new URL(named).origin : OPAQUE_ORIGIN;
  if (origin === OPAQUE_ORIGIN) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: `${named} is not a service address, such as ${LINK_ORIGIN}.`,
    });
  }
  return origin;
});

export function accountBaseUrl(origin: string): string {
  return `${origin}${ACCOUNT_PATH}`;
}

export function accountClient(origin: string): AccountClient {
  return new AccountClient({
    baseUrl: accountBaseUrl(origin),
    clientId: FIRST_PARTY_OAUTH_CLIENT_ID.CLI,
  });
}

export function storeFor(origin: string) {
  return accountStore(origin, { platform: process.platform, environment: process.env });
}

export const CREDENTIAL_SOURCE = {
  ENVIRONMENT: "environment",
  STORE: "store",
} as const;

type CredentialSource = (typeof CREDENTIAL_SOURCE)[keyof typeof CREDENTIAL_SOURCE];

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

function failureWords(failed: HostedFailure): string {
  const exit = cliExitOfHostedFailure(failed);
  if (exit === CLI_EXIT.AUTH) return `Not signed in, or the sign-in lapsed. ${SIGN_IN_HINT}`;
  if (failed._tag === "HostedRefused") {
    if (failed.refusal === HOSTED_API_ERROR.UNAVAILABLE) {
      return `${PRODUCT_NAME} is unavailable right now.`;
    }
    if (failed.refusal === HOSTED_API_ERROR.HOST_UPGRADE_NEEDED) {
      return `This vespin is older than ${PRODUCT_NAME}: update it with vespin update, then run the command again.`;
    }
    return `${PRODUCT_NAME} refused: ${failed.refusal}.`;
  }
  if (failed.status !== undefined) return `${PRODUCT_NAME} failed (${failed.status}).`;
  return `Could not reach ${PRODUCT_NAME}.`;
}

export function askService<Input, Output>(
  procedure: HostedProcedure<Input, Output>,
  input: Input,
  deadline: HostedDeadline = HOSTED_DEADLINE.USUAL,
) {
  return Effect.mapError(
    askHosted(procedure, input, deadline),
    (failed) =>
      new CommandFailed({ exit: cliExitOfHostedFailure(failed), message: failureWords(failed) }),
  );
}
