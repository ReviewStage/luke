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
import { AgentTraceWriter, tracedModelAdapter } from "@sidecar/devtrace";
import { isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
} from "@sidecar/gateway";
import { VOICE_SOURCE_COUNTED_AS } from "@sidecar/settings";
import { VoiceCapabilityAssembler } from "@sidecar/voice";
import { lateRef } from "@sidecar/wire";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { transitionVoiceCredential } from "./voice-credential-transition.js";

const ACCOUNT_CLIENT_ID = "luke-desktop";

/**
 * What the account reaches in the other concerns. The capability gate is the
 * genuine cycle: signing in starts the loops, and the loops read the gate, so
 * neither side can be the other's constructor argument.
 */
export interface AccountLinks {
  startCapabilities: () => Promise<void>;
  stopCapabilities: () => Promise<void>;
  /** The calendar step of onboarding, raised before the account event so the gate already stands when the renderer learns of the sign-in. */
  onFirstSignIn: () => void;
  /** The arrival beat's own moment, recorded after the account event. */
  onFirstSignInArrival: () => void;
  retireBrain: () => void;
  rebuildBrain: () => Promise<void>;
  syncMemory: () => void;
  /** The device row let go of on the departing account's own token, before the credential is cleared. */
  releaseDevice: (account: StoredAccount) => Promise<void>;
}

export interface AccountComposer extends Composer {
  readonly session: AccountSessionManager;
  readonly voiceCapabilities: VoiceCapabilityAssembler;
  readonly agentTrace: AgentTraceWriter | undefined;
  snapshot: () => AccountSnapshot;
  signedIn: () => boolean;
  capabilitiesActive: () => boolean;
  applyVoiceCredential: () => Promise<void>;
  sessionReplayState: () => Promise<{ permitted: boolean; accountId?: string }>;
  link: (links: AccountLinks) => void;
}

export interface AccountDependencies {
  kernel: HostKernel;
  settings: SettingsComposer;
}

