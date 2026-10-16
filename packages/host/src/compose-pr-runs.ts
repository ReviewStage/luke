import { ACCOUNT_STATUS } from "@luke/credentials";
import { PR_FETCH_REFUSAL, type PrFetchOutcome, type PrFetchRefusal } from "@luke/features";
import type { PrFetchRequest } from "@luke/features/pr-fetch-wire";
import {
  PR_RUN_BOUNDS,
  PR_RUN_FLOW,
  PR_RUN_PHASE,
  type PrRunCommandsAnswer,
  type PrRunOutcome,
  type PrRunPullRequest,
  type PrRunState,
  prRunAckParamsSchema,
  prRunConnectionParamsSchema,
  prRunPullRequestSchema,
  prRunSetCommandParamsSchema,
  prRunStartParamsSchema,
} from "@luke/features/pr-run-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Config,
  type Context,
  Effect,
  Exit,
  FiberMap,
  Latch,
  type Redacted,
  Result,
  type Schema,
  type Scope,
  Semaphore,
} from "effect";
import { Base64 } from "effect/encoding";
import type * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment } from "./effect/seams.js";
import type { HostKernel } from "./host-kernel.js";
import {
  type CheckoutPlace,
  type CheckoutStep,
  checkoutPlace,
  type FetchInto,
  fetchPullRequestHead,
  type GitTool,
  locateCheckout,
  refreshCheckout,
  removeCheckout,
} from "./pr-run-checkout.js";
import { type CredentialHelperRuntime, servedCredential } from "./pr-run-credential.js";
import { type RunShell, runPullRequestCommand } from "./pr-run-process.js";
import type { RunMode } from "./run-mode.js";
import type { SettingsStore } from "./settings-store.js";

/**
 * compose-pr-runs.ts -- a pull request run on this Mac: fetched into Luke's own checkout of it, its repository's run command run from that checkout's root, and what it prints handed to the one panel that asked.
 *
 * A repository's run command is set in Settings and kept for the account
 * signed in, by workspace and repository (`SettingsStore`); a run never takes
 * one from the pull request, and a repository with none set is refused with
 * where to set it. A run is asked by a panel under a connection main minted
 * for it, whose port is already standing, so nothing the run prints is
 * printed before something can draw it. Each run asks the service once for
 * the pull request's head and a contents-read token for its repository
 * (`HostedPrFetchClient`), fetches `refs/pull/<number>/head` from GitHub with
 * that token served to Git through a private socket (`pr-run-credential.ts`),
 * and holds what it fetched to the head the service read, asking again a
 * bounded number of times where the pull request moved in between; the
 * token's socket is closed and the token revoked before the checkout is
 * touched, so nothing the pull request holds ever runs while it stands. The
 * checkout is refreshed as `pr-run-checkout.ts` allows and the command run
 * from its root (`pr-run-process.ts`).
 *
 * The runs of one pull request are serialized: a second Run while one is
 * still preparing joins it, under the newer panel's connection, and a Run
 * while one runs or after one ended stops the old one, its process group
 * ended, before the checkout is touched again. Runs of different pull
 * requests stand side by side. Stop ends the run and keeps the checkout; a
 * panel letting its connection go (a closed tab, a page gone) is a Stop. A
 * sign-out stops every run (`reset`), and quitting closes the scope every
 * run's fiber lives in, which ends every process group. What a run prints is
 * handed up as `PR_RUN_OUTPUT` events named by the connection and let go:
 * never kept, logged, counted, or answered. It is paced to what the tab has
 * drawn: past `PAUSE_ABOVE_BYTES` unacked the command's output is no longer
 * read, so it backs up into the command rather than into this process.
 */

/** How many times a run asks for the pull request's head when what it fetched was not the head it was told. */
const MAX_HEAD_ATTEMPTS = 3;

/** The shell a run command runs in where the environment names none: macOS's own default. */
const DEFAULT_RUN_SHELL = "/bin/zsh";

/** The variables of the app's environment a run's Git keeps: where programs are, the home folder, the temporary folder, and the network's proxies. */
const GIT_KEPT_VARIABLES = [
  "PATH",
  "HOME",
  "TMPDIR",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
] as const;

