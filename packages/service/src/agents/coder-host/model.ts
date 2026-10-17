import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  PROVIDER_KEY_UNREADABLE,
  type ProviderKeyUnreadable,
} from "@luke/database/models/provider-key-seal";
import { MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
} from "@luke/features/provider-key-wire";
import {
  APICallError,
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from "ai";
import { Redacted, Result } from "effect";
import type { AgentModelOptionsDefinition } from "eve";
import {
  FAST_PROVIDERS,
  type ProviderModel,
  providerModelOf,
} from "../../providers/model-catalog.js";
import { type MeterSeams, meteredModel } from "../agent-runtime/meter.js";
import { CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import { pictureBudgetMiddleware } from "./picture-budget.js";

/**
 * model.ts -- the model one step of a coding agent runs on, reached at its provider directly on Luke's own key.
 *
 * The agent's row names a catalog id and an effort; the step is told the
 * provider's own model and the provider's own word for the effort, since
 * the two providers spell it differently: Anthropic takes `effort` and
 * OpenAI's Responses API `reasoningEffort`, each under its own provider
 * options. Nothing goes through AI Gateway, so the catalog's efforts for a
 * model are handed to the provider as the catalog lists them. Each step
 * also asks for its reasoning in words, so the agent's tab can show what
 * it thought as the Work tab shows Luke's: OpenAI for a summary, as the
 * brain does, and Anthropic for its summarized thinking on a
 * model that thinks whether asked or not. A fast version runs as its base
 * model asked for Anthropic's fast speed, the SDK sending the beta header
 * that speed needs, on whichever key the step runs on: Anthropic's fast
 * mode is a research preview it grants organization by organization, and
 * the catalog offers it by whether the key's organization was granted it
 * (`../model-catalog.ts`). A fast call Anthropic refuses with a 429,
 * whether its organization was never granted fast mode or is past its fast
 * rate, runs again at standard speed, as Anthropic's docs and Claude Code
 * fall back, and the step's turn is marked so, which its card says; on the
 * account's own key, what the fast call showed of its organization is
 * written on the key's row, which the catalog then offers by. The agent's
 * title is one small call beside the steps, on a fixed cheap model at the
 * same provider door, always on Luke's own Anthropic key. A key is
 * revealed here alone, into the SDK client that puts it on its requests.
 *
 * A step runs on the account's own key for its provider where the account
 * saved one, and on Luke's only where it saved none: an account's key that
 * cannot be read refuses the step rather than run it on Luke's, so nothing
 * the account meant to pay for is quietly billed to Luke. A step on the
 * account's key reports how the provider answered it, so its row reads
 * invalid when the provider refuses the key, quota exceeded when it refuses
 * the work for the key's billing, and verified again once a step goes
 * through; a refusal of either kind fails the step in words that name the
 * account's key, which the agent's failure is read from.
 *
 * Every step's pictures are held to the provider's bounds before it is sent
 * (`picture-budget.ts`), whichever key it runs on.
 */

/** The one model an agent's title is generated on: the cheapest that names a task well, at Anthropic's own id. */
const AGENT_TITLE_MODEL_ID = "claude-haiku-5-5";

/** How much of its reasoning an OpenAI step is asked to summarise: `auto` lets the model choose how much to say. */
const OPENAI_REASONING_SUMMARY = "auto";

/** The adaptive thinking a Claude step that already thinks is asked to show: summarized words rather than empty blocks. */
const ANTHROPIC_SHOWN_THINKING = { type: "adaptive", display: "summarized" } as const;

/**
 * The Claude models that think when the request names no thinking: the
 * Claude 5 family. Note that only these are asked to show their thinking,
 * because the ask is adaptive thinking itself: for these it changes what
 * the step returns and not what it costs, while an older Claude would
 * start thinking where it did not, which is a step's cost and latency and
 * no one decided that. The next family that thinks by default joins here.
 */
const THINKS_BY_DEFAULT = /^claude-[a-z]+-5(?:-|$)/u;

/** Anthropic's words, in a 429's body, for an organization fast mode was never enabled for: a fast limit of 0. */
const ANTHROPIC_FAST_LIMIT_ZERO = /rate limit of 0 fast mode/iu;

/** Anthropic's word for a step on a model's fast mode. */
const ANTHROPIC_FAST_SPEED = "fast";

/** OpenAI's word, in a 429's body, for an account out of credit rather than over its rate. */
const OPENAI_NO_QUOTA = "insufficient_quota";

/** Anthropic's words, in a refusal's body, for an account out of credit. */
const ANTHROPIC_NO_CREDIT = /credit balance/iu;

/** The Anthropic provider option a fast step asks its speed by; a call without it runs at standard speed, and the SDK sends fast mode's beta only beside it. */
const ANTHROPIC_SPEED_OPTION = "speed";

const PROVIDER_REFUSAL_STATUS = {
  UNAUTHORIZED: 401,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
} as const;

/** What a model call is asked with, as a middleware is handed it. */
type ModelCallOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapGenerate"]>
>[0]["params"];

/** Luke's own keys, sealed; one absent is that provider's agents refused at their first step where the account holds none of its own. */
export interface LukeKeys {
  readonly anthropic: Redacted.Redacted | undefined;
  readonly openAi: Redacted.Redacted | undefined;
}

/** The account's own key as a step finds it: what its row says now, and where a change is reported. */
interface AccountKeyStanding {
  readonly status: ProviderKeyStatus;
  /** Writes the status the provider's answer showed; a write that fails is the row's loss, never the step's. */
  readonly report: (status: ProviderKeyStatus) => Promise<void>;
  /** Whether the key's organization may run fast mode, as its row says now; nothing where no fast request has answered. */
  readonly fastAccess?: FastAccess;
  /** Writes what a fast call showed of the key's organization, on the same terms as `report`. */
  readonly reportFast?: (access: FastAccess) => Promise<void>;
}

/** The key one provider's steps run on, and, where it is the account's own, its standing. */
export interface ProviderKey {
  readonly key: Redacted.Redacted;
  readonly account?: AccountKeyStanding;
  /** The account's meter, which Luke's own key carries and the account's never does (`../agent-runtime/meter.ts`). */
  readonly meter?: MeterSeams;
}

/**
 * The key each provider's steps run on for one account: its own, Luke's,
 * its own that cannot be read, or none. `fetch` is the provider's HTTP door,
 * the platform's own where absent.
 */
export interface ProviderKeys {
  readonly anthropic: ProviderKey | ProviderKeyUnreadable | undefined;
  readonly openAi: ProviderKey | ProviderKeyUnreadable | undefined;
  readonly fetch?: typeof globalThis.fetch;
}

/** What a step is told: the provider's model, the window eve compacts against, and the effort in the provider's own words. */
export interface CoderModelSelection {
  readonly model: LanguageModel;
  readonly modelContextWindowTokens: number;
  readonly modelOptions: AgentModelOptionsDefinition;
}

/** A selection reached at a provider's door, whose model is the SDK's own object and so can be wrapped further, as the brain's meter wraps it. */
export interface ProviderModelSelection extends CoderModelSelection {
  readonly model: Exclude<LanguageModel, string>;
}

/** The provider's own options for a step: the effort, the fast speed where the choice is a fast version, and the ask for its reasoning in words where that costs nothing more. */
function stepOptions(named: ProviderModel, effort: string): AgentModelOptionsDefinition {
  switch (named.provider) {
    case MODEL_PROVIDER.ANTHROPIC:
      return {
        providerOptions: {
          anthropic: {
            effort,
            ...(THINKS_BY_DEFAULT.test(named.modelId)
              ? { thinking: ANTHROPIC_SHOWN_THINKING }
              : undefined),
            ...(named.fast ? { [ANTHROPIC_SPEED_OPTION]: ANTHROPIC_FAST_SPEED } : undefined),
          },
        },
      };
    case MODEL_PROVIDER.OPENAI:
      return {
        providerOptions: {
          openai: { reasoningEffort: effort, reasoningSummary: OPENAI_REASONING_SUMMARY },
        },
      };
  }
}

/** What a provider's refusal says of the account's key: refused, out of credit, or nothing of the key at all. */
function accountKeyStatusOf(failure: APICallError): ProviderKeyStatus | undefined {
  if (failure.statusCode === undefined) return undefined;
  if (failure.statusCode === PROVIDER_REFUSAL_STATUS.UNAUTHORIZED)
    return PROVIDER_KEY_STATUS.INVALID;
  const body = failure.responseBody ?? "";
  if (
    failure.statusCode === PROVIDER_REFUSAL_STATUS.TOO_MANY_REQUESTS &&
    body.includes(OPENAI_NO_QUOTA)
  ) {
    return PROVIDER_KEY_STATUS.QUOTA_EXCEEDED;
  }
  if (failure.statusCode < PROVIDER_REFUSAL_STATUS.SERVER_ERROR && ANTHROPIC_NO_CREDIT.test(body)) {
    return PROVIDER_KEY_STATUS.QUOTA_EXCEEDED;
  }
  return undefined;
}

/**
 * The account's key's standing kept as each call settles: a call that goes
 * through reads verified, a refusal of the key or its billing reads as that
 * and fails the step in words naming the account's key, and any other
 * failure is left as it was. Note that a report is awaited but never
 * thrown, because the row's status is the account's view of its key and no
 * reason to fail a step.
 */
function accountKeyMiddleware(standing: AccountKeyStanding): LanguageModelMiddleware {
  const settle = async (status: ProviderKeyStatus) => {
    if (status === standing.status) return;
    await standing.report(status).catch(() => undefined);
  };
  const settled = async <A>(call: () => PromiseLike<A>): Promise<A> => {
    let answer: A;
    try {
      answer = await call();
    } catch (failure) {
      if (!APICallError.isInstance(failure)) throw failure;
      const status = accountKeyStatusOf(failure);
      if (status === undefined) throw failure;
      await settle(status);
      throw new Error(
        status === PROVIDER_KEY_STATUS.INVALID
          ? CODER_REFUSAL.ACCOUNT_KEY_REFUSED
          : CODER_REFUSAL.ACCOUNT_KEY_NO_QUOTA,
      );
    }
    await settle(PROVIDER_KEY_STATUS.VERIFIED);
    return answer;
  };
  return {
    wrapGenerate: ({ doGenerate }) => settled(doGenerate),
    wrapStream: ({ doStream }) => settled(doStream),
  };
}

/** The call's options with Anthropic's speed left out, which is the same call at standard speed. */
function atStandardSpeed(params: ModelCallOptions): ModelCallOptions {
  const anthropic = params.providerOptions?.[MODEL_PROVIDER.ANTHROPIC];
  if (anthropic === undefined) return params;
  const { [ANTHROPIC_SPEED_OPTION]: _fast, ...standard } = anthropic;
  return { ...params, providerOptions: { ...params.providerOptions, anthropic: standard } };
}

/**
 * A fast step's call, run once more at standard speed where Anthropic
 * refuses it with a 429, and the refusal reported once the standard call
 * answers. Note that the standard call is made at once rather than left to
 * the SDK's retries, because a fast limit of 0 answers every retry the same,
 * and that the call is made again under this middleware rather than around
 * it, so the meter in front counts the step once. A standard call that fails
 * fails the step as any call would. The prompt cache is keyed by speed, so
 * the standard call reads none of what the fast calls before it cached.
 * What the fast call showed of the key's organization is handed to
 * `onFastAccess`: granted where it ran, never granted where Anthropic
 * refused it against a fast limit of 0, and nothing for a fast rate spent.
 */
function fastFallbackMiddleware(
  onFastRefused: () => Promise<void>,
  onFastAccess: (access: FastAccess) => Promise<void>,
): LanguageModelMiddleware {
  // A mark or a row's write is no reason to fail a step that answered.
  const settle = (written: Promise<void>) => written.catch(() => undefined);
  const settled = async <A>(
    fast: () => PromiseLike<A>,
    standard: () => PromiseLike<A>,
  ): Promise<A> => {
    try {
      const answer = await fast();
      await settle(onFastAccess(FAST_ACCESS.ENABLED));
      return answer;
    } catch (failure) {
      const refused =
        APICallError.isInstance(failure) &&
        failure.statusCode === PROVIDER_REFUSAL_STATUS.TOO_MANY_REQUESTS;
      if (!refused) throw failure;
      if (ANTHROPIC_FAST_LIMIT_ZERO.test(failure.responseBody ?? "")) {
        await settle(onFastAccess(FAST_ACCESS.NOT_ENABLED));
      }
    }
    const answer = await standard();
    await settle(onFastRefused());
    return answer;
  };
  return {
    wrapGenerate: ({ doGenerate, model, params }) =>
      settled(doGenerate, () => model.doGenerate(atStandardSpeed(params))),
    wrapStream: ({ doStream, model, params }) =>
      settled(doStream, () => model.doStream(atStandardSpeed(params))),
  };
}

/** Where what a fast call showed is written: the account's own key's row where it changes what the row says; nowhere on Luke's key, which the catalog asks of itself. */
function fastAccessReport(
  standing: AccountKeyStanding | undefined,
): (access: FastAccess) => Promise<void> {
  return async (access) => {
    if (standing?.reportFast === undefined || access === standing.fastAccess) return;
    await standing.reportFast(access);
  };
}

/**
 * The provider's model on the key: its pictures held to the budget,
 * falling back from a refused fast call where the step is a fast version,
 * behind the account's middleware where the key is the account's own, and
 * the meter where it is Luke's.
 */
function modelOnKey(
  named: ProviderModel,
  key: ProviderKey,
  fetch: typeof globalThis.fetch | undefined,
  onFastRefused: () => Promise<void>,
): Exclude<LanguageModel, string> {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  const settings = {
    apiKey: Redacted.value(key.key),
    ...(fetch === undefined ? undefined : { fetch }),
  };
  const reached =
    named.provider === MODEL_PROVIDER.ANTHROPIC
      ? createAnthropic(settings)(named.modelId)
      : createOpenAI(settings).responses(named.modelId);
  const provided = wrapLanguageModel({ model: reached, middleware: pictureBudgetMiddleware });
  const model = named.fast
    ? wrapLanguageModel({
        model: provided,
        middleware: fastFallbackMiddleware(onFastRefused, fastAccessReport(key.account)),
      })
    : provided;
  if (key.account === undefined) {
    return key.meter === undefined ? model : meteredModel(model, key.meter);
  }
  return wrapLanguageModel({ model, middleware: accountKeyMiddleware(key.account) });
}

/** The model an agent's title is generated on, on Luke's key behind the account's meter, or nothing where the deployment holds no Anthropic key, which leaves agents untitled. */
export function titleModel(
  keys: LukeKeys,
  meter: MeterSeams,
  fetch?: typeof globalThis.fetch,
): LanguageModel | undefined {
  if (keys.anthropic === undefined) return undefined;
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  const settings = {
    apiKey: Redacted.value(keys.anthropic),
    ...(fetch === undefined ? undefined : { fetch }),
  };
  return meteredModel(createAnthropic(settings)(AGENT_TITLE_MODEL_ID), meter);
}

/**
 * The choice as a step runs it, or why it cannot: a provider Luke does not
 * run, a fast version Luke cannot ask its provider for, an account's key
 * that cannot be read, or no key at all. `onFastRefused` marks the step's turn where a fast call of it ran at
 * standard speed instead.
 */
export function coderModel(
  choice: ModelChoice,
  keys: ProviderKeys,
  contextWindowTokens: number,
  onFastRefused: () => Promise<void>,
): Result.Result<ProviderModelSelection, CoderRefusal> {
  const named = providerModelOf(choice.model);
  if (named === undefined) return Result.fail(CODER_REFUSAL.UNKNOWN_PROVIDER);
  if (named.fast && !FAST_PROVIDERS.has(named.provider))
    return Result.fail(CODER_REFUSAL.NO_FAST_VERSION);
  const key = named.provider === MODEL_PROVIDER.ANTHROPIC ? keys.anthropic : keys.openAi;
  if (key === undefined) return Result.fail(CODER_REFUSAL.NO_PROVIDER_KEY);
  if (key === PROVIDER_KEY_UNREADABLE) return Result.fail(CODER_REFUSAL.ACCOUNT_KEY_UNREADABLE);
  return Result.succeed({
    model: modelOnKey(named, key, keys.fetch, onFastRefused),
    modelContextWindowTokens: contextWindowTokens,
    modelOptions: stepOptions(named, choice.effort),
  });
}
