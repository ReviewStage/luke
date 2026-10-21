import { chatGptSignIn, LOOPBACK_CONSENT_CANCELLED, type OpenConsent } from "@luke/credentials";
import type { HostedCodingAgentClient } from "@luke/features";
import {
  type ChatGptSignInAnswerView,
  CODING_AGENT_CALL_FAILURE,
} from "@luke/features/coding-agent-view";
import {
  type ChatGptCredentialsSaveRequest,
  PROVIDER_KEY_REJECTION,
  type ProviderKeyRejection,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { carried, GATEWAY_METHOD } from "@luke/gateway";
import { Effect, Layer, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";

/**
 * compose-chatgpt-sign-in.ts -- Sign in with ChatGPT for Luke's hosted runtime, run on this Mac and handed to the service.
 *
 * A press in Settings asks the service for the account's host id, runs
 * OpenAI's open-source sign-in through the developer's browser and a
 * loopback on this Mac (`@luke/credentials`' `chatGptSignIn`), and posts what
 * it validated to the service, which keeps and renews it from then on. The
 * window hears the keys as the service then holds them, or why nothing was
 * kept: the tokens go from the exchange to the service and are held nowhere
 * here, so no answer, event, or log line carries one. Only a host on the
 * machine the browser runs on can take the loopback's callback, so a host
 * that is handed no consent leaves this concern out.
 */

/** The service's side of the sign-in, as this concern asks it. */
type ChatGptSignInClient = Pick<HostedCodingAgentClient, "chatGptHost" | "saveChatGptCredentials">;

export interface ChatGptSignInDependencies {
  kernel: Pick<HostKernel, "openExternalThroughNode"> & {
    runMode: { sendsNetwork: boolean };
  };
  account: Pick<AccountComposer, "capabilitiesActive" | "token">;
  client: ChatGptSignInClient;
  /** The loopback consent the desktop stands up. */
  openConsent: OpenConsent;
}

export interface ChatGptSignInComposer extends Composer {
  /** The gate closing: a sign-in still waiting on the browser is withdrawn. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Why the service kept nothing, in a sentence for the row. */
const REJECTION_WORDS = {
  [PROVIDER_KEY_REJECTION.INVALID]: "OpenAI didn't grant Luke use of your ChatGPT plan. Try again.",
  [PROVIDER_KEY_REJECTION.WRONG_PROVIDER]: "Luke couldn't save the ChatGPT sign-in. Try again.",
  [PROVIDER_KEY_REJECTION.UNREACHABLE]: "Luke couldn't save the ChatGPT sign-in. Try again.",
  [PROVIDER_KEY_REJECTION.TOO_MANY_TRIES]: "Too many sign-ins in the last hour. Try again later.",
  [PROVIDER_KEY_REJECTION.UNVERIFIED_SIGN_IN]:
    "Luke couldn't verify the ChatGPT sign-in. Try again.",
} as const satisfies Record<ProviderKeyRejection, string>;

const SAVE_FAILED = "Luke couldn't save the ChatGPT sign-in. Try again.";

const ACCOUNT_CHANGED =
  "You signed in to Luke as someone else while ChatGPT was open, so nothing was saved. Try again.";

export function composeChatGptSignIn(
  dependencies: ChatGptSignInDependencies,
): Effect.Effect<ChatGptSignInComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return composed(dependencies, Layer.succeed(HttpClient.HttpClient, http));
  });
}

/** The composer's table, built from its seams; nothing here starts anything. */
function composed(
  dependencies: ChatGptSignInDependencies,
  http: Layer.Layer<HttpClient.HttpClient>,
): ChatGptSignInComposer {
  const { kernel, account, client, openConsent } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  const signIn = chatGptSignIn<ProviderKeysAnswer>({
    openConsent,
    openExternal: (url) => kernel.openExternalThroughNode(url),
    http,
  });
  const readAccountKey = (): Effect.Effect<string | undefined> =>
    account.token.readAccountKey?.() ?? Effect.succeed(undefined);
  // Every Cancel and every sign-out, so a press still asking the service for its host opens no browser.
  let cancels = 0;

  /**
   * The save for the account that pressed: the bearer is read afresh for the
   * call, so an account that changed while the browser was open is refused
   * here rather than handed another account's ChatGPT sign-in.
   */
  const saveFor = (pressedBy: string) => (credentials: ChatGptCredentialsSaveRequest) =>
    Effect.gen(function* () {
      if ((yield* readAccountKey()) !== pressedBy) return { reason: ACCOUNT_CHANGED };
      // Note that the browser's landing card waits on this answer, so a sign-in
      // the service refused is a refusal there too rather than "Connected".
      const answer = yield* Effect.provide(client.saveChatGptCredentials(credentials), http);
      if ("failure" in answer) return { reason: SAVE_FAILED };
      if (answer.rejected !== undefined) return { reason: REJECTION_WORDS[answer.rejected] };
      return answer;
    });

  const run: Effect.Effect<ChatGptSignInAnswerView> = Effect.gen(function* () {
    const asked = cancels;
    const pressedBy = yield* readAccountKey();
    if (pressedBy === undefined) return UNANSWERED;
    const host = yield* Effect.provide(client.chatGptHost(), http);
    // A Cancel pressed while the host was asked wins over whatever the service answered.
    if (cancels !== asked) return { cancelled: true } as const;
    if ("failure" in host) return host;
    const outcome = yield* signIn.signIn({
      extAgentHostId: host.extAgentHostId,
      save: saveFor(pressedBy),
    });
    if (!("reason" in outcome)) return outcome;
    return outcome.reason === LOOPBACK_CONSENT_CANCELLED
      ? ({ cancelled: true } as const)
      : { refused: outcome.reason };
  });

  const withdraw = () => {
    cancels += 1;
    signIn.cancel();
  };

  const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.CHATGPT_SIGN_IN> = {
    [GATEWAY_METHOD.CHATGPT_SIGN_IN]: () =>
      Effect.map(gate() ? run : Effect.succeed<ChatGptSignInAnswerView>(UNANSWERED), (answer) =>
        carried<ChatGptSignInAnswerView>(answer),
      ),
    [GATEWAY_METHOD.CHATGPT_SIGN_IN_CANCEL]: () =>
      Effect.sync(() => {
        withdraw();
        return {};
      }),
  };
  return {
    methods,
    lifetime: Effect.void,
    reset: Effect.sync(withdraw),
  };
}