/** The Git and the shell a run uses, from the environment the host was handed. */
export const prRunTools = Effect.gen(function* () {
  const environment = yield* Environment;
  const kept: Record<string, string> = {};
  for (const name of GIT_KEPT_VARIABLES) {
    const value = yield* Effect.orDie(Config.option(Config.String(name)).parse(environment));
    if (value._tag === "Some") kept[name] = value.value;
  }
  const shell = yield* Effect.orDie(
    Config.withDefault(Config.String("SHELL"), DEFAULT_RUN_SHELL).parse(environment),
  );
  const git: GitTool = { path: "git", environment: kept };
  const runShell: RunShell = { path: shell };
  return { git, shell: runShell };
});

/** The service's side of a run, as this concern asks it. */
interface PrFetchClient {
  fetch(request: PrFetchRequest): Effect.Effect<PrFetchOutcome, never, HttpClient.HttpClient>;
}

export interface PrRunsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive" | "snapshot">;
  store: Pick<SettingsStore, "prRunCommandsOf" | "setPrRunCommand">;
  client: PrFetchClient;
  /** The token given up once its fetch is done; best effort, never failing. */
  revoke: (token: Redacted.Redacted<string>) => Effect.Effect<void>;
  /** Where a repository is fetched from: GitHub's HTTPS address for it. */
  sourceUrl: (repository: string) => string;
  git: GitTool;
  shell: RunShell;
  helper: CredentialHelperRuntime;
}

export interface PrRunsComposer extends Composer {
  /** Every run stopped, as a sign-out stops them; each checkout stays. */
  readonly reset: Effect.Effect<void>;
}

/** The panel drawing a pull request's runs, and how far behind it has fallen. */
interface Viewer {
  readonly connectionId: string;
  unacked: number;
  /** Open while the viewer keeps up; closed while the run waits for it to draw. */
  readonly caughtUp: Latch.Latch;
}

/** One pull request's runs: who draws them, the run standing, and the lock that serializes them. */
interface Slot {
  readonly pullRequest: PrRunPullRequest;
  viewer: Viewer | undefined;
  /** The run standing, by the key its fiber is held under; none before the first and after a stop. */
  runId: string | undefined;
  phase: PrRunState["phase"] | undefined;
  /** Where the last run stood when it was last said, which a panel attaching again is told first. */
  state: PrRunState | undefined;
  readonly lock: Semaphore.Semaphore;
}

/** The pull request's words, as a refusal names it. */
function named(pullRequest: PrRunPullRequest): string {
  return `${pullRequest.repository}#${pullRequest.number}`;
}

/** Why the service handed no head, in the developer's words. */
function fetchRefusal(refusal: PrFetchRefusal, pullRequest: PrRunPullRequest): string {
  switch (refusal) {
    case PR_FETCH_REFUSAL.NOT_FOUND:
      return `Luke could not find ${named(pullRequest)} in this workspace.`;
    case PR_FETCH_REFUSAL.NOT_REACHABLE:
      return `This workspace's GitHub connection does not reach ${pullRequest.repository}.`;
    default:
      return "Luke could not reach GitHub to fetch the pull request. Run it again in a moment.";
  }
}

/** A message held to the bound the wire carries. */
function bounded(message: string): string {
  return message.slice(0, PR_RUN_BOUNDS.MAX_MESSAGE_CHARS);
}

export function composePrRuns(
  dependencies: PrRunsDependencies,
): Effect.Effect<
  PrRunsComposer,
  never,
  Scope.Scope | ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>();
    const services = yield* Effect.context<
      ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
    >();
    return composed(dependencies, fibers, services);
  });
}

