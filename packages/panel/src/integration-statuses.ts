import { useAtom, useAtomValue } from "@effect/atom-react";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import {
  signInBegun as begunSignIn,
  SIGN_IN,
  type SignIn,
  signInAfterRead,
} from "@repo/features/integration-sign-in";
import type { IntegrationStatusView } from "@repo/features/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { Clock, Context, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useContext, useEffect, useState } from "react";
import { actMutation } from "./act-mutations.js";
import { rendererRuntime } from "./renderer-runtime.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "./use-host-read.js";

/**
 * integration-statuses.ts -- where every one of the account's integrations stands, as every surface that draws one reads it.
 *
 * The host holds the account's integrations while any surface draws one
 * (`LIVE_READ.INTEGRATIONS`), followed live, so a sign-in the developer
 * finishes in the browser draws on every surface with no focus and no read
 * of the window's own; the host settles one that stands pending as it
 * waits. Settings › Integrations, the composer's list of servers, a
 * server's card, onboarding's tools step, and every other surface read that
 * one slice, and share one book beside it for the account signed in: the
 * sign-ins the window waits on (`integration-sign-in.ts`), begun here, ended
 * as the slice moves for their server, given up on past their own deadline,
 * and canceled here, which ends one at the service so the provider no
 * longer stands pending. A Connect, a Cancel, and a Disconnect are answered
 * only once the slice carries them, so nothing of them is drawn over it. A
 * Cancel the service answers connected came too late: the sign-in had
 * finished, and the row stands connected.
 *
 * A user account may hold more than one account at a provider, so every
 * read and change here names a server: one account by its connection name
 * (`notion`, `notion-2`), the first account's being its provider's, so a
 * provider with no account at all is named by the provider alone. An
 * account added from a surface stands pending under the name the service
 * answered for it until the slice lists it.
 */

/** Where every provider and every account stands, as the surfaces share it. */
export interface IntegrationStatuses {
  /** Where one server stands (an account by its connection name, or a provider with none), or nothing until the host first answers. */
  readonly statusOf: (server: string) => IntegrationStatus | undefined;
  /** The accounts the user account holds at one provider, in their places' order; none where it holds none. */
  readonly accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  /** Whether another account may be added at the provider. */
  readonly canAdd: (provider: IntegrationProvider) => boolean;
  /** Whether the host's read lists this account, which a sign-in begun for it again needs the service to still hold. */
  readonly listed: (server: string) => boolean;
  /** The sign-in to one server the window waits on, or last waited on, where one stands. */
  readonly signInOf: (server: string) => SignIn | undefined;
  /** Whether the host's read failed before it ever answered anything a surface can draw. */
  readonly readFailed: boolean;
  /** The host's read asked again at once, as Try again asks. */
  readonly read: () => Promise<void>;
  /** A sign-in begun: the server stands pending and the window waits on it, unless a connection already stands. */
  readonly signInBegun: (server: string) => void;
  /** Ends a sign-in waited on, at the service too, revoking nothing; answers whether the service answered. */
  readonly cancelSignIn: (server: string) => Promise<boolean>;
}

/** Where each server stands, by its name: every provider's own word, and every account's. */
type Standing = ReadonlyMap<string, IntegrationStatus>;

type SignIns = ReadonlyMap<string, SignIn>;

const NO_ACCOUNTS: readonly IntegrationAccount[] = [];

const NO_PROVIDERS: readonly IntegrationProvider[] = [];

/** The provider a server is of: its own for a provider, its account's for a connection name. */
function providerOfServer(server: string): IntegrationProvider | undefined {
  return integrationConnectionOf(server)?.provider;
}

/** Where every server stands as the host's read holds it: each provider's word, then each account's over it. */
function standingOfRead(answer: IntegrationStatusesAnswer): Standing {
  return new Map([
    ...INTEGRATION_PROVIDER_LIST.map(
      (provider) => [provider, answer.integrations[provider]] as const,
    ),
    ...(answer.accounts ?? NO_ACCOUNTS).map(
      (account) => [account.connection, account.status] as const,
    ),
  ]);
}

