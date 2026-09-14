import { PRODUCT_ACCOUNT_ACTION, PRODUCT_EVENT } from "@sidecar/analytics";
import {
  AccountClient,
  AccountSessionManager,
  accountGateOpen,
  type StoredAccount,
} from "@sidecar/credentials";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  isAccountProvider,
} from "@sidecar/credentials/snapshot";
import { AgentTraceWriter, agentTraceDirectory, tracedModelAdapter } from "@sidecar/devtrace";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import {
  type AccountToken,
  hostedVoiceServiceOrigin,
  VOICE_SERVICE_ORIGIN_VARIABLE,
} from "@sidecar/hosted";
import { VoiceCapabilityAssembler } from "@sidecar/voice";
import { Config, Effect, MutableRef, Option, type Scope, Stream } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AppIdentity, Environment } from "./effect/seams.js";
import { openSocketOverWs } from "./voice/socket-over-ws.js";
import { transitionVoiceSource } from "./voice-source-transition.js";

const ACCOUNT_CLIENT_ID = "luke-desktop";

/**
 * What the account reaches in the other concerns. The capability gate is the
 * genuine cycle: signing in starts the loops, and the loops read the gate, so
 * neither side can be the other's constructor argument.
 */
interface AccountLinks {
  /** The account gate's own pair: opening it arms every cadence a signed-in account may have, and closing it disarms them. */
  readonly startCapabilities: Effect.Effect<void>;
  readonly stopCapabilities: Effect.Effect<void>;
  /** The calendar step of onboarding, raised before the account event so the gate already stands when the renderer learns of the sign-in. */
  onFirstSignIn: () => void;
  /** The arrival beat's own moment, recorded after the account event. */
  onFirstSignInArrival: () => void;
  retireBrain: () => Effect.Effect<void>;
  rebuildBrain: () => Effect.Effect<void>;
  /** The device row let go of on the departing account's own token, before the credential is cleared. */
  releaseDevice: (account: StoredAccount) => Effect.Effect<void>;
  /** This installation's device row id, once registered, for the live session's handshake. */
  deviceId: () => string | undefined;
}

export interface AccountComposer extends Composer {
  readonly session: AccountSessionManager;
  readonly voiceCapabilities: VoiceCapabilityAssembler;
  readonly agentTrace: AgentTraceWriter | undefined;
  snapshot: () => AccountSnapshot;
  signedIn: () => boolean;
  capabilitiesActive: () => boolean;
  /**
   * The signed-in account as a hosted client is handed it. A run that sends
   * nothing reads no token, so every call made under it refuses on its own
   * before anything travels, which is what keeps a fixture or evidence run
   * off the network.
   */
  readonly token: AccountToken;
  applyVoiceCredential: Effect.Effect<void>;
  sessionReplayState: Effect.Effect<{ permitted: boolean; accountId?: string }>;
  link: (links: AccountLinks) => Effect.Effect<void>;
}

export interface AccountDependencies {
  settings: SettingsComposer;
}

/**
 * The account concern, over the kernel it takes as a tag rather than as a
 * constructor argument. What the merge links late is a set-once `Deferred`
 * (`lateService`) rather than a holder of its own, so the link a concern
 * holds cannot depend on the order the merge folded it in. Every link but one
 * is read by awaiting it, so a caller that asks before the merge has linked
 * suspends rather than throwing; the one synchronous reader takes a value the
 * link mirrors.
 */
