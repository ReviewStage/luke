import { createHash, randomBytes } from "node:crypto";
import type { HostedAutomationClient } from "@luke/features";
import {
  AUTOMATION_CALL_FAILURE,
  type AutomationDeletedView,
  type AutomationListView,
  type AutomationRunsView,
  type AutomationRunView,
  type AutomationSecretCopiedView,
  type AutomationView,
  automationChangeParamsSchema,
  automationCreateParamsSchema,
  automationIdParamsSchema,
  automationListParamsSchema,
  automationRunParamsSchema,
} from "@luke/features/automation-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, invalid } from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result, type Schema, type Scope } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-automations.ts -- the account's automations, asked of the service on the window's behalf: listed, made, changed, deleted, run now, and their runs read.
 *
 * Nothing is held here. The window holds the automations it draws and asks
 * when its page opens and after each write, and every ask is one call of
 * the service answered whole. Behind a closed account gate, or on a run
 * that sends nothing, every ask answers unanswered. A webhook's secret is
 * the one thing here that goes no further: minted at the window's ask, it
 * is put on the clipboard and only then sent to the service as its
 * SHA-256, and the window hears only that it was copied, since a secret
 * never enters a Gateway answer.
 */

/** The service's side of the automations, as this concern asks it. */
export type AutomationsClient = Pick<
  HostedAutomationClient,
  "list" | "create" | "change" | "remove" | "runNow" | "runs" | "replaceWebhookSecret"
>;

export interface AutomationsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: AutomationsClient;
  /** Puts text on the system clipboard, answering whether it landed. */
  copyText: (text: string) => Effect.Effect<boolean>;
}

export type AutomationsComposer = Composer;

const UNANSWERED = { failure: AUTOMATION_CALL_FAILURE.UNANSWERED } as const;

/** The bytes of randomness in a webhook secret the host mints, as many as the service's own. */
const WEBHOOK_SECRET_BYTES = 32;

export function composeAutomations(
  dependencies: AutomationsDependencies,
): Effect.Effect<AutomationsComposer, never, Scope.Scope> {
  return Effect.sync(() => composed(dependencies));
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: AutomationsDependencies): AutomationsComposer {
  const { kernel, account, client, copyText } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the ambient fetch client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provide(call, FetchHttpClient.layer) : Effect.succeed(UNANSWERED);

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.AUTOMATIONS_LIST]: (params) =>
      Effect.gen(function* () {
        const list = yield* read(
          automationListParamsSchema,
          params,
          "a list names a plan, a workspace, or neither",
        );
        return carried<AutomationListView>(yield* asked(client.list(list)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CREATE]: (params) =>
      Effect.gen(function* () {
        const made = yield* read(
          automationCreateParamsSchema,
          params,
          "an automation names where it stands, a name, a trigger, and an action",
        );
        return carried<AutomationView>(yield* asked(client.create(made)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_CHANGE]: (params) =>
      Effect.gen(function* () {
        const change = yield* read(
          automationChangeParamsSchema,
          params,
          "a change names an automation and what changes",
        );
        return carried<AutomationView>(yield* asked(client.change(change)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_DELETE]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(automationIdParamsSchema, params, "a delete names an automation");
        return carried<AutomationDeletedView>(yield* asked(client.remove(named)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUN]: (params) =>
      Effect.gen(function* () {
        const run = yield* read(
          automationRunParamsSchema,
          params,
          "a run names an automation and a key",
        );
        return carried<AutomationRunView>(yield* asked(client.runNow(run)));
      }),
    [GATEWAY_METHOD.AUTOMATIONS_COPY_WEBHOOK_SECRET]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(automationIdParamsSchema, params, "a copy names an automation");
        if (!gate()) return carried<AutomationSecretCopiedView>(UNANSWERED);
        // Note that the secret is on the clipboard before its hash is sent, because a copy that
        // fails then replaces nothing, and the secret before goes on admitting calls.
        const secret = randomBytes(WEBHOOK_SECRET_BYTES).toString("base64url");
        if (!(yield* copyText(secret))) return carried<AutomationSecretCopiedView>(UNANSWERED);
        const replaced = yield* asked(
          client.replaceWebhookSecret({
            automationId: named.automationId,
            webhookSecretHash: createHash("sha256").update(secret).digest("hex"),
          }),
        );
        if ("failure" in replaced) {
          // The secret was not taken, so the clipboard is cleared rather than left holding one that admits nothing.
          yield* copyText("");
          return carried<AutomationSecretCopiedView>(replaced);
        }
        return carried<AutomationSecretCopiedView>({
          automation: replaced.automation,
          secretCopied: true,
        });
      }),
    [GATEWAY_METHOD.AUTOMATIONS_RUNS]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(automationIdParamsSchema, params, "a read names an automation");
        return carried<AutomationRunsView>(yield* asked(client.runs(named)));
      }),
  };

  return { methods, lifetime: Effect.void };
}