const NO_SIGN_INS: SignIns = new Map();

/** The one wait a surface holds, until a deadline on the runtime's clock: a write arms it afresh, cutting short the wait before it. */
const signInWaitAtom = () =>
  rendererRuntime.fn((deadline: number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.sleep(Duration.millis(Math.max(0, deadline - now))),
    ),
  );

/**
 * Every server's sign-in as the host's read leaves it, with the sign-in
 * failures it named, read at `read`'s mark and instant. Note that a server
 * whose standing did not move since the read before (`before`), and that it
 * names no failure of, is passed over, unless the deadline asked (`before`
 * none), because the slice is laid again whenever anything of it moves,
 * GitHub's standing among it, which may land before a sign-in just begun
 * reaches it: that is no word on how the sign-in went.
 */
function signInsAfterRead(
  signIns: SignIns,
  standing: Standing,
  failures: readonly IntegrationSignInFailure[],
  before: Standing | undefined,
  read: { readonly mark: number; readonly at: number },
): SignIns {
  const next = new Map<string, SignIn>();
  const servers = new Set([...INTEGRATION_PROVIDER_LIST, ...standing.keys(), ...signIns.keys()]);
  for (const server of servers) {
    const status = standing.get(server);
    const held = signIns.get(server);
    const named = failures.find((failure) => (failure.connection ?? failure.provider) === server);
    const failure =
      named === undefined
        ? undefined
        : {
            reason: named.reason,
            ...(named.message !== undefined ? { message: named.message } : undefined),
          };
    const signIn =
      failure === undefined && before !== undefined && before.get(server) === status
        ? held
        : signInAfterRead(held, { status, failure, ...read });
    if (signIn !== undefined) next.set(server, signIn);
  }
  return next;
}

/** Whether the server is granted by the account's own GitHub, whose connect the service never answers pending. */
function byGitHub(server: string): boolean {
  const provider = providerOfServer(server);
  return (
    provider !== undefined && INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
  );
}

/** The earliest deadline of a sign-in waited on, which the wait is armed for whenever it moves. */
function nextDeadline(signIns: SignIns): number | undefined {
  const deadlines = [...signIns.values()].flatMap((signIn) =>
    signIn.kind === SIGN_IN.WAITING ? [signIn.deadline] : [],
  );
  return deadlines.length === 0 ? undefined : Math.min(...deadlines);
}

/** What every surface shares of one account's integrations beside the slice: the sign-ins the window waits on. */
interface Book {
  readonly signIns: SignIns;
}

const NO_BOOK: Book = { signIns: NO_SIGN_INS };

/**
 * What the book keeps beside it, which no surface draws: the marks, and the
 * host's read the sign-ins were last told of with where it stood. Note that
 * it is a mutable record, because every surface hears the slice move and
 * the first to tell the sign-ins of it tells them for all, which no render
 * stands between.
 */
interface Ledger {
  marks: number;
  told: { readonly answer: IntegrationStatusesAnswer; readonly standing: Standing } | undefined;
}

/**
 * One account's book and ledger, each made afresh when a surface first
 * draws it after none did, and let go with the last surface that drew it,
 * so a window with no integration on screen keeps nothing. Note that neither
 * lingers once let go, because the next account's surfaces, or a test's,
 * must never meet what the last left.
 */
interface Shared {
  readonly book: Atom.Writable<Book>;
  readonly ledger: Atom.Atom<Ledger>;
}

/** Each signed-in account's book apart, so a sign-out leaves nothing of one account's integrations to the next. */
const sharedOf = Atom.family(
  (_owner: string | null): Shared => ({
    book: Atom.make(NO_BOOK).pipe(Atom.setIdleTTL(0)),
    ledger: Atom.make((): Ledger => ({ marks: 0, told: undefined })).pipe(Atom.setIdleTTL(0)),
  }),
);