export function composeAccount(dependencies: AccountDependencies): AccountComposer {
  const { kernel, settings } = dependencies;
  const { runMode, report, options } = kernel;
  const links = lateRef<AccountLinks>("the account composer's links");

  const client = new AccountClient({
    baseUrl: kernel.accountBaseUrl,
    clientId: ACCOUNT_CLIENT_ID,
  });
  let account: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

  const session = new AccountSessionManager({
    client,
    store: settings.store,
    hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
    requiresAccount: runMode.requiresAccount,
    openExternal: (url) => kernel.openExternalThroughNode(url),
    startCapabilities: () => links.get().startCapabilities(),
    stopCapabilities: () => links.get().stopCapabilities(),
    onSignOut: (stored) => links.get().releaseDevice(stored),
    onChange: (next) => {
      const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
      const wasSignedIn = account.status === ACCOUNT_STATUS.SIGNED_IN;
      const previousAccountKey =
        account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
      const nextAccountKey = signedIn ? next.email : undefined;
      account = next;
      if (previousAccountKey !== nextAccountKey) settings.forgetAccountPreferenceHydration();
      if (signedIn && !wasSignedIn) links.get().onFirstSignIn();
      kernel.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(account));
      void settings.emitSettings();
      void emitSessionReplay();
      if (signedIn && !wasSignedIn) {
        settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
        links.get().onFirstSignInArrival();
      }
    },
  });

  /**
   * The development trace, gated so it cannot exist for a user: a packaged
   * build never reads the variable, a fixture or evidence run has no traffic to
   * tap and constructs no writer.
   */
  const agentTraceDirectory =
    options.packaged || !runMode.sendsNetwork ? undefined : options.environment.LUKE_TRACE_DIR;
  const agentTrace = agentTraceDirectory
    ? new AgentTraceWriter({ directory: agentTraceDirectory })
    : undefined;
  if (agentTrace) report(`Agent trace: ${agentTrace.file}`);

  function capabilitiesActive(): boolean {
    return accountGateOpen(runMode, account.status === ACCOUNT_STATUS.SIGNED_IN);
  }

  const voiceCapabilities = new VoiceCapabilityAssembler({
    settings: settings.store,
    credentialsUsable: () => runMode.sendsNetwork && capabilitiesActive(),
    fixtureRun: () => !runMode.sendsNetwork,
    accountSignedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
    hostedServiceBaseUrl: kernel.hostedServiceBaseUrl,
    refreshAccount: session.refreshOnce,
    ...(agentTrace
      ? {
          wrapBrainModel: (model) =>
            tracedModelAdapter(model, (record) => agentTrace.recordBrainRequest(record)),
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
    const accountId = signedIn ? (await settings.store.readAccount())?.id : undefined;
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

  async function applyVoiceCredential(): Promise<void> {
    await transitionVoiceCredential({
      retire: () => links.get().retireBrain(),
      apply: () => voiceCapabilities.apply(),
      rebuild: async () => {
        await links.get().rebuildBrain();
        links.get().syncMemory();
      },
    });
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.ACCOUNT_SNAPSHOT]: () => gatewayOk({ account: carried(account) }),
    [GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN]: async (params) => {
      if (!isAccountProvider(params.provider))
        return invalid("provider is not one this build knows");
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
        account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_START,
      });
      const snapshot = await session.beginSignIn(params.provider);
      return gatewayOk({ account: carried(snapshot) });
    },
    [GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN]: () => {
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
        account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_CANCEL,
      });
      session.cancelSignIn();
      return gatewayOk({});
    },
    [GATEWAY_METHOD.ACCOUNT_SIGN_OUT]: async () => {
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
        account_action: PRODUCT_ACCOUNT_ACTION.SIGN_OUT,
      });
      // The count of the action leaves before the action ends the account it is
      // authenticated with; queued behind the sign-out it would wait for the
      // next sign-in.
      await settings.flushProductEvents();
      const snapshot = await session.signOut({ revokeRemote: true });
      return gatewayOk({ account: carried(snapshot) });
    },
    [GATEWAY_METHOD.ACCOUNT_DELETE]: async () => {
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
        account_action: PRODUCT_ACCOUNT_ACTION.DELETE,
      });
      await settings.flushProductEvents();
      const snapshot = await session.deleteEverywhere();
      // Only a deletion that landed stands recording down for the run.
      sessionReplayEndedByDeletion = true;
      void emitSessionReplay();
      return gatewayOk({ account: carried(snapshot) });
    },
    // The one credential that crosses to the voice client: the short-lived
    // realtime secret the account minter issues, never the key or the token
    // behind it. Counted here, under the source it actually came from.
    [GATEWAY_METHOD.VOICE_MINT_REALTIME_CREDENTIAL]: async () => {
      const minter = voiceCapabilities.realtimeCredentials;
      if (!minter) return gatewayOk({});
      const credential = await minter.mint();
      if (credential) {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
          credential_source: VOICE_SOURCE_COUNTED_AS[voiceCapabilities.voiceSource],
        });
      }
      return gatewayOk(credential ? { credential: carried(credential) } : {});
    },
    [GATEWAY_METHOD.VOICE_DIAGNOSTICS]: () =>
      gatewayOk({
        diagnostics: carried(
          voiceCapabilities.realtimeCredentials?.diagnostics() ??
            voiceCapabilities.unavailableDiagnostics,
        ),
      }),
    // One realtime event the renderer's tap saw cross the data channel, into
    // the development trace. Read again here for the shape the tap sends; on
    // a run without a writer — packaged, fixture, or simply untraced — it
    // lands here and stops.
    [GATEWAY_METHOD.VOICE_RECORD_TRACE]: (params) => {
      if (!isAgentWireTrace(params.trace)) return invalid("trace is not one tapped wire event");
      agentTrace?.recordWire(params.trace);
      return gatewayOk({});
    },
  };

  return {
    methods,
    session,
    voiceCapabilities,
    agentTrace,
    snapshot: () => account,
    signedIn: () => account.status === ACCOUNT_STATUS.SIGNED_IN,
    capabilitiesActive,
    applyVoiceCredential,
    sessionReplayState,
    link: (next) => links.set(next),
    start: async () => {
      account = runMode.requiresAccount
        ? await settings.store.accountSnapshot()
        : { status: ACCOUNT_STATUS.SIGNED_OUT };
      session.initialize(account);
    },
    // The session manager holds no timer this host started: what a sign-in
    // began is stopped by the capabilities it started, not here.
    stop: async () => undefined,
  };
}
