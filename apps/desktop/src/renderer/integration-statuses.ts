import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  signInBegun as begunSignIn,
  SIGN_IN,
  type SignIn,
  signInAfterRead,
  signInGraced,
} from "@luke/features/integration-sign-in";
import type { IntegrationStatusView } from "@luke/features/integration-view";
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
} from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Clock, Context, Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "./act";
import { rendererRuntime } from "./renderer-runtime";

/**
 * integration-statuses.ts -- where every one of the account's integrations stands, as every surface that draws one reads it.
 *
 * Read once for all of them, when first drawn and again whenever the window
 * is focused, which is how the developer comes back from a sign-in in the
 * browser. Settings › Integrations and the composer's list of servers draw
 * from it alike, so the two never disagree about a provider, and so does a
 * sign-in the window waits on (`integration-sign-in.ts`): begun here, ended
 * by the reads, given up on by any read past its own deadline, which the
 * window's focus shortens to a grace and one more read is armed for, and
 * cancelled here, which ends it
 * at the service so the provider no longer stands pending. A Cancel the
 * service answers connected came too late: the sign-in had finished, and
 * the row stands connected.
 *
 * A Luke account may hold more than one account at a provider, so every
 * read and change here names a server: one account by its connection name
 * (`notion`, `notion-2`), the first account's being its provider's, so a
 * provider with no account at all is named by the provider alone. An
 * account added from a surface stands pending under the name the service
 * answered for it until a read lists it.
 */

/** Where every provider and every account stands, as the surfaces share it. */
export interface IntegrationStatuses {
  /** Where one server stands (an account by its connection name, or a provider with none), or nothing until the first read answers. */
  readonly statusOf: (server: string) => IntegrationStatus | undefined;
  /** The accounts the Luke account holds at one provider, in their places' order; none where it holds none. */
  readonly accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  /** Whether another account may be added at the provider. */
  readonly canAdd: (provider: IntegrationProvider) => boolean;
  /** Whether the last read listed this account, which a sign-in begun for it again needs the service to still hold. */
  readonly listed: (server: string) => boolean;
  /** The sign-in to one server the window waits on, or last waited on, where one stands. */
  readonly signInOf: (server: string) => SignIn | undefined;
  /** Whether the last read answered nothing a surface can draw. */
  readonly readFailed: boolean;
  readonly read: () => Promise<void>;
  /** One server's standing as an answer of the host's left it, ahead of the next read. */
  readonly settle: (server: string, status: IntegrationStatus) => void;
  /** A sign-in begun: the server stands pending and the window waits on it, unless a connection already stands. */
  readonly signInBegun: (server: string) => void;
  /** Ends a sign-in waited on, at the service too, revoking nothing; answers whether the service answered. */
  readonly cancelSignIn: (server: string) => Promise<boolean>;
}

/** Where each server stands, by its name: every provider's own word, and every account's. */
type Standing = ReadonlyMap<string, IntegrationStatus>;

type SignIns = ReadonlyMap<string, SignIn>;

const NO_ACCOUNTS: readonly IntegrationAccount[] = [];

/** The provider a server is of: its own for a provider, its account's for a connection name. */
function providerOfServer(server: string): IntegrationProvider | undefined {
  return integrationConnectionOf(server)?.provider;
}

