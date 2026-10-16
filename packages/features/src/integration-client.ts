import { EXCESS_KEYS, HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  type CallAnswer,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationAccountView,
  type IntegrationCallFailure,
  type IntegrationStatusesView,
  type IntegrationStatusView,
  type IntegrationToolsView,
} from "./integration-view.js";
import {
  INTEGRATION_ADD_ACCOUNT,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_QUERY,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationConnectAnswer,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  integrationAccountAnswerSchema,
  integrationAccountSchema,
  integrationConnectAnswerSchema,
  integrationProviderSchema,
  integrationSignInFailureSchema,
  integrationStatusAnswerSchema,
  integrationToolsAnswerSchema,
} from "./integration-wire.js";
import {
  HOSTED_SERVICE_PATH,
  integrationCancelPath,
  integrationConnectPath,
  integrationDisconnectPath,
  integrationRenamePath,
  integrationToolsPath,
} from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema } from "./service-wire.js";

/**
 * integration-client.ts -- the window's side of the account's integrations, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. Each call answers what
 * the service said or why there is no answer, never a failure, because
 * every caller does the same with one: says why, and offers to try again.
 */

export interface HostedIntegrationsClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: IntegrationCallFailure };

const UNANSWERED: Failed = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

/**
 * Where every provider's connection stands, as a desktop reads the answer:
 * every status kept in words, because a service older than the desktop names
 * fewer providers and a newer one may name a status this build does not know,
 * and each sign-in failure kept unread until it is read one at a time.
 */