export const composeAccount = /* @__PURE__ */ Effect.fn("composeAccount")(function* (
  dependencies: AccountDependencies,
): Effect.fn.Return<
  AccountComposer,
  never,
  HostKernelTag | Environment | AppIdentity | FileSystem.FileSystem | Scope.Scope
> {
  const { settings } = dependencies;
  const kernel = yield* HostKernelTag;
  const environment = yield* Environment;
  const identity = yield* AppIdentity;
  const { runMode, report } = kernel;
  // The services the host is being built on, threaded through
  // `VoiceCapabilityAssembler` to every model adapter it builds, so the
  // promise each of those still answers is run under the host's own
  // services rather than under an ambient empty set.
  const execution = yield* Effect.context<never>();
  const late = yield* lateService<AccountLinks>();
  /**
   * The device row's id, mirrored for the one link a caller reads from a
   * synchronous statement: the voice capability assembler asks for it while
   * building a handshake and holds no fiber to await the links on. The link
   * writes the reader the devices composer owns, so a read before the merge
   * answers the no device an unregistered installation answers anyway rather
   * than throwing.
   */
  const deviceIdReader = MutableRef.make<() => string | undefined>(() => undefined);

  const client = new AccountClient({
    baseUrl: kernel.accountBaseUrl,
    clientId: ACCOUNT_CLIENT_ID,
  });

  const session = yield* AccountSessionManager.make({
    client,
    // The store's own effects, with an I/O failure read as the defect the
    // rejected promise behind each of these already was. Each link below is
    // awaited rather than read, because a link read at construction would be
    // read before `link()` has run.
    store: {
      readAccount: () => Effect.orDie(settings.store.readAccount()),
      setAccount: (stored) => Effect.orDie(settings.store.setAccount(stored)),
      clearAccount: () => Effect.orDie(settings.store.clearAccount()),
    },
    hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
    requiresAccount: runMode.requiresAccount,
    openExternal: (url) => kernel.openExternalThroughNode(url),
    startCapabilities: Effect.flatMap(late.value, (links) => links.startCapabilities),
    stopCapabilities: Effect.flatMap(late.value, (links) => links.stopCapabilities),
    onSignOut: (stored) => Effect.flatMap(late.value, (links) => links.releaseDevice(stored)),
  });

  /**
   * The previous snapshot, read by the subscriber alone: `session.snapshot`
   * is always the manager's own current answer, so every other reader in
   * this file reads that directly rather than a mirror that would only
   * catch up once the subscription's fiber had run.
   */
  let previousAccount: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

  /**
   * What a session change means to the rest of the host, as the subscriber
   * a fiber in this composer's own lifetime pumps from `session.changes`
   * rather than a callback `AccountSessionManager` held and ran. The order
   * within one turn is what the comments below still guarantee — the
   * calendar step of onboarding lands before the account event a renderer
   * reads it against — never that a turn lands before the fiber that
   * changed it moves on, which is the same eventual guarantee the two
   * forks this replaces already gave `emitSessionReplay` and
   * `settings.emitSettings()`.
   */
  const onAccountChange = /* @__PURE__ */ Effect.fnUntraced(function* (
    next: AccountSnapshot,
  ): Effect.fn.Return<void> {
    const links = yield* late.value;
    const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
    const wasSignedIn = previousAccount.status === ACCOUNT_STATUS.SIGNED_IN;
    const previousAccountKey =
      previousAccount.status === ACCOUNT_STATUS.SIGNED_IN ? previousAccount.email : undefined;
    const nextAccountKey = signedIn ? next.email : undefined;
    previousAccount = next;
    if (previousAccountKey !== nextAccountKey) settings.forgetAccountPreferenceHydration();
    // The vault's list is the departing account's: emptied here, ahead of
    // the departure's own emit, so the very snapshot that reports the
    // sign-out reads every cloud provider as not connected.
    if (wasSignedIn && !signedIn) settings.forgetVaultKeys();
    if (signedIn && !wasSignedIn) links.onFirstSignIn();
    kernel.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(next));
    yield* settings.emitSettings();
    yield* emitSessionReplay;
    if (signedIn && !wasSignedIn) {
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
      links.onFirstSignInArrival();
    }
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
    ? yield* AgentTraceWriter.make({ directory: traceDirectory.value })
    : undefined;
  if (agentTrace) report(`Agent trace: ${agentTrace.file}`);

  const voiceServiceOrigin = yield* Effect.orDie(
    Config.option(Config.String(VOICE_SERVICE_ORIGIN_VARIABLE)).parse(environment),
  );

  function capabilitiesActive(): boolean {
    return accountGateOpen(runMode, session.snapshot.status === ACCOUNT_STATUS.SIGNED_IN);
  }

  /**
   * One account read: a store that could not be read is an account this
   * attempt cannot name, exactly as a rejected read already was here.
   */
  const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
    settings.store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

  // The holder is the account's own address, so a call's one retry after a
  // 401 can tell a renewed token from a different person's: a sign-out and
  // sign-in between the attempt and its retry reads as the caller's account
  // gone, never as a fresh bearer to carry the old account's payload under.
  const token: AccountToken = {
    readAccessToken: () =>
      runMode.sendsNetwork
        ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
        : Effect.succeed(undefined),
    refreshAccount: session.refreshOnce,
    readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
  };

  const voiceCapabilities = new VoiceCapabilityAssembler({
    settings: settings.store,
    credentialsUsable: () => runMode.sendsNetwork && capabilitiesActive(),
    fixtureRun: () => !runMode.sendsNetwork,
    accountSignedIn: () => session.snapshot.status === ACCOUNT_STATUS.SIGNED_IN,
    hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
    // The voice functions live on the account service's origin, so its
    // development override reaches them too; a voice override of its own stands
    // where a `vercel dev` serves the functions apart, and a packaged build takes neither.
    hostedVoiceServiceOrigin: hostedVoiceServiceOrigin({
      packaged: identity.packaged,
      override: Option.getOrUndefined(voiceServiceOrigin) ?? kernel.hostedServiceBaseUrl,
    }),
    openSocket: openSocketOverWs,
    refreshAccount: session.refreshOnce,
    deviceId: () => MutableRef.get(deviceIdReader)(),
    execution,
    ...(agentTrace
      ? {
          wrapBrainModel: (model) =>
            tracedModelAdapter(model, (record) => agentTrace.recordBrainRequest(record), execution),
        }
      : undefined),
  });

  /**
   * Whether an account was deleted in this run, which stands recording down
   * for the rest of it; the client relays the answer to its renderers.
   */
  let sessionReplayEndedByDeletion = false;

  const sessionReplayState: Effect.Effect<{ permitted: boolean; accountId?: string }> = Effect.gen(
    function* () {
      const signedIn = session.snapshot.status === ACCOUNT_STATUS.SIGNED_IN;
      const accountId = signedIn
        ? (yield* Effect.orDie(settings.store.readAccount()))?.id
        : undefined;
      return {
        permitted: runMode.sendsNetwork && !sessionReplayEndedByDeletion,
        ...(accountId ? { accountId } : undefined),
      };
    },
  );

  let sessionReplayGeneration = 0;
  // The account is read asynchronously, and a sign-out reports the transition
  // before it clears the stored account, so a late answer must not restart
  // recording under the person who just left.
  const emitSessionReplay: Effect.Effect<void> = Effect.gen(function* () {
    const generation = ++sessionReplayGeneration;
    const replay = yield* sessionReplayState;
    if (generation !== sessionReplayGeneration) return;
    kernel.emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
  });

  // The transition's own `PlatformError` reads as a defect, exactly as the
  // promise this replaced rejected on the same failure.
  const applyVoiceCredential: Effect.Effect<void> = Effect.orDie(
    Effect.asVoid(
      transitionVoiceSource({
        retire: () => Effect.flatMap(late.value, (links) => links.retireBrain()),
        apply: () => voiceCapabilities.apply(),
        rebuild: () =>
          Effect.gen(function* () {
            const links = yield* late.value;
            yield* links.rebuildBrain();
          }),
      }),
    ),
  );

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT]: () => Effect.succeed({ account: carried(session.snapshot) }),
    [GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN]: (params) =>
      Effect.gen(function* () {
        const provider = params.provider;
        if (!isAccountProvider(provider))
          return yield* invalid("provider is not one this build knows");
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
          account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_START,
        });
        const snapshot = yield* Effect.orDie(session.beginSignIn(provider));
        return { account: carried(snapshot) };
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
        const snapshot = yield* session.signOut({ revokeRemote: true });
        return { account: carried(snapshot) };
      }),
    [GATEWAY_METHOD.ACCOUNT_DELETE]: () =>
      Effect.gen(function* () {
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
          account_action: PRODUCT_ACCOUNT_ACTION.DELETE,
        });
        yield* settings.flushProductEvents;
        const snapshot = yield* Effect.orDie(session.deleteEverywhere());
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
    snapshot: () => session.snapshot,
    signedIn: () => session.snapshot.status === ACCOUNT_STATUS.SIGNED_IN,
    capabilitiesActive,
    token,
    applyVoiceCredential,
    sessionReplayState,
    link: (next) =>
      Effect.flatMap(late.set(next), (supplied) =>
        Effect.sync(() => {
          if (supplied) MutableRef.set(deviceIdReader, next.deviceId);
        }),
      ),
    // The session manager holds no timer this host started beyond its own
    // subscription: what a sign-in began is stopped by the capabilities it
    // started, and the subscription is forked into this same scope, so
    // closing it is the whole of the stop and there is nothing else to give
    // back.
    lifetime: Effect.gen(function* () {
      const initial = runMode.requiresAccount
        ? yield* Effect.orDie(settings.store.accountSnapshot())
        : { status: ACCOUNT_STATUS.SIGNED_OUT };
      previousAccount = initial;
      session.initialize(initial);
      const changes = yield* session.changes;
      yield* Effect.forkScoped(Stream.runForEach(changes, onAccountChange));
    }),
  };
});
