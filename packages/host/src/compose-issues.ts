import type { HostedIssueClient } from "@luke/features";
import {
  ISSUE_CALL_FAILURE,
  type IssueListView,
  type IssueView,
  issueChangeParamsSchema,
  issueCreateParamsSchema,
  issueFollowSchema,
  issueIdParamsSchema,
  issueListParamsSchema,
} from "@luke/features/issue-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, FiberMap, Result, type Schema, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { followIssues } from "./issue-follow.js";
import { type LiveClient, openRealtimeClient } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-issues.ts -- a workspace's issues, asked of the service on the window's behalf: listed, read, filed, and changed.
 *
 * Nothing is held here but the follows. The window holds the issues it
 * draws and asks when its page opens, and every ask is one call of the
 * service answered whole. The list it draws it follows while drawn
 * (`issue-follow.ts`): over Neon Realtime, each change emitted as
 * `ISSUES_CHANGED`; following what is already followed does nothing, and
 * letting it go ends it. Behind a closed account gate, or on a run that
 * sends nothing, every ask answers unanswered and nothing is followed, and
 * the gate closing, a sign-out or an account switch, ends every follow, so
 * the account that was signed in is subscribed to no more.
 */

/** The service's side of the issues, as this concern asks it. */
export type IssuesClient = Pick<
  HostedIssueClient,
  "list" | "read" | "create" | "change" | "listLive"
>;

export interface IssuesDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: IssuesClient;
  /** Realtime's client for the follows' subscriptions; Realtime's own where none is handed in. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
}

export interface IssuesComposer extends Composer {
  /** Every issue follow let go, as a sign-out or an account switch lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

export function composeIssues(
  dependencies: IssuesDependencies,
): Effect.Effect<IssuesComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    return composed(dependencies, http, yield* FiberMap.make<string>());
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window follows. */
function composed(
  dependencies: IssuesDependencies,
  http: HttpClient.HttpClient,
  follows: FiberMap.FiberMap<string>,
): IssuesComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

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
    [GATEWAY_METHOD.ISSUES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          issueFollowSchema,
          params,
          "a follow names a workspace",
        );
        if (!gate()) return {};
        const follow = followIssues({
          live: () => asked(client.listLive(workspaceId)),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
          publish: (view) =>
            kernel.emit(GATEWAY_EVENT.ISSUES_CHANGED, carried({ workspaceId, view })),
        });
        yield* FiberMap.run(follows, workspaceId, follow, { onlyIfMissing: true });
        return {};
      }),
    [GATEWAY_METHOD.ISSUES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          issueFollowSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.remove(follows, workspaceId);
        return {};
      }),
  };

  return { methods, lifetime: Effect.void, reset: FiberMap.clear(follows) };
}