/** The composer's table and its runs, built over its seams and the map every run's fiber is held in. */
function composed(
  dependencies: PrRunsDependencies,
  fibers: FiberMap.FiberMap<string>,
  services: Context.Context<ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem>,
): PrRunsComposer {
  const { kernel, account, store, client, revoke, sourceUrl, git, shell, helper } = dependencies;
  /** Every pull request's slot, by workspace, then repository lowercased, then number. */
  const slots = new Map<string, Map<string, Map<number, Slot>>>();
  /** The slot each standing connection views. */
  const byConnection = new Map<string, Slot>();
  let runsStarted = 0;

  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
  const accountEmail = () => {
    const snapshot = account.snapshot();
    return snapshot.status === ACCOUNT_STATUS.SIGNED_IN ? snapshot.email : undefined;
  };

  /** The pull request's slot, made the first time it is named. */
  const slotOf = (pullRequest: PrRunPullRequest): Slot => {
    const repositories = slots.get(pullRequest.workspaceId) ?? new Map<string, Map<number, Slot>>();
    slots.set(pullRequest.workspaceId, repositories);
    const repositoryKey = pullRequest.repository.toLowerCase();
    const numbers = repositories.get(repositoryKey) ?? new Map<number, Slot>();
    repositories.set(repositoryKey, numbers);
    const held = numbers.get(pullRequest.number);
    if (held !== undefined) return held;
    const fresh: Slot = {
      pullRequest,
      viewer: undefined,
      runId: undefined,
      phase: undefined,
      state: undefined,
      lock: Semaphore.makeUnsafe(1),
    };
    numbers.set(pullRequest.number, fresh);
    return fresh;
  };

  /** Where the slot's run stands, said to whoever draws it. */
  const tell = (slot: Slot, state: PrRunState) =>
    Effect.sync(() => {
      slot.phase = state.phase;
      slot.state = state;
      const viewer = slot.viewer;
      if (viewer === undefined) return;
      kernel.emit(
        GATEWAY_EVENT.PR_RUN_STATE,
        carried({
          connectionId: viewer.connectionId,
          ...state,
          ...(state.message === undefined ? undefined : { message: bounded(state.message) }),
        }),
      );
    });

  /** What the run printed handed up, and the run held once its viewer has fallen far enough behind. */
  const write = (slot: Slot, runId: string) => (bytes: Uint8Array) =>
    Effect.gen(function* () {
      const viewer = slot.viewer;
      // Note that output nobody draws is let go, because a run whose tab is gone has already been stopped.
      if (viewer === undefined || slot.runId !== runId) return;
      kernel.emit(
        GATEWAY_EVENT.PR_RUN_OUTPUT,
        carried({ connectionId: viewer.connectionId, data: Base64.encode(bytes) }),
      );
      viewer.unacked += bytes.length;
      if (viewer.unacked <= PR_RUN_FLOW.PAUSE_ABOVE_BYTES) return;
      yield* viewer.caughtUp.close;
      yield* viewer.caughtUp.await;
    });

  /** The pull request's head fetched into a repository folder on a token the service minted for it, asked again where the head moved meanwhile. */
  const fetchInto =
    (pullRequest: PrRunPullRequest, owner: string): FetchInto =>
    (repositoryFolder) =>
      Effect.gen(function* () {
        for (let attempt = 0; attempt < MAX_HEAD_ATTEMPTS; attempt += 1) {
          const grant = yield* Effect.provide(
            client.fetch({
              workspaceId: pullRequest.workspaceId,
              repository: pullRequest.repository,
              prNumber: pullRequest.number,
            }),
            FetchHttpClient.layer,
          );
          if ("refused" in grant) return { refused: fetchRefusal(grant.refused, pullRequest) };
          // Note that a grant that arrived after the account changed is given up unused, because it is the earlier account's.
          if (accountEmail() !== owner) {
            yield* revoke(grant.token);
            return { refused: "The account signed in changed while the pull request was fetched." };
          }
          const fetched: CheckoutStep<string> = yield* Effect.scoped(
            Effect.gen(function* () {
              const configArgs = yield* servedCredential(
                helper,
                pullRequest.repository,
                grant.token,
              );
              return yield* fetchPullRequestHead(git, repositoryFolder, {
                url: sourceUrl(pullRequest.repository),
                ref: `refs/pull/${pullRequest.number}/head`,
                configArgs,
              });
            }),
          ).pipe(
            Effect.catch(() =>
              Effect.succeed({ refused: "Luke could not hand Git the pull request's token." }),
            ),
            Effect.ensuring(revoke(grant.token)),
          );
          if ("refused" in fetched || fetched.ok === grant.headSha) return fetched;
        }
        return {
          refused: `${named(pullRequest)} kept moving while Luke fetched it. Run it again in a moment.`,
        };
      }).pipe(Effect.provideContext(services));

  /** One run's whole life: the checkout refreshed, the command run, and how it ended said. */
  const run = (slot: Slot, runId: string, command: string, owner: string, place: CheckoutPlace) =>
    Effect.gen(function* () {
      yield* tell(slot, {
        phase: PR_RUN_PHASE.PREPARING,
        message: "Fetching the pull request's newest commit…",
      });
      const prepared = yield* refreshCheckout(git, place, fetchInto(slot.pullRequest, owner));
      if ("refused" in prepared) {
        return yield* tell(slot, { phase: PR_RUN_PHASE.FAILURE, message: prepared.refused });
      }
      if (accountEmail() !== owner) {
        return yield* tell(slot, { phase: PR_RUN_PHASE.STOPPED });
      }
      yield* tell(slot, { phase: PR_RUN_PHASE.RUNNING, sha: prepared.ok });
      const ended = yield* Effect.exit(
        runPullRequestCommand(shell, place.folder, command, write(slot, runId)),
      );
      if (Exit.isFailure(ended)) {
        return yield* tell(slot, {
          phase: PR_RUN_PHASE.FAILURE,
          sha: prepared.ok,
          message: "Luke could not start the run command.",
        });
      }
      const exitCode = ended.value;
      yield* tell(slot, {
        phase: exitCode === 0 ? PR_RUN_PHASE.SUCCESS : PR_RUN_PHASE.FAILURE,
        sha: prepared.ok,
        ...(exitCode === null ? undefined : { exitCode }),
      });
    }).pipe(
      Effect.onInterrupt(() => tell(slot, { phase: PR_RUN_PHASE.STOPPED })),
      Effect.ensuring(
        Effect.sync(() => {
          if (slot.runId === runId) slot.runId = undefined;
        }),
      ),
      Effect.provideContext(services),
    );

  /** The slot's run stopped, its process group ended, before the caller goes on. */
  const stopped = (slot: Slot) =>
    Effect.suspend(() =>
      slot.runId === undefined ? Effect.void : FiberMap.remove(fibers, slot.runId),
    );

  /** The connection made the slot's viewer, caught up, in place of whoever viewed it before. */
  const view = (slot: Slot, connectionId: string) =>
    Effect.gen(function* () {
      const earlier = slot.viewer;
      if (earlier !== undefined) {
        byConnection.delete(earlier.connectionId);
        yield* earlier.caughtUp.open;
      }
      slot.viewer = { connectionId, unacked: 0, caughtUp: yield* Latch.make(true) };
      byConnection.set(connectionId, slot);
    });

  /** The run command set for the pull request's repository under the account, or none. */
  const commandFor = (owner: string, pullRequest: PrRunPullRequest) =>
    Effect.map(
      Effect.orElseSucceed(
        store.prRunCommandsOf(owner),
        (): Readonly<Record<string, Readonly<Record<string, string>>>> => ({}),
      ),
      (byWorkspace) => {
        const repositories = Object.hasOwn(byWorkspace, pullRequest.workspaceId)
          ? byWorkspace[pullRequest.workspaceId]
          : undefined;
        const key = pullRequest.repository.toLowerCase();
        return repositories !== undefined && Object.hasOwn(repositories, key)
          ? repositories[key]
          : undefined;
      },
    );

  /** A run started for the connection, or joined where one is still preparing; refused in words where it cannot start. */
  const start = (connectionId: string, pullRequest: PrRunPullRequest) =>
    Effect.gen(function* () {
      const owner = accountEmail();
      if (!gate() || owner === undefined) {
        return { refused: "Sign in to run a pull request on this Mac." } satisfies PrRunOutcome;
      }
      const command = yield* commandFor(owner, pullRequest);
      if (command === undefined) {
        return {
          refused: `Set a run command for ${pullRequest.repository} in Settings, under Workspace › Repositories, then run it again.`,
        } satisfies PrRunOutcome;
      }
      const place = checkoutPlace(kernel.stateRoot, { ...pullRequest, accountEmail: owner });
      if (place === undefined) {
        return {
          refused: "Luke cannot keep a checkout for this pull request.",
        } satisfies PrRunOutcome;
      }
      const slot = slotOf(pullRequest);
      return yield* slot.lock.withPermits(1)(
        Effect.gen(function* () {
          yield* view(slot, connectionId);
          if (slot.runId !== undefined && slot.phase === PR_RUN_PHASE.PREPARING) {
            yield* tell(slot, {
              phase: PR_RUN_PHASE.PREPARING,
              message: "Fetching the pull request's newest commit…",
            });
            return { done: true } satisfies PrRunOutcome;
          }
          yield* stopped(slot);
          runsStarted += 1;
          const runId = `run-${runsStarted}`;
          slot.runId = runId;
          slot.phase = PR_RUN_PHASE.PREPARING;
          yield* FiberMap.run(fibers, runId, run(slot, runId, command, owner, place));
          return { done: true } satisfies PrRunOutcome;
        }),
      );
    });

  /** The params read against the method's own schema, or the invalid-params refusal worded. */
  const read = <Params>(
    schema: Schema.Codec<Params, unknown>,
    params: Parameters<GatewayMethodTable[keyof GatewayMethodTable] & object>[0],
    sentence: string,
  ) => {
    const result = readEither(schema)(unparsedWire(params));
    return Result.isFailure(result) ? invalid(sentence) : Effect.succeed(result.success);
  };

  /** The place of a pull request's checkout under the account signed in, or nothing. */
  const placeOf = (pullRequest: PrRunPullRequest) => {
    const owner = accountEmail();
    return owner === undefined
      ? undefined
      : checkoutPlace(kernel.stateRoot, { ...pullRequest, accountEmail: owner });
  };

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.PR_RUNS_COMMANDS]: () =>
      Effect.gen(function* () {
        const owner = accountEmail();
        const commands: PrRunCommandsAnswer["commands"][number][] = [];
        if (owner === undefined) return carried({ commands });
        const byWorkspace = yield* Effect.orElseSucceed(store.prRunCommandsOf(owner), () => ({}));
        for (const [workspaceId, repositories] of Object.entries(byWorkspace)) {
          for (const [repository, command] of Object.entries(repositories)) {
            commands.push({ workspaceId, repository, command });
          }
        }
        return carried({ commands } satisfies PrRunCommandsAnswer);
      }),
    [GATEWAY_METHOD.PR_RUNS_SET_COMMAND]: (params) =>
      Effect.gen(function* () {
        const asked = yield* read(
          prRunSetCommandParamsSchema,
          params,
          "a run command names its workspace, its repository, and the command or null",
        );
        const owner = accountEmail();
        if (owner === undefined) {
          return carried({ refused: "Sign in to set a run command." } satisfies PrRunOutcome);
        }
        const command = asked.command?.trim() || undefined;
        const kept = yield* Effect.orElseSucceed(
          store.setPrRunCommand(
            { accountEmail: owner, workspaceId: asked.workspaceId, repository: asked.repository },
            command,
          ),
          () => false,
        );
        const outcome: PrRunOutcome = kept
          ? { done: true }
          : { refused: "Luke could not save the run command." };
        return carried(outcome);
      }),
    [GATEWAY_METHOD.PR_RUNS_START]: (params) =>
      Effect.gen(function* () {
        const { connectionId, ...pullRequest } = yield* read(
          prRunStartParamsSchema,
          params,
          "a run names its connection and its pull request",
        );
        return carried(yield* start(connectionId, pullRequest));
      }),
    [GATEWAY_METHOD.PR_RUNS_STOP]: (params) =>
      Effect.gen(function* () {
        const pullRequest = yield* read(
          prRunPullRequestSchema,
          params,
          "a stop names its pull request",
        );
        const slot = slotOf(pullRequest);
        yield* slot.lock.withPermits(1)(stopped(slot));
        return {};
      }),
    [GATEWAY_METHOD.PR_RUNS_ACK]: (params) =>
      Effect.gen(function* () {
        const { connectionId, bytes } = yield* read(
          prRunAckParamsSchema,
          params,
          "an ack names the connection and the bytes written",
        );
        const viewer = byConnection.get(connectionId)?.viewer;
        if (viewer === undefined || viewer.connectionId !== connectionId) return {};
        viewer.unacked = Math.max(0, viewer.unacked - bytes);
        if (viewer.unacked < PR_RUN_FLOW.RESUME_BELOW_BYTES) yield* viewer.caughtUp.open;
        return {};
      }),
    [GATEWAY_METHOD.PR_RUNS_ATTACH]: (params) =>
      Effect.gen(function* () {
        const { connectionId, ...pullRequest } = yield* read(
          prRunStartParamsSchema,
          params,
          "attaching names its connection and its pull request",
        );
        const slot = slotOf(pullRequest);
        // Note that a panel drawing the tab again is told where the run stands first; what it printed meanwhile was let go.
        yield* slot.lock.withPermits(1)(
          Effect.andThen(
            view(slot, connectionId),
            Effect.suspend(() => (slot.state === undefined ? Effect.void : tell(slot, slot.state))),
          ),
        );
        return {};
      }),
    [GATEWAY_METHOD.PR_RUNS_DETACH]: (params) =>
      Effect.gen(function* () {
        const { connectionId } = yield* read(
          prRunConnectionParamsSchema,
          params,
          "detaching names its connection",
        );
        const slot = byConnection.get(connectionId);
        byConnection.delete(connectionId);
        const viewer = slot?.viewer;
        if (slot === undefined || viewer?.connectionId !== connectionId) return {};
        // Note that a run nobody draws goes on, its output let go rather than held, so a server is never stalled by a tab out of sight.
        slot.viewer = undefined;
        yield* viewer.caughtUp.open;
        return {};
      }),
    [GATEWAY_METHOD.PR_RUNS_RELEASE]: (params) =>
      Effect.gen(function* () {
        const { connectionId } = yield* read(
          prRunConnectionParamsSchema,
          params,
          "letting a run go names its connection",
        );
        const slot = byConnection.get(connectionId);
        byConnection.delete(connectionId);
        if (slot === undefined || slot.viewer?.connectionId !== connectionId) return {};
        // Note that a tab closed is a Stop, because nothing would draw the run any more; the checkout stays.
        yield* slot.lock.withPermits(1)(
          Effect.andThen(
            stopped(slot),
            Effect.sync(() => {
              slot.viewer = undefined;
            }),
          ),
        );
        return {};
      }),
    [GATEWAY_METHOD.PR_RUNS_LOCATE]: (params) =>
      Effect.gen(function* () {
        const pullRequest = yield* read(
          prRunPullRequestSchema,
          params,
          "a reveal names its pull request",
        );
        const place = placeOf(pullRequest);
        const path = place === undefined ? undefined : yield* locateCheckout(place);
        return carried({ path: path ?? null });
      }),
    [GATEWAY_METHOD.PR_RUNS_DELETE]: (params) =>
      Effect.gen(function* () {
        const pullRequest = yield* read(
          prRunPullRequestSchema,
          params,
          "a deletion names its pull request",
        );
        const place = placeOf(pullRequest);
        if (place === undefined) {
          return carried({ refused: "Sign in to delete a local checkout." } satisfies PrRunOutcome);
        }
        const slot = slotOf(pullRequest);
        const outcome: PrRunOutcome = yield* slot.lock.withPermits(1)(
          Effect.gen(function* () {
            if (slot.runId !== undefined) {
              return { refused: "Stop the run before deleting its local checkout." };
            }
            const removed = yield* removeCheckout(place);
            return removed
              ? { done: true as const }
              : {
                  refused:
                    "Luke could not delete the local checkout safely, so it left it in place.",
                };
          }),
        );
        return carried(outcome);
      }),
  };

  const reset = Effect.gen(function* () {
    yield* FiberMap.clear(fibers);
    for (const repositories of slots.values()) {
      for (const numbers of repositories.values()) {
        for (const slot of numbers.values()) {
          slot.runId = undefined;
          slot.viewer = undefined;
        }
      }
    }
    byConnection.clear();
  });

  return { methods, lifetime: Effect.void, reset };
}
