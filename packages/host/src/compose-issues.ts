import type { HostedIssueClient } from "@luke/features";
import {
  ISSUE_CALL_FAILURE,
  type IssueListView,
  type IssueView,
  issueChangeParamsSchema,
  issueCreateParamsSchema,
  issueIdParamsSchema,
  issueListParamsSchema,
} from "@luke/features/issue-view";
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
 * compose-issues.ts -- a workspace's issues, asked of the service on the window's behalf: listed, read, filed, and changed.
 *
 * Nothing is held here. The window holds the issues it draws and asks when
 * its page opens and after each write, and every ask is one call of the
 * service answered whole. Behind a closed account gate, or on a run that
 * sends nothing, every ask answers unanswered.
 */

/** The service's side of the issues, as this concern asks it. */
export type IssuesClient = Pick<HostedIssueClient, "list" | "read" | "create" | "change">;

export interface IssuesDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: IssuesClient;
}

export type IssuesComposer = Composer;

const UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

export function composeIssues(
  dependencies: IssuesDependencies,
): Effect.Effect<IssuesComposer, never, Scope.Scope> {
  return Effect.sync(() => composed(dependencies));
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: IssuesDependencies): IssuesComposer {
  const { kernel, account, client } = dependencies;
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
    [GATEWAY_METHOD.ISSUES_LIST]: (params) =>
      Effect.gen(function* () {
        const list = yield* read(issueListParamsSchema, params, "a list names a workspace");
        return carried<IssueListView>(yield* asked(client.list(list)));
      }),
    [GATEWAY_METHOD.ISSUES_READ]: (params) =>
      Effect.gen(function* () {
        const named = yield* read(issueIdParamsSchema, params, "a read names an issue");
        return carried<IssueView>(yield* asked(client.read(named)));
      }),
    [GATEWAY_METHOD.ISSUES_CREATE]: (params) =>
      Effect.gen(function* () {
        const made = yield* read(
          issueCreateParamsSchema,
          params,
          "an issue names its workspace and a title",
        );
        return carried<IssueView>(yield* asked(client.create(made)));
      }),
    [GATEWAY_METHOD.ISSUES_CHANGE]: (params) =>
      Effect.gen(function* () {
        const change = yield* read(
          issueChangeParamsSchema,
          params,
          "a change names an issue and what changes",
        );
        return carried<IssueView>(yield* asked(client.change(change)));
      }),
  };

  return { methods, lifetime: Effect.void };
}
