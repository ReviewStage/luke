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
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Context, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useContext, useEffect, useState } from "react";
import { actMutation } from "./act-mutations.js";
import { integrationsQuery, integrationsRetryMutation } from "./live-reads.js";
import { rendererRuntime } from "./renderer-runtime.js";
import { appStateQuery } from "./use-app-state.js";

export interface IntegrationStatuses {
  readonly statusOf: (server: string) => IntegrationStatus | undefined;
  readonly accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  readonly canAdd: (provider: IntegrationProvider) => boolean;
  readonly listed: (server: string) => boolean;
  readonly signInOf: (server: string) => SignIn | undefined;
  readonly readFailed: boolean;
  readonly read: () => Promise<void>;
  readonly signInBegun: (server: string) => void;
  readonly cancelSignIn: (server: string) => Promise<boolean>;
}

type Standing = ReadonlyMap<string, IntegrationStatus>;

type SignIns = ReadonlyMap<string, SignIn>;

const NO_ACCOUNTS: readonly IntegrationAccount[] = [];

const NO_PROVIDERS: readonly IntegrationProvider[] = [];

function providerOfServer(server: string): IntegrationProvider | undefined {
  return integrationConnectionOf(server)?.provider;
}

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

const signInWaitAtom = () =>
  rendererRuntime.fn((deadline: number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.sleep(Duration.millis(Math.max(0, deadline - now))),
    ),
  );

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

function byGitHub(server: string): boolean {
  const provider = providerOfServer(server);
  return (
    provider !== undefined && INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN
  );
}

function nextDeadline(signIns: SignIns): number | undefined {
  const deadlines = [...signIns.values()].flatMap((signIn) =>
    signIn.kind === SIGN_IN.WAITING ? [signIn.deadline] : [],
  );
  return deadlines.length === 0 ? undefined : Math.min(...deadlines);
}

interface Book {
  readonly signIns: SignIns;
}

const NO_BOOK: Book = { signIns: NO_SIGN_INS };

interface Ledger {
  marks: number;
  told: { readonly answer: IntegrationStatusesAnswer; readonly standing: Standing } | undefined;
}

interface Shared {
  readonly book: Atom.Writable<Book>;
  readonly ledger: Atom.Atom<Ledger>;
}

const sharedOf = Atom.family(
  (_owner: string | null): Shared => ({
    book: Atom.make(NO_BOOK).pipe(Atom.setIdleTTL(0)),
    ledger: Atom.make((): Ledger => ({ marks: 0, told: undefined })).pipe(Atom.setIdleTTL(0)),
  }),
);

const selectOwner = ({ account }: AppStateSnapshot): string | null =>
  account.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? null) : null;

function withSignIns(book: Book, change: (signIns: SignIns) => SignIns): Book {
  return { ...book, signIns: change(book.signIns) };
}

export function useIntegrationStatuses(): IntegrationStatuses {
  const { mutateAsync: cancelIntegration } = useMutation(actMutation(ACT_KIND.INTEGRATIONS_CANCEL));
  const registry = useContext(RegistryContext);
  const owner = useQuery({ ...appStateQuery, select: selectOwner }).data ?? null;
  const held = useQuery(integrationsQuery(owner ?? undefined));
  const { mutateAsync: retryIntegrations } = useMutation(integrationsRetryMutation());
  const answer = held.data;
  const shared = sharedOf(owner);
  const { signIns } = useAtomValue(shared.book);
  const ledger = useAtomValue(shared.ledger);
  const [waitAtom] = useState(signInWaitAtom);
  const [waited, arm] = useAtom(waitAtom);
  const services = useAtomValue(rendererRuntime);
  const now = useCallback(
    () => Context.get(AsyncResult.getOrThrow(services), Clock.Clock).currentTimeMillisUnsafe(),
    [services],
  );
  const change = useCallback(
    (next: (book: Book) => Book) => registry.update(shared.book, next),
    [registry, shared],
  );

  const tell = useCallback(
    (latest: IntegrationStatusesAnswer, deadline: boolean) => {
      const before = ledger.told?.standing;
      const standing = ledger.told?.answer === latest ? before : standingOfRead(latest);
      if (standing === undefined) return;
      ledger.told = { answer: latest, standing };
      ledger.marks += 1;
      const read = { mark: ledger.marks, at: now() };
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

  useEffect(() => {
    if (answer !== undefined && ledger.told?.answer !== answer) tell(answer, false);
  }, [answer, ledger, tell]);

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

  const signInBegun = useCallback(
    (server: string) => {
      if (ledger.told?.standing.get(server) === INTEGRATION_STATUS.CONNECTED) return;
      ledger.marks += 1;
      const signIn = begunSignIn(ledger.marks, now(), !byGitHub(server));
      change((book) => withSignIns(book, (held) => new Map(held).set(server, signIn)));
    },
    [ledger, now, change],
  );

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
      if (canceled.status === INTEGRATION_STATUS.PENDING) {
        ledger.marks += 1;
        const begun = begunSignIn(ledger.marks, now(), true);
        change((book) => withSignIns(book, (held) => new Map(held).set(server, begun)));
      }
      return true;
    },
    [cancelIntegration, registry, shared, now, change, ledger],
  );

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
    readFailed: held.isError,
    read: () =>
      retryIntegrations().then(
        () => undefined,
        () => undefined,
      ),
    signInBegun,
    cancelSignIn,
  };
}