/** The account signed in to the window, by its id, which the host holds its integrations by; none while signed out. */
const ownerAtom: Atom.Atom<string | null> = Atom.map(APP_SLICE.ACCOUNT, (account) =>
  account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? null) : null,
);

/** The book with its sign-ins as `change` leaves them. */
function withSignIns(book: Book, change: (signIns: SignIns) => SignIns): Book {
  return { ...book, signIns: change(book.signIns) };
}

/**
 * Where every integration stands, from the slice the host holds for the
 * account signed in and the one book every surface of the window shares
 * beside it: a sign-in begun, or a Cancel, on one surface
 * is what every other draws at once.
 */
export function useIntegrationStatuses(): IntegrationStatuses {
  const { mutateAsync: cancelIntegration } = useMutation(actMutation(ACT_KIND.INTEGRATIONS_CANCEL));
  const registry = useContext(RegistryContext);
  const owner = useAppSlice(ownerAtom);
  const held = useHostRead(LIVE_READ.INTEGRATIONS, owner ?? undefined);
  const answer = held.rows;
  const shared = sharedOf(owner);
  const { signIns } = useAtomValue(shared.book);
  const ledger = useAtomValue(shared.ledger);
  const [waitAtom] = useState(signInWaitAtom);
  const [waited, arm] = useAtom(waitAtom);
  const services = useAtomValue(rendererRuntime);
  // The runtime's own clock, which a test turns by hand; its layer is built synchronously, so it is always there.
  const now = useCallback(
    () => Context.get(AsyncResult.getOrThrow(services), Clock.Clock).currentTimeMillisUnsafe(),
    [services],
  );
  const change = useCallback(
    (next: (book: Book) => Book) => registry.update(shared.book, next),
    [registry, shared],
  );

  /** The sign-ins told where the host's read stands now: of what moved in it, or of every server where the deadline asks. */
  const tell = useCallback(
    (latest: IntegrationStatusesAnswer, deadline: boolean) => {
      const before = ledger.told?.standing;
      const standing = ledger.told?.answer === latest ? before : standingOfRead(latest);
      if (standing === undefined) return;
      ledger.told = { answer: latest, standing };
      ledger.marks += 1;
      const read = { mark: ledger.marks, at: now() };
      // Note that the failures a read names are told once, by the read that carried them, never again at a deadline.
      const failures = deadline ? [] : (latest.signInFailures ?? []);
      change((book) => ({
        signIns: signInsAfterRead(
          book.signIns,
          standing,
          failures,
          deadline ? undefined : before,
          read,
        ),
      }));
    },
    [ledger, now, change],
  );

  // The host's read moved: the first surface to hear it tells the sign-ins for all of them.
  useEffect(() => {
    if (answer !== undefined && ledger.told?.answer !== answer) tell(answer, false);
  }, [answer, ledger, tell]);

  // A deadline passed: the sign-ins told where the read stands now, which gives up on one still pending past it.
  useEffect(() => {
    if (!AsyncResult.isSuccess(waited) || waited.waiting) return;
    const latest = ledger.told?.answer;
    if (latest !== undefined) tell(latest, true);
  }, [waited, ledger, tell]);

  const deadline = nextDeadline(signIns);
  useEffect(() => {
    if (deadline !== undefined) arm(deadline);
  }, [deadline, arm]);

  const standing = answer === undefined ? undefined : standingOfRead(answer);

  // Note that a connection that stands is not waited on, because the service
  // answers it connected throughout, so no read could say how the sign-in ended.
  const signInBegun = useCallback(
    (server: string) => {
      if (ledger.told?.standing.get(server) === INTEGRATION_STATUS.CONNECTED) return;
      ledger.marks += 1;
      const signIn = begunSignIn(ledger.marks, now(), !byGitHub(server));
      change((book) => withSignIns(book, (held) => new Map(held).set(server, signIn)));
    },
    [ledger, now, change],
  );

  /**
   * Ends a sign-in waited on: let go of at once, so the read the Cancel
   * moves never says it failed, and put back where the service did not
   * answer, unless one was begun meanwhile. Note that GitHub's connect is
   * ended here alone, because the service holds no sign-in of it.
   */
  const cancelSignIn = useCallback(
    async (server: string): Promise<boolean> => {
      const provider = providerOfServer(server);
      if (provider === undefined) return false;
      const waited = registry.get(shared.book).signIns.get(server);
      change((book) =>
        withSignIns(book, (held) => {
          const rest = new Map(held);
          rest.delete(server);
          return rest;
        }),
      );
      const canceled: IntegrationStatusView | undefined = byGitHub(server)
        ? { status: INTEGRATION_STATUS.DISCONNECTED }
        : await cancelIntegration({
            provider,
            ...(server === provider ? undefined : { connection: server }),
          }).catch(() => undefined);
      if (canceled === undefined || "failure" in canceled) {
        if (waited !== undefined) {
          change((book) =>
            withSignIns(book, (held) =>
              held.has(server) ? held : new Map(held).set(server, waited),
            ),
          );
        }
        return false;
      }
      // A sign-in begun again while the Cancel was out still stands, and is waited on for its own whole wait.
      if (canceled.status === INTEGRATION_STATUS.PENDING) {
        ledger.marks += 1;
        const begun = begunSignIn(ledger.marks, now(), true);
        change((book) => withSignIns(book, (held) => new Map(held).set(server, begun)));
      }
      return true;
    },
    [cancelIntegration, registry, shared, now, change, ledger],
  );

  /**
   * Where a server stands: the host's read's word, or, for an account the window began a sign-in for that the read does
   * not list, its sign-in's: pending while it waits, else disconnected, its
   * failure said on its line.
   */
  const statusOf = (server: string): IntegrationStatus | undefined => {
    const read = standing?.get(server);
    if (read !== undefined) return read;
    const signIn = signIns.get(server);
    if (signIn === undefined) return undefined;
    return signIn.kind === SIGN_IN.WAITING
      ? INTEGRATION_STATUS.PENDING
      : INTEGRATION_STATUS.DISCONNECTED;
  };

  const accounts = answer?.accounts ?? NO_ACCOUNTS;
  const addable = answer?.addable ?? NO_PROVIDERS;

  // Note that an account added from a surface stands as a row from its
  // sign-in alone, because the host's read lists it only once the service
  // holds it, and one whose first sign-in failed has gone from the service
  // while its failure is still said. The provider's first name is the
  // provider's own row while no account of it is listed, and an account's
  // row of its own beside one that is.
  const unlisted = [...signIns.keys()].flatMap((server): IntegrationAccount[] => {
    const added = integrationConnectionOf(server);
    if (added === undefined) return [];
    if (accounts.some((account) => account.connection === server)) return [];
    if (added.place === 1 && !accounts.some((account) => account.provider === added.provider)) {
      return [];
    }
    return [
      {
        provider: added.provider,
        connection: server,
        status: statusOf(server) ?? INTEGRATION_STATUS.PENDING,
      },
    ];
  });

  return {
    statusOf,
    listed: (server) => accounts.some((account) => account.connection === server),
    accountsOf: (provider) =>
      [...accounts, ...unlisted]
        .filter((account) => account.provider === provider)
        .toSorted(
          (a, b) =>
            (integrationConnectionOf(a.connection)?.place ?? 0) -
            (integrationConnectionOf(b.connection)?.place ?? 0),
        ),
    canAdd: (provider) => addable.includes(provider),
    signInOf: (server) => signIns.get(server),
    readFailed: held.status === HOST_READ_STATUS.FAILED,
    read: async () => held.retry(),
    signInBegun,
    cancelSignIn,
  };
}
