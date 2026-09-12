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
import { Config, Effect, Option, Runtime } from "effect";
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
  retireBrain: () => void;
  rebuildBrain: () => Promise<void>;
  syncMemory: () => void;
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
  applyVoiceCredential: () => Promise<void>;
  sessionReplayState: () => Promise<{ permitted: boolean; accountId?: string }>;
  link: (links: AccountLinks) => void;
}

export interface AccountDependencies {
  settings: SettingsComposer;
}

/**
 * The account concern, over the kernel it takes as a tag rather than as a
 * constructor argument. What the merge links late is a set-once `Deferred`
 * (`lateService`) rather than a holder of its own, so the link a concern
 * holds cannot depend on the order the merge folded it in; the sync read
 * beside it is what the callbacks the session manager and the Gateway
 * handlers answer still hold.
 */
export const composeAccount = (
  dependencies: AccountDependencies,
): Effect.Effect<AccountComposer, never, HostKernelTag | Environment | AppIdentity> =>
  Effect.gen(function* () {
    const { settings } = dependencies;
    const kernel = yield* HostKernelTag;
    const environment = yield* Environment;
    const identity = yield* AppIdentity;
    const { runMode, report } = kernel;
    // The runtime the host is being built on, threaded through
    // `VoiceCapabilityAssembler` to every model adapter it builds, so the
    // promise each of those still answers is run on the host's own runtime
    // rather than on an ambient default one, and what this composer runs on it
    // itself: `applyVoiceCredential`'s transition below, and the settings
    // change the account's own `onChange` asks for from a synchronous body
    // that has no fiber to yield on.
    const runtime = yield* Effect.runtime<never>();
    const late = yield* lateService<AccountLinks>();
    const links = (): AccountLinks => {
      const standing = late.unsafePeek();
      if (Option.isNone(standing)) {
        throw new Error("the account composer's links are read before link() has run");
      }
      return standing.value;
    };

    const client = new AccountClient({
      baseUrl: kernel.accountBaseUrl,
      clientId: ACCOUNT_CLIENT_ID,
    });
    let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

    const session = new AccountSessionManager({
      client,
      // The store's own effects, with an I/O failure read as the defect the
      // rejected promise behind each of these already was. The lateness of
      // the links below is an `Effect.suspend` because a link read at
      // construction would be read before `link()` has run.
      store: {
        readAccount: () => Effect.orDie(settings.store.readAccount()),
        setAccount: (stored) => Effect.orDie(settings.store.setAccount(stored)),
        clearAccount: () => Effect.orDie(settings.store.clearAccount()),
      },
      hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
      requiresAccount: runMode.requiresAccount,
      openExternal: (url) => kernel.openExternalThroughNode(url),
      startCapabilities: Effect.suspend(() => links().startCapabilities),
      stopCapabilities: Effect.suspend(() => links().stopCapabilities),
      onSignOut: (stored) => links().releaseDevice(stored),
      onChange: (next) => {
        const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
        const wasSignedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
        const previousAccountKey =
          account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
        const nextAccountKey = signedIn ? next.email : undefined;
        account = next;
        if (previousAccountKey !== nextAccountKey) settings.forgetAccountPreferenceHydration();
        // The vault's list is the departing account's: emptied here, ahead of
        // the departure's own emit, so the very snapshot that reports the
        // sign-out reads every cloud provider as not connected.
        if (wasSignedIn && !signedIn) settings.forgetVaultKeys();
        if (signedIn && !wasSignedIn) links().onFirstSignIn();
        kernel.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(account));
        // The settings change on the host's own runtime rather than an ambient
        // default one, forked because nothing here waits for it, exactly as
        // the promise it replaced was not waited for. The run allowlist entry
        // (`docs/adr/0001-effect.md`) goes when `onChange` answers an Effect.
        Runtime.runFork(runtime)(settings.emitSettings());
        void emitSessionReplay();
        if (signedIn && !wasSignedIn) {
          settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
          links().onFirstSignInArrival();
        }
      },
    });

    /**
     * The development trace, gated so it cannot exist for a user: a packaged
     * build never reads the variable, a fixture or evidence run has no traffic to
     * tap and constructs no writer.
     */
    const traceDirectory =
      identity.packaged || !runMode.sendsNetwork
        ? Option.none<string>()
        : yield* Effect.orDie(environment.load(agentTraceDirectory));
    const agentTrace = Option.isSome(traceDirectory)
      ? new AgentTraceWriter({ directory: traceDirectory.value })
      : undefined;
    if (agentTrace) report(`Agent trace: ${agentTrace.file}`);

    const voiceServiceOrigin = yield* Effect.orDie(
      environment.load(Config.option(Config.string(VOICE_SERVICE_ORIGIN_VARIABLE))),
    );

    function capabilitiesActive(): boolean {
      return accountGateOpen(runMode, account.status === ACCOUNT_STATUS.SIGNED_IN);
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
      accountSignedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
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
      deviceId: () => links().deviceId(),
      execution: runtime,
      ...(agentTrace
        ? {
            wrapBrainModel: (model) =>
              tracedModelAdapter(model, (record) => agentTrace.recordBrainRequest(record), runtime),
          }
        : undefined),
    });

    /**
     * Whether an account was deleted in this run, which stands recording down
     * for the rest of it; the client relays the answer to its renderers.
     */
    let sessionReplayEndedByDeletion = false;

    async function sessionReplayState(): Promise<{ permitted: boolean; accountId?: string }> {
      const signedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
      const accountId = signedIn ? (await settings.awaitedStore.readAccount())?.id : undefined;
      return {
        permitted: runMode.sendsNetwork && !sessionReplayEndedByDeletion,
        ...(accountId ? { accountId } : undefined),
      };
    }

    let sessionReplayGeneration = 0;
    async function emitSessionReplay(): Promise<void> {
      // The account is read asynchronously, and a sign-out reports the transition
      // before it clears the stored account, so a late answer must not restart
      // recording under the person who just left.
      const generation = ++sessionReplayGeneration;
      const replay = await sessionReplayState();
      if (generation !== sessionReplayGeneration) return;
      kernel.emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
    }

    /**
     * @deprecated Runs the transition on the runtime this composer was built
     * on because `applyVoiceCredential`'s own callers — the settings side
     * effects and the account gate in `compose-host.ts` — still hold it as a
     * `Promise<void>`; each is a promise-shaped collaborator of its own, not
     * this PR's voice-settings slice. The run allowlist entry
     * (`docs/adr/0001-effect.md`) is deleted with this comment when
     * `applyVoiceCredential` itself answers an Effect.
     */
    async function applyVoiceCredential(): Promise<void> {
      await Runtime.runPromise(runtime)(
        transitionVoiceSource({
          retire: () => links().retireBrain(),
          apply: () => voiceCapabilities.apply(),
          rebuild: async () => {
            await links().rebuildBrain();
            links().syncMemory();
          },
        }),
      );
    }

    const methods: GatewayMethodTable = {
      [GATEWAY_METHOD.ACCOUNT_SNAPSHOT]: () => Effect.succeed({ account: carried(account) }),
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
          yield* Effect.promise(() => settings.flushProductEvents());
          const snapshot = yield* session.signOut({ revokeRemote: true });
          return { account: carried(snapshot) };
        }),
      [GATEWAY_METHOD.ACCOUNT_DELETE]: () =>
        Effect.gen(function* () {
          settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
            account_action: PRODUCT_ACCOUNT_ACTION.DELETE,
          });
          yield* Effect.promise(() => settings.flushProductEvents());
          const snapshot = yield* Effect.orDie(session.deleteEverywhere());
          // Only a deletion that landed stands recording down for the run.
          sessionReplayEndedByDeletion = true;
          void emitSessionReplay();
          return { account: carried(snapshot) };
        }),
    };

    return {
      methods,
      session,
      voiceCapabilities,
      agentTrace,
      snapshot: () => account,
      signedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
      capabilitiesActive,
      token,
      applyVoiceCredential,
      sessionReplayState,
      link: (next) => {
        late.unsafeSet(next);
      },
      // The session manager holds no timer this host started: what a sign-in
      // began is stopped by the capabilities it started, so this lifetime is
      // its start alone and registers nothing to give back.
      lifetime: Effect.gen(function* () {
        account = runMode.requiresAccount
          ? yield* Effect.orDie(settings.store.accountSnapshot())
          : { status: ACCOUNT_STATUS.SIGNED_OUT };
        session.initialize(account);
      }),
    };
  });
