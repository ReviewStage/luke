import { accountGateOpen, SignInFailed } from "@repo/credentials";
import {
  ACCOUNT_STATUS,
  type AccountSnapshot,
  isAccountProvider,
  signedInAccountId,
} from "@repo/credentials/snapshot";
import type { AccountToken, CallCredential } from "@repo/features";
import { PRODUCT_ACCOUNT_ACTION, PRODUCT_EVENT } from "@repo/features/analytics";
import { SIGN_IN_FAILURE, type SignInFailure } from "@repo/features/words";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, invalid, RefusedRefusal } from "@repo/gateway";
import { Effect, FiberSet, Result, type Scope, Stream } from "effect";
import { AccountAccessClient, accountAccessHolder } from "./account-access-client.js";
import type { AccountSession } from "./account-source.js";
import type { AppAccessSlice, SessionReplayState } from "./app-state.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AccountSource } from "./effect/seams.js";
import type { HostMethodTable } from "./gateway-door.js";

const SIGN_IN_REFUSED = "the sign-in did not finish";
const SIGN_OUT_REFUSED = "the sign-out did not finish";
const DELETE_REFUSED = "the account was not deleted";
const SUPPORT_ACCESS_REFUSED = "support access was not changed";

interface AccountLinks {
  readonly startCapabilities: Effect.Effect<void>;
  readonly stopCapabilities: Effect.Effect<void>;
}

export interface AccountComposer extends Composer {
  readonly session: AccountSession;
  snapshot: () => AccountSnapshot;
  signedIn: () => boolean;
  capabilitiesActive: () => boolean;
  readonly token: AccountToken;
  readonly credential: CallCredential;
  readonly sessionCredential: CallCredential;
  sessionReplayState: Effect.Effect<SessionReplayState>;
  accessState: Effect.Effect<AppAccessSlice>;
  refreshAccess: Effect.Effect<void>;
  forgetAccess: Effect.Effect<void>;
  link: (links: AccountLinks) => Effect.Effect<void>;
}

interface AccountDependencies {
  settings: SettingsComposer;
}

export const composeAccount = Effect.fn("host/composeAccount")(function* (
  dependencies: AccountDependencies,
): Effect.fn.Return<AccountComposer, never, HostKernelTag | AccountSource | Scope.Scope> {
  const { settings } = dependencies;
  const kernel = yield* HostKernelTag;
  const source = yield* AccountSource;
  const { runMode, report } = kernel;
  const late = yield* lateService<AccountLinks>();

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

  let previousAccount: AccountSnapshot = { status: ACCOUNT_STATUS.SIGNED_OUT };

  const accessClient = new AccountAccessClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    credential: session.credential,
    sessionCredential: session.sessionCredential,
  });
  const access = accountAccessHolder({
    client: accessClient,
    accountKey: () => {
      const account = session.snapshot();
      return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
    },
    publish: (next) => kernel.emit(GATEWAY_EVENT.ACCOUNT_ACCESS_CHANGED, carried(next)),
  });
  const accessReads = yield* FiberSet.make();

  const onAccountChange = Effect.fnUntraced(function* (
    next: AccountSnapshot,
  ): Effect.fn.Return<void> {
    const signedIn = next.status === ACCOUNT_STATUS.SIGNED_IN;
    const wasSignedIn = previousAccount.status === ACCOUNT_STATUS.SIGNED_IN;
    const previousAccountKey =
      previousAccount.status === ACCOUNT_STATUS.SIGNED_IN ? previousAccount.email : undefined;
    const nextAccountKey = signedIn ? next.email : undefined;
    const [previousId, nextId] = [signedInAccountId(previousAccount), signedInAccountId(next)];
    const anotherPerson =
      wasSignedIn &&
      signedIn &&
      (previousId !== undefined && nextId !== undefined
        ? previousId !== nextId
        : previousAccountKey !== nextAccountKey);
    previousAccount = next;
    if (previousAccountKey !== nextAccountKey) settings.forgetAccountPreferenceHydration();
    if (anotherPerson) yield* Effect.flatMap(late.value, (links) => links.stopCapabilities);
    if (wasSignedIn && signedIn && previousAccountKey !== nextAccountKey && !anotherPerson) {
      yield* settings.reconcileAccountPreferences();
    }
    if (signedIn && !wasSignedIn) sessionReplayEndedByDeletion = false;
    kernel.emit(GATEWAY_EVENT.ACCOUNT_CHANGED, carried(next));
    yield* access.accountChanged;
    yield* settings.emitSettings();
    yield* emitSessionReplay;
    if (signedIn && !wasSignedIn) settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    if (anotherPerson) yield* Effect.flatMap(late.value, (links) => links.startCapabilities);
  });

  function capabilitiesActive(): boolean {
    return accountGateOpen(runMode, session.snapshot().status === ACCOUNT_STATUS.SIGNED_IN);
  }

  let sessionReplayEndedByDeletion = false;

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

  const emitSessionReplay: Effect.Effect<void> = Effect.map(sessionReplayState, (replay) => {
    kernel.emit(GATEWAY_EVENT.SESSION_REPLAY_CHANGED, carried(replay));
  });

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

  const recordSignInStart: Effect.Effect<void> = Effect.suspend(() => {
    settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
      account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_START,
    });
    return settings.flushProductEvents;
  });

  const recordReturnFromSignIn = (launched: AccountSnapshot): void => {
    settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_ACTION, {
      account_action: PRODUCT_ACCOUNT_ACTION.SIGN_IN_START,
    });
    if (launched.status === ACCOUNT_STATUS.SIGNED_IN) {
      settings.recordProductEvent(PRODUCT_EVENT.ACCOUNT_SIGN_IN, {});
    }
  };

  const methods: HostMethodTable = {
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
        sessionReplayEndedByDeletion = true;
        yield* Effect.forkDetach(emitSessionReplay);
        return { account: carried(snapshot) };
      }),
    [GATEWAY_METHOD.ACCOUNT_SUPPORT_ACCESS]: (params) =>
      Effect.gen(function* () {
        const grant = params.grant;
        if (typeof grant !== "boolean") return yield* invalid("grant is true or false");
        const pressedFor = signedInAccountId(session.snapshot());
        yield* session.confirmAccount?.() ?? Effect.void;
        if (pressedFor === undefined || signedInAccountId(session.snapshot()) !== pressedFor) {
          return yield* new RefusedRefusal({ message: SUPPORT_ACCESS_REFUSED });
        }
        const written = yield* Effect.result(accessClient.writeSupportAccess(grant));
        if (Result.isFailure(written)) {
          report(`${SUPPORT_ACCESS_REFUSED}: ${written.failure._tag}`);
          return yield* new RefusedRefusal({ message: SUPPORT_ACCESS_REFUSED });
        }
        yield* access.refresh;
        return { supportAccessUntil: written.success.supportAccessUntil };
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
    lifetime: Effect.gen(function* () {
      const changes = yield* session.changes;
      previousAccount = yield* session.initialize;
      if (session.returnedFromSignIn && (yield* session.returnedFromSignIn)) {
        recordReturnFromSignIn(previousAccount);
      }
      yield* Effect.forkScoped(Stream.runForEach(changes, onAccountChange));
    }),
  };
});
