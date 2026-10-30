import { accountGateOpen, SignInFailed } from "@luke/credentials";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  isAccountProvider,
} from "@luke/credentials/snapshot";
import type { AccountToken, CallCredential } from "@luke/features";
import { PRODUCT_ACCOUNT_ACTION, PRODUCT_EVENT } from "@luke/features/analytics";
import { SIGN_IN_FAILURE, type SignInFailure } from "@luke/features/words";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
  RefusedRefusal,
} from "@luke/gateway";
import { Effect, FiberSet, type Scope, Stream } from "effect";
import { AccountAccessClient, accountAccessHolder } from "./account-access-client.js";
import type { AccountSession } from "./account-source.js";
import type { AppAccessSlice, SessionReplayState } from "./app-state.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AccountSource } from "./effect/seams.js";

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
  sessionReplayState: Effect.Effect<SessionReplayState>;
  /** What the signed-in account may open in the app, as last read for it; no admin for anyone else. */
  accessState: Effect.Effect<AppAccessSlice>;
  /**
   * Reads the signed-in account's access afresh, in a fiber of this
   * concern's own so the gate that asks does not wait on the service; the
   * answer reaches the windows as its own event.
   */
  refreshAccess: Effect.Effect<void>;
  /** Forgets the access read, and any read still out, as the gate closes; no admin until the next read. */
  forgetAccess: Effect.Effect<void>;
  link: (links: AccountLinks) => Effect.Effect<void>;
}

interface AccountDependencies {
  settings: SettingsComposer;
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
): Effect.fn.Return<AccountComposer, never, HostKernelTag | AccountSource | Scope.Scope> {
  const { settings } = dependencies;
  const kernel = yield* HostKernelTag;
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
   * sign-in reads it (`refreshAccess`, from the gate opening), a sign-out
   * forgets it (`forgetAccess`, from the gate closing), and a change of
   * account publishes it again, so another account, or nobody, is never told
   * an admin's answer.
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

  function capabilitiesActive(): boolean {
    return accountGateOpen(runMode, session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN);
  }

  /**
   * Whether an account was deleted in this run, which stands recording down
   * until the next sign-in or the next launch, as `PRIVACY.md` says; the
   * client relays the answer to its renderers.
   */
  let sessionReplayEndedByDeletion = false;

  // The id is the session's own, so a source that keeps no account in the
  // settings file (a browser's cookie session) still names who is recorded.
  // The name and email ride with it, read off the same snapshot, so the
  // person a recording is filed under is never named from another account.
  const sessionReplayState: Effect.Effect<SessionReplayState> = Effect.sync(() => {
    const account = session.snapshot();
    const permitted = runMode.sendsNetwork && !sessionReplayEndedByDeletion;
    if (account.status !== ACCOUNT_STATUS.SIGNED_IN || !account.id) return { permitted };
    return {
      permitted,
      accountId: account.id,
      email: account.email,
      ...(account.name ? { name: account.name } : undefined),
    };
  });

  // Note that the answer is read from the session as it stands, with nothing
  // to wait on, so no late answer can restart recording under the person
  // who just left.
  const emitSessionReplay: Effect.Effect<void> = Effect.map(sessionReplayState, (replay) => {
    kernel.emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
  });

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
   * A sign-in that ended without landing, answered as the key the panel says
   * it in rather than as a refusal, which the act port would replace with its
   * own fixed sentence. The key is all that crosses: the source's own detail,
   * which may name what a provider or a client answered, goes to the host's
   * log alone.
   */
  const signInAnswer = (step: Effect.Effect<AccountSnapshot, Error>) =>
    step.pipe(
      Effect.map((snapshot) => ({ account: carried(snapshot) })),
      Effect.catch((error) =>
        Effect.sync(() => {
          report(`${SIGN_IN_REFUSED}: ${error.message}`);
          const failure: SignInFailure =
            error instanceof SignInFailed ? error.failure : SIGN_IN_FAILURE.UNFINISHED;
          return { failure };
        }),
      ),
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
        return yield* signInAnswer(session.beginSignIn(provider));
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
    snapshot: session.snapshot,
    signedIn: () => session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN,
    capabilitiesActive,
    token: session.token,
    credential: session.credential,
    sessionCredential: session.sessionCredential,
    sessionReplayState,
    accessState: Effect.sync(access.current),
    refreshAccess: Effect.asVoid(FiberSet.run(accessReads, access.refresh)),
    forgetAccess: access.forget,
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
