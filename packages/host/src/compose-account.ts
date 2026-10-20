import { accountGateOpen } from "@luke/credentials";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  isAccountProvider,
} from "@luke/credentials/snapshot";
import {
  type AccountToken,
  type CallCredential,
  hostedVoiceServiceOrigin,
  VOICE_SERVICE_ORIGIN_VARIABLE,
} from "@luke/features";
import { PRODUCT_ACCOUNT_ACTION, PRODUCT_EVENT } from "@luke/features/analytics";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  RefusedRefusal,
} from "@luke/gateway";
import { VoiceCapabilityAssembler } from "@luke/voice";
import type { OpenSocket } from "@luke/voice/live-socket";
import { Config, Effect, FiberSet, Option, type Scope, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import { AccountAccessClient, accountAccessHolder } from "./account-access-client.js";
import type { AccountSession } from "./account-source.js";
import type { AppAccessSlice } from "./app-state.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { agentTraceDirectory } from "./devtrace/trace-directory.js";
import { AgentTraceWriter } from "./devtrace/trace-writer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AccountSource, AppIdentity, Environment, ServiceOrigin } from "./effect/seams.js";

/** What a refused account step says, worded by the step alone. */
const SIGN_IN_REFUSED = "the sign-in did not finish";
const SIGN_OUT_REFUSED = "the sign-out did not finish";
const DELETE_REFUSED = "the account was not deleted";

/**
 * What the account reaches in the other concerns. The capability gate is the
 * genuine cycle: signing in starts the loops, and the loops read the gate, so
 * neither side can be the other's constructor argument.
 */
interface AccountLinks {
  /** The account gate's own pair: opening it arms every cadence a signed-in account may have, and closing it disarms them. */
  readonly startCapabilities: Effect.Effect<void>;
  readonly stopCapabilities: Effect.Effect<void>;
}

export interface AccountComposer extends Composer {
  /** The account's session, as the shell's account source opened it. */
  readonly session: AccountSession;
  readonly voiceCapabilities: VoiceCapabilityAssembler;
  readonly agentTrace: AgentTraceWriter | undefined;
  snapshot: () => AccountSnapshot;
  signedIn: () => boolean;
  capabilitiesActive: () => boolean;
  /**
   * The signed-in account's tokens. A run that sends nothing reads no token,
   * so every call made under it refuses on its own before anything travels,
   * which is what keeps a fixture or evidence run off the network.
   */
  readonly token: AccountToken;
  /** The signed-in account's bearer over `token`, as a hosted client's call carries it. */
  readonly credential: CallCredential;
  /**
   * The Mac's own Better Auth session, for the calls that write through
   * Better Auth's organization endpoints. A run that sends nothing reads
   * none, as it reads no token.
   */
  readonly sessionCredential: CallCredential;
  applyVoiceCredential: Effect.Effect<void>;
  sessionReplayState: Effect.Effect<{ permitted: boolean; accountId?: string }>;
  /** What the signed-in account may open in the app, as last read for it; no admin for anyone else. */
  accessState: Effect.Effect<AppAccessSlice>;
  /**
   * Reads the signed-in account's access afresh, in a fiber of this
   * concern's own so the gate that asks does not wait on the service; the
   * answer reaches the windows as its own event.
   */
  refreshAccess: Effect.Effect<void>;
  link: (links: AccountLinks) => Effect.Effect<void>;
}

interface AccountDependencies {
  settings: SettingsComposer;
  /** How the voice sideband's socket is opened; the platform's own WebSocket, handed in. */
  openSocket: OpenSocket;
}

/**
 * The account concern, over the kernel it takes as a tag rather than as a
 * constructor argument. What the merge links late is a set-once `Deferred`
 * (`lateService`) rather than a holder of its own, so the link a concern
 * holds cannot depend on the order the merge folded it in. Every link is
 * read by awaiting it, so a caller that asks before the merge has linked
 * suspends rather than throwing.
 */
export const composeAccount = /* @__PURE__ */ Effect.fn("host/composeAccount")(function* (
  dependencies: AccountDependencies,
): Effect.fn.Return<
  AccountComposer,
  never,
  | HostKernelTag
  | Environment
  | AppIdentity
  | AccountSource
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope
> {
  const { settings, openSocket } = dependencies;
  const kernel = yield* HostKernelTag;
  const environment = yield* Environment;
  const identity = yield* AppIdentity;
  const source = yield* AccountSource;
  const { runMode, report } = kernel;
  const late = yield* lateService<AccountLinks>();

  // The capability pair is awaited rather than read, because a link read
  // at construction would be read before `link()` has run.
  const session = yield* source.open({
    store: settings.store,
    accountBaseUrl: kernel.accountBaseUrl,
    hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
    runMode,
    report,
    openExternal: (url) => kernel.openExternalThroughNode(url),
    startCapabilities: Effect.flatMap(late.value, (links) => links.startCapabilities),
    stopCapabilities: Effect.flatMap(late.value, (links) => links.stopCapabilities),
  });

  /**
   * The previous snapshot, read by the subscriber alone: `session.snapshot()`
   * is always the session's own current answer, so every other reader in
   * this file reads that directly rather than a mirror that would only
   * catch up once the subscription's fiber had run.
   */
  let previousAccount: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

  /**
   * What the account may open, held for the account it was read for: a
   * sign-in reads it (`refreshAccess`, from the gate opening), and a change
   * of account publishes it again, so another account, or nobody, is never
   * told an admin's answer.
   */
  const access = accountAccessHolder({
    client: new AccountAccessClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      credential: session.credential,
    }),
    accountKey: () => {
      const account = session.snapshot();
      return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
    },
    publish: (next) => kernel.emit(GATEWAY_EVENT.ACCOUNT_ACCESS_CHANGED, carried(next)),
  });
  const accessReads = yield* FiberSet.make();

  /**
   * What a session change means to the rest of the host, as the subscriber
   * a fiber in this composer's own lifetime pumps from `session.changes`
   * rather than a callback the session held and ran: never
   * that a turn lands before the fiber that changed it moves on, which is
   * the same eventual guarantee the two forks this replaces already gave
   * `emitSessionReplay` and `settings.emitSettings()`.
   */
  const onAccountChange = /* @__PURE__ */ Effect.fnUntraced(function* (
    next: AccountSnapshot,
  ): Effect.fn.Return<void> {
    const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
    const wasSignedIn = previousAccount.status === ACCOUNT_STATUS.SIGNED_IN;
    const previousAccountKey =
      previousAccount.status === ACCOUNT_STATUS.SIGNED_IN ? previousAccount.email : undefined;
    const nextAccountKey = signedIn ? next.email : undefined;
    previousAccount = next;
    if (previousAccountKey !== nextAccountKey) settings.forgetAccountPreferenceHydration();
    // A deletion stands recording down until the next sign-in, which starts it again.
    if (signedIn && !wasSignedIn) sessionReplayEndedByDeletion = false;
    kernel.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(next));
    yield* access.accountChanged;
    yield* settings.emitSettings();
    yield* emitSessionReplay;
    if (signedIn && !wasSignedIn) settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
  });

  /**
   * The development trace, gated so it cannot exist for a user: a packaged
   * build never reads the variable, a fixture or evidence run has no traffic to
   * tap and constructs no writer.
   */
  const traceDirectory =
    identity.packaged || !runMode.sendsNetwork
      ? Option.none<string>()
      : yield* Effect.orDie(agentTraceDirectory.parse(environment));
  const agentTrace = Option.isSome(traceDirectory)
    ? yield* AgentTraceWriter.make({ directory: traceDirectory.value, report })
    : undefined;
  if (agentTrace) report(`Agent trace: ${agentTrace.file}`);

  const voiceServiceOrigin = yield* Effect.orDie(
    Config.option(Config.String(VOICE_SERVICE_ORIGIN_VARIABLE)).parse(environment),
  );
  const serviceOrigin = yield* Effect.serviceOption(ServiceOrigin);

  function capabilitiesActive(): boolean {
    return accountGateOpen(runMode, session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN);
  }

  const voiceCapabilities = new VoiceCapabilityAssembler({
    settings: settings.store,
    credentialsUsable: () => runMode.sendsNetwork && capabilitiesActive(),
    fixtureRun: () => !runMode.sendsNetwork,
    accountSignedIn: () => session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN,
    // The voice functions live on the account service's origin, so its
    // development override reaches them too; a voice override of its own stands
    // where a `vercel dev` serves the functions apart, and a packaged build takes neither.
    // A service origin the shell named stands over all of them.
    hostedVoiceServiceOrigin: hostedVoiceServiceOrigin(
      Option.isSome(serviceOrigin)
        ? { packaged: false, override: kernel.hostedServiceBaseUrl }
        : {
            packaged: identity.packaged,
            override: Option.getOrUndefined(voiceServiceOrigin) ?? kernel.hostedServiceBaseUrl,
          },
    ),
    openSocket,
    refreshAccount: session.token.refreshAccount,
  });

  /**
   * Whether an account was deleted in this run, which stands recording down
   * until the next sign-in or the next launch, as `PRIVACY.md` says; the
   * client relays the answer to its renderers.
   */
  let sessionReplayEndedByDeletion = false;

  // The id is the session's own, so a source that keeps no account in the
  // settings file (a browser's cookie session) still names who is recorded.
  const sessionReplayState: Effect.Effect<{ permitted: boolean; accountId?: string }> = Effect.sync(
    () => {
      const account = session.snapshot();
      const accountId = account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
      return {
        permitted: runMode.sendsNetwork && !sessionReplayEndedByDeletion,
        ...(accountId ? { accountId } : undefined),
      };
    },
  );

  // Note that the answer is read from the session as it stands, with nothing
  // to wait on, so no late answer can restart recording under the person
  // who just left.
  const emitSessionReplay: Effect.Effect<void> = Effect.map(sessionReplayState, (replay) => {
    kernel.emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
  });

  // The application's own `PlatformError` reads as a defect, exactly as the
  // promise this replaced rejected on the same failure. Nothing is built
  // over the applied capability on this side: the assembler's publication
  // is the whole of the transition.
  const applyVoiceCredential: Effect.Effect<void> = Effect.orDie(
    Effect.asVoid(voiceCapabilities.apply()),
  );

  /**
   * A step the account source could not carry, answered as the protocol's
   * refusal rather than a defect: a browser's cookie session fails on any
   * network blip or 5xx, and the desktop's on a consent that did not finish,
   * which are ordinary outcomes the panel says in its own words, never bugs
   * for Sentry. The refusal carries `sentence` alone, so nothing an answer
   * held crosses the Gateway; the source's own detail goes to the host's
   * log.
   */
  const refusedAs =
    (sentence: string) =>
    <A>(step: Effect.Effect<A, Error>): Effect.Effect<A, RefusedRefusal> =>
      step.pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            report(`${sentence}: ${error.message}`);
          }),
        ),
        Effect.mapError(() => new RefusedRefusal({ message: sentence })),
      );

  /**
   * The count of a sign-in's start, left before the step that may take the
   * window away: a browser tab navigates to the provider, and a queued count
   * would go with the page.
   */
  const recordSignInStart: Effect.Effect<void> = Effect.suspend(() => {
    settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
      account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_START,
    });
    return settings.flushProductEvents;
  });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT]: () =>
      Effect.succeed({ account: carried(session.snapshot()) }),
    [GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN]: (params) =>
      Effect.gen(function* () {
        const provider = params.provider;
        if (!isAccountProvider(provider))
          return yield* invalid("provider is not one this build knows");
        yield* recordSignInStart;
        const snapshot = yield* refusedAs(SIGN_IN_REFUSED)(session.beginSignIn(provider));
        return { account: carried(snapshot) };
      }),
    [GATEWAY_METHOD.ACCOUNT_SIGN_IN_AGAIN]: (params) =>
      Effect.gen(function* () {
        const provider = params.provider;
        if (!isAccountProvider(provider))
          return yield* invalid("provider is not one this build knows");
        yield* recordSignInStart;
        // Whether a session landed, and nothing of it: the account follows on its own event.
        return { signedIn: yield* refusedAs(SIGN_IN_REFUSED)(session.signInAgain(provider)) };
      }),
    [GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN]: () =>
      Effect.sync(() => {
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
          account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_CANCEL,
        });
        session.cancelSignIn();
        return {};
      }),
    [GATEWAY_METHOD.ACCOUNT_SIGN_OUT]: () =>
      Effect.gen(function* () {
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
          account_action: PRODUCT_ACCOUNT_ACTION.SIGN_OUT,
        });
        // The count of the action leaves before the action ends the account it is
        // authenticated with; queued behind the sign-out it would wait for the
        // next sign-in.
        yield* settings.flushProductEvents;
        const snapshot = yield* refusedAs(SIGN_OUT_REFUSED)(
          session.signOut({ revokeRemote: true }),
        );
        return { account: carried(snapshot) };
      }),
    [GATEWAY_METHOD.ACCOUNT_DELETE]: () =>
      Effect.gen(function* () {
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
          account_action: PRODUCT_ACCOUNT_ACTION.DELETE,
        });
        yield* settings.flushProductEvents;
        const snapshot = yield* refusedAs(DELETE_REFUSED)(session.deleteEverywhere());
        // Only a deletion that landed stands recording down for the run.
        sessionReplayEndedByDeletion = true;
        // Forked as a daemon rather than a plain fork: the handler's own
        // fiber ends the moment this returns, and a fork supervised by it
        // would be interrupted with it, dropping the very reply that is
        // supposed to stand recording down.
        yield* Effect.forkDetach(emitSessionReplay);
        return { account: carried(snapshot) };
      }),
  };

  return {
    methods,
    session,
    voiceCapabilities,
    agentTrace,
    snapshot: session.snapshot,
    signedIn: () => session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN,
    capabilitiesActive,
    token: session.token,
    credential: session.credential,
    sessionCredential: session.sessionCredential,
    applyVoiceCredential,
    sessionReplayState,
    accessState: Effect.sync(access.current),
    refreshAccess: Effect.asVoid(FiberSet.run(accessReads, access.refresh)),
    link: (next) => Effect.asVoid(late.set(next)),
    // The session holds no timer this host started beyond its own
    // subscription: what a sign-in began is stopped by the capabilities it
    // started, and the subscription is forked into this same scope, so
    // closing it is the whole of the stop and there is nothing else to give
    // back. It subscribes before the launch's read, so a change that lands
    // while it reads (a refused call's re-read of a cookie session) is held
    // for the subscriber rather than published to no one; the subscriber
    // starts once the launch's account stands as the one it compares against.
    // Note that a session a re-read settled on during the launch is then the
    // launch's own account: the panel hears it, and, as for a launch that read
    // it itself, no sign-in is counted.
    lifetime: Effect.gen(function* () {
      const changes = yield* session.changes;
      previousAccount = yield* session.initialize;
      yield* Effect.forkScoped(Stream.runForEach(changes, onAccountChange));
    }),
  };
});