/** Where every server stands as one read answered it: each provider's word, then each account's over it. */
function standingOfRead(
  integrations: Readonly<Record<IntegrationProvider, IntegrationStatus>>,
  accounts: readonly IntegrationAccount[],
): Standing {
  return new Map([
    ...INTEGRATION_PROVIDER_LIST.map((provider) => [provider, integrations[provider]] as const),
    ...accounts.map((account) => [account.connection, account.status] as const),
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

/** Every server's sign-in as one read leaves it, with the sign-in failures it named. */
function signInsAfterRead(
  signIns: SignIns,
  standing: Standing,
  failures: readonly IntegrationSignInFailure[],
  read: { readonly mark: number; readonly at: number },
): SignIns {
  const next = new Map<string, SignIn>();
  const servers = new Set([...INTEGRATION_PROVIDER_LIST, ...standing.keys(), ...signIns.keys()]);
  for (const server of servers) {
    const named = failures.find((failure) => (failure.connection ?? failure.provider) === server);
    const signIn = signInAfterRead(signIns.get(server), {
      status: standing.get(server),
      failure:
        named === undefined
          ? undefined
          : {
              reason: named.reason,
              ...(named.message !== undefined ? { message: named.message } : undefined),
            },
      ...read,
    });
    if (signIn !== undefined) next.set(server, signIn);
  }
  return next;
}

/**
 * The sign-ins with the failures a read answered after a newer one named,
 * and nothing else of it. Note that such a read still says how a sign-in it
 * settled ended, because the service names that once, to the read that
 * settled it, and `signInAfterRead` already keeps a sign-in begun after the
 * read from its word; one the window no longer holds stays let go.
 */
function failuresAfterRead(
  signIns: SignIns,
  failures: readonly IntegrationSignInFailure[],
  read: { readonly mark: number; readonly at: number },
): SignIns {
  const next = new Map(signIns);
  for (const named of failures) {
    const server = named.connection ?? named.provider;
    // A sign-in a newer read let go of, as one that found it connected does, is not brought back.
    const standing = signIns.get(server);
    if (standing === undefined) continue;
    const signIn = signInAfterRead(standing, {
      status: INTEGRATION_STATUS.DISCONNECTED,
      failure: {
        reason: named.reason,
        ...(named.message !== undefined ? { message: named.message } : undefined),
      },
      ...read,
    });
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

export function useIntegrationStatuses(): IntegrationStatuses {
  const { act } = useAct();
  const [statuses, setStatuses] = useState<Standing | undefined>(undefined);
  const [accounts, setAccounts] = useState(NO_ACCOUNTS);
  const [addable, setAddable] = useState<readonly IntegrationProvider[]>([]);
  const [signIns, setSignIns] = useState(NO_SIGN_INS);
  const [readFailed, setReadFailed] = useState(false);
  const [waitAtom] = useState(signInWaitAtom);
  const [waited, arm] = useAtom(waitAtom);
  const services = useAtomValue(rendererRuntime);
  // The runtime's own clock, which a test turns by hand; its layer is built synchronously, so it is always there.
  const now = useCallback(
    () => Context.get(AsyncResult.getOrThrow(services), Clock.Clock).currentTimeMillisUnsafe(),
    [services],
  );
  // Note that the marks are a ref, because a read's answer compares its own
  // mark with the sign-ins' as it lands, which no render stands between.
  const marks = useRef(0);

  // Note that only the newest read sent is applied, because reads overlap, and one answered after it is from before it; but for the sign-in failures it alone was told.
  const reads = useRef(0);

  const read = useCallback(() => {
    marks.current += 1;
    const mark = marks.current;
    reads.current += 1;
    const sentAs = reads.current;
    setReadFailed(false);
    return act(ACT_KIND.INTEGRATIONS_STATUS).then(
      (answer) => {
        if (sentAs !== reads.current) {
          const failures = "failure" in answer ? [] : (answer.signInFailures ?? []);
          if (failures.length > 0) {
            const at = now();
            setSignIns((standing) => failuresAfterRead(standing, failures, { mark, at }));
          }
          return;
        }
        if ("failure" in answer) {
          setReadFailed(true);
          return;
        }
        const at = now();
        const read = standingOfRead(answer.integrations, answer.accounts ?? []);
        setStatuses(read);
        setAccounts(answer.accounts ?? NO_ACCOUNTS);
        setAddable(answer.addable ?? []);
        setSignIns((standing) =>
          signInsAfterRead(standing, read, answer.signInFailures ?? [], { mark, at }),
        );
      },
      () => {
        if (sentAs === reads.current) setReadFailed(true);
      },
    );
  }, [act, now]);

  useEffect(() => {
    void read();
  }, [read]);

  // A deadline passed: one more read, which gives up on a sign-in still pending past it.
  useEffect(() => {
    if (AsyncResult.isSuccess(waited) && !waited.waiting) void read();
  }, [waited, read]);

  const deadline = nextDeadline(signIns);
  useEffect(() => {
    if (deadline !== undefined) arm(deadline);
  }, [deadline, arm]);

  // The focus is the developer back from the browser, where a sign-in settles; one still pending is given a grace to land.
  useEffect(() => {
    const focused = () => {
      const at = now();
      setSignIns((standing) =>
        standing.size === 0
          ? standing
          : new Map([...standing].map(([server, signIn]) => [server, signInGraced(signIn, at)])),
      );
      void read();
    };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [read, now]);

  const settle = useCallback((server: string, status: IntegrationStatus) => {
    setStatuses((standing) => new Map(standing).set(server, status));
  }, []);

  // Note that a connection that stands is not waited on, because the service
  // answers it connected throughout, so no read could say how the sign-in ended.
  const signInBegun = useCallback(
    (server: string) => {
      if (statuses?.get(server) === INTEGRATION_STATUS.CONNECTED) return;
      marks.current += 1;
      const signIn = begunSignIn(marks.current, now(), !byGitHub(server));
      setStatuses((standing) => new Map(standing).set(server, INTEGRATION_STATUS.PENDING));
      setSignIns((standing) => new Map(standing).set(server, signIn));
    },
    [statuses, now],
  );

  // Note that GitHub's connect is ended here alone, because the service holds no sign-in of it.
  const cancelSignIn = useCallback(
    async (server: string): Promise<boolean> => {
      const provider = providerOfServer(server);
      if (provider === undefined) return false;
      const answer: IntegrationStatusView | undefined = byGitHub(server)
        ? { status: INTEGRATION_STATUS.DISCONNECTED }
        : await act(ACT_KIND.INTEGRATIONS_CANCEL, {
            provider,
            ...(server === provider ? undefined : { connection: server }),
          }).catch(() => undefined);
      if (answer === undefined || "failure" in answer) return false;
      settle(server, answer.status);
      // A first sign-in cancelled is gone from the service, so the account it was to be leaves the list, and Try again adds one.
      if (answer.status === INTEGRATION_STATUS.DISCONNECTED) {
        setAccounts((listed) => listed.filter((account) => account.connection !== server));
        // Note that a read follows, because the place it held is free again, which only the service's count says.
        void read();
      }
      // A sign-in begun again while the Cancel was out still stands, and is waited on for its own whole wait.
      if (answer.status === INTEGRATION_STATUS.PENDING) {
        marks.current += 1;
        const begun = begunSignIn(marks.current, now(), true);
        setSignIns((standing) => new Map(standing).set(server, begun));
        return true;
      }
      setSignIns((standing) => {
        const rest = new Map(standing);
        rest.delete(server);
        return rest;
      });
      return true;
    },
    [act, settle, now, read],
  );

  /**
   * Where a server stands: the last read's word, or, for an account the
   * window began a sign-in for that no read has listed, its sign-in's: pending
   * while it waits, else disconnected, its failure said on its line.
   */
  const statusOf = (server: string): IntegrationStatus | undefined => {
    const read = statuses?.get(server);
    if (read !== undefined) return read;
    const signIn = signIns.get(server);
    if (signIn === undefined) return undefined;
    return signIn.kind === SIGN_IN.WAITING
      ? INTEGRATION_STATUS.PENDING
      : INTEGRATION_STATUS.DISCONNECTED;
  };

  // Note that an account added from a surface stands as a row from its
  // sign-in alone, because no read lists it until it settles, one answered
  // late from before it began lists it not at all, and one whose first
  // sign-in failed has gone from the service while its failure is still said.
  // The provider's first name is the provider's own row while no account of
  // it is listed, and an account's row of its own beside one that is.
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
    readFailed,
    read,
    settle,
    signInBegun,
    cancelSignIn,
  };
}
