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
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, FiberMap, Result, type Schema, type Scope } from "effect";
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
 * the account that was signed in is subscribed to no more; the gate opening
 * again follows every workspace main still follows, under the account now
 * signed in, so an Issues page left open is live again without a remount.
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
  /** The account signed in now, which a follow names on every seal and renewal; none while signed out. */
  accountId: () => string | undefined;
  /** Realtime's client for the follows' subscriptions; Realtime's own where none is handed in. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
}

export interface IssuesComposer extends Composer {
  /** Every issue follow let go, as a sign-out or an account switch lets them go. */
  readonly reset: Effect.Effect<void>;
  /** Every workspace main still follows followed again, as a sign-in opens the gate, under the account now signed in. */
  readonly resume: Effect.Effect<void>;
}

const UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

/** How long a write's answer waits for its transaction to arrive on the followed list. */
const TXID_TIMEOUT = Duration.seconds(10);

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
  /** Each followed workspace's wait for a transaction on its subscription, once it is subscribed. */
  const awaiting = new Map<string, (txid: string, timeoutMillis: number) => Promise<void>>();

  /**
   * A write's answer, held until the followed list has applied the
   * transaction that made it, so the window draws it once the push already
   * holds it (Neon's "Optimistic mutations"). A write that changed nothing
   * carries no transaction and is answered at once, as is one of a workspace
   * no window follows; a wait past `TXID_TIMEOUT` lets the answer go anyway.
   */
  const applied = (answer: IssueView): Effect.Effect<IssueView> => {
    if (!("issue" in answer) || answer.txid === undefined) return Effect.succeed(answer);
    const { txid } = answer;
    const wait = awaiting.get(answer.issue.workspaceId);
    if (wait === undefined) return Effect.succeed(answer);
    return Effect.as(
      Effect.ignore(Effect.tryPromise(() => wait(txid, Duration.toMillis(TXID_TIMEOUT)))),
      answer,
    );
  };

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

  /** The workspaces main follows, kept across a sign-out so a sign-in follows them again. */
  const wanted = new Set<string>();

  /**
   * A workspace's issues followed behind the gate, under the account signed
   * in now, unless a follow of it already stands. Note that the account is
   * read once, as the follow starts, so every renewal names the account it
   * began for.
   */
  const started = (workspaceId: string): Effect.Effect<void> => {
    if (!gate()) return Effect.void;
    const userId = dependencies.accountId();
    const follow = followIssues({
      live: () =>
        userId === undefined
          ? Effect.succeed(LIVE_SIGNED_OUT)
          : asked(client.listLive(workspaceId, userId)),
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: kernel.now,
      publish: (view) => kernel.emit(GATEWAY_EVENT.ISSUES_CHANGED, carried({ workspaceId, view })),
      onSubscribed: (wait) => awaiting.set(workspaceId, wait),
    });
    return Effect.asVoid(FiberMap.run(follows, workspaceId, follow, { onlyIfMissing: true }));
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
        return carried<IssueView>(yield* applied(yield* asked(client.create(made))));
      }),
    [GATEWAY_METHOD.ISSUES_CHANGE]: (params) =>
      Effect.gen(function* () {
        const change = yield* read(
          issueChangeParamsSchema,
          params,
          "a change names an issue and what changes",
        );
        return carried<IssueView>(yield* applied(yield* asked(client.change(change))));
      }),
    [GATEWAY_METHOD.ISSUES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          issueFollowSchema,
          params,
          "a follow names a workspace",
        );
        wanted.add(workspaceId);
        yield* started(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.ISSUES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* read(
          issueFollowSchema,
          params,
          "a follow names a workspace",
        );
        wanted.delete(workspaceId);
        awaiting.delete(workspaceId);
        yield* FiberMap.remove(follows, workspaceId);
        return {};
      }),
  };

  const reset = Effect.andThen(
    Effect.sync(() => awaiting.clear()),
    FiberMap.clear(follows),
  );
  const resume = Effect.suspend(() => Effect.forEach([...wanted], started, { discard: true }));
  return { methods, lifetime: Effect.void, reset, resume };
}