const integrationStatusesReadSchema = Schema.Struct({
  integrations: Schema.Record(Schema.String, Schema.String),
  accounts: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  addable: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  signInFailures: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

const STATUSES: ReadonlySet<string> = new Set(Object.values(INTEGRATION_STATUS));

/**
 * Every provider's status from an answer read leniently: a provider the
 * service left out, or named in a status this build does not know, stands
 * unavailable, which is what a service that offers no such connection means.
 * One provider's absence never hides the others.
 */
function integrationStatusesFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): Record<IntegrationProvider, IntegrationStatus> {
  const statusOf = (provider: IntegrationProvider): IntegrationStatus => {
    const word = read.integrations[provider];
    // SAFETY: membership in the set built from INTEGRATION_STATUS's values is what the union names.
    return word !== undefined && STATUSES.has(word)
      ? (word as IntegrationStatus)
      : INTEGRATION_STATUS.UNAVAILABLE;
  };
  // SAFETY: the entries are one per provider of INTEGRATION_PROVIDER_LIST, which is every provider.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [provider, statusOf(provider)]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

/** The sign-in failures this build reads, each alone, so one it cannot read hides none of the others. */
function signInFailuresFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationSignInFailure[] {
  return (read.signInFailures ?? []).flatMap((failure) =>
    Option.toArray(Schema.decodeUnknownOption(integrationSignInFailureSchema)(failure)),
  );
}

/** The accounts this build reads, each alone, so one naming a provider or a status this build does not know hides none of the others. */
function accountsFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationAccount[] {
  return (read.accounts ?? []).flatMap((account) =>
    Option.toArray(Schema.decodeUnknownOption(integrationAccountSchema)(account)),
  );
}

/** The providers this build knows among those the read says the account may add another account at. */
function addableFromRead(
  read: typeof integrationStatusesReadSchema.Type,
): readonly IntegrationProvider[] {
  return (read.addable ?? []).flatMap((provider) =>
    Option.toArray(Schema.decodeUnknownOption(integrationProviderSchema)(provider)),
  );
}

/** Where every provider stands, as the window hears it, with its accounts, where it may add one, and the sign-in failures the read found where it found any. */
function integrationStatusesViewOf(
  read: typeof integrationStatusesReadSchema.Type,
): IntegrationStatusesView {
  const accounts = accountsFromRead(read);
  const addable = addableFromRead(read);
  const signInFailures = signInFailuresFromRead(read);
  return {
    integrations: integrationStatusesFromRead(read),
    ...(accounts.length > 0 ? { accounts } : undefined),
    ...(addable.length > 0 ? { addable } : undefined),
    ...(signInFailures.length > 0 ? { signInFailures } : undefined),
  };
}

/** Which account a call is about, and on a Connect whether it signs in a new one: none named is the provider's first. */
export interface IntegrationAccountTarget {
  readonly connection?: string | undefined;
  readonly add?: boolean | undefined;
}

/** A provider's route with the account it is about in its query; the path alone for the provider's first account. */
function accountPath(path: string, target: IntegrationAccountTarget = {}): string {
  const query = new URLSearchParams();
  if (target.connection !== undefined) query.set(INTEGRATION_QUERY.CONNECTION, target.connection);
  if (target.add === true) query.set(INTEGRATION_QUERY.ADD, INTEGRATION_ADD_ACCOUNT);
  const spelled = query.toString();
  return spelled === "" ? path : `${path}?${spelled}`;
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** An answer read whole: the body the schema admits, the service's own unavailable, or unanswered for anything else. */
function readAnswer<Answer, Encoded>(
  answer: CallAnswer,
  schema: Schema.Codec<Answer, Encoded>,
): Effect.Effect<Answer | Failed> {
  if (!callAnswered(answer)) return Effect.succeed(UNANSWERED);
  return Effect.map(jsonOf(answer.response), (body): Answer | Failed => {
    const payload = unparsedWire(body);
    if (!answer.response.ok) {
      const refusal = Result.getOrUndefined(readEither(hostedErrorSchema)(payload));
      return refusal === HOSTED_API_ERROR.UNAVAILABLE
        ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
        : UNANSWERED;
    }
    const read = Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(payload));
    return read === undefined ? UNANSWERED : read;
  });
}

/** The window's reads and changes of the account's integrations. */
export class HostedIntegrationsClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedIntegrationsClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Where every provider's connection stands. */
  statuses(): Effect.Effect<IntegrationStatusesView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS }),
      (answer) =>
        Effect.map(readAnswer(answer, integrationStatusesReadSchema), (read) =>
          "failure" in read ? read : integrationStatusesViewOf(read),
        ),
    );
  }

  /** A browser sign-in to one account at a provider begun, or to a new one: the address the browser opens, which the caller opens and never shows, and the account it signs in. */
  connect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationConnectAnswer | Failed, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: accountPath(integrationConnectPath(provider), target),
      }),
      (answer) => readAnswer(answer, integrationConnectAnswerSchema),
    );
  }

  /** The tools one account's server offers the account's agents. */
  tools(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationToolsView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.GET,
        path: accountPath(integrationToolsPath(provider), target),
      }),
      (answer) => readAnswer(answer, integrationToolsAnswerSchema),
    );
  }

  /** One account's sign-in under way ended, answering where it then stands. */
  cancel(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: accountPath(integrationCancelPath(provider), target),
      }),
      (answer) => readAnswer(answer, integrationStatusAnswerSchema),
    );
  }

  /** One account's connection ended, answering where it then stands. */
  disconnect(
    provider: IntegrationProvider,
    target?: IntegrationAccountTarget,
  ): Effect.Effect<IntegrationStatusView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: accountPath(integrationDisconnectPath(provider), target),
      }),
      (answer) => readAnswer(answer, integrationStatusAnswerSchema),
    );
  }

  /** One account named as the developer calls it, answering the account as it then stands. */
  rename(
    provider: IntegrationProvider,
    connection: string,
    label: string,
  ): Effect.Effect<IntegrationAccountView, never, HttpClient.HttpClient> {
    return Effect.flatMap(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: accountPath(integrationRenamePath(provider), { connection }),
        body: JSON.stringify({ label }),
      }),
      (answer) => readAnswer(answer, integrationAccountAnswerSchema),
    );
  }
}
