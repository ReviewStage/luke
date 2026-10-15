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
  type IntegrationProvider,
  type IntegrationSignInFailure,
  type IntegrationStatus,
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
 */

/** Where every provider stands, as the surfaces share it. */
export interface IntegrationStatuses {
  /** Where one provider stands, or nothing until the first read answers. */
  readonly statusOf: (provider: IntegrationProvider) => IntegrationStatus | undefined;
  /** The sign-in to one provider the window waits on, or last waited on, where one stands. */
  readonly signInOf: (provider: IntegrationProvider) => SignIn | undefined;
  /** Whether the last read answered nothing a surface can draw. */
  readonly readFailed: boolean;
  readonly read: () => Promise<void>;
  /** One provider's standing as an answer of the host's left it, ahead of the next read. */
  readonly settle: (provider: IntegrationProvider, status: IntegrationStatus) => void;
  /** A sign-in begun: the provider stands pending and the window waits on it, unless a connection already stands. */
  readonly signInBegun: (provider: IntegrationProvider) => void;
  /** Ends a sign-in waited on, at the service too, revoking nothing; answers whether the service answered. */
  readonly cancelSignIn: (provider: IntegrationProvider) => Promise<boolean>;
}

type Standing = Partial<Record<IntegrationProvider, IntegrationStatus>>;

type SignIns = ReadonlyMap<IntegrationProvider, SignIn>;

const NO_SIGN_INS: SignIns = new Map();

/** The one wait a surface holds, until a deadline on the runtime's clock: a write arms it afresh, cutting short the wait before it. */
const signInWaitAtom = () =>
  rendererRuntime.fn((deadline: number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.sleep(Duration.millis(Math.max(0, deadline - now))),
    ),
  );

/** Every provider's sign-in as one read leaves it, with the sign-in failures it named. */
function signInsAfterRead(
  signIns: SignIns,
  standing: Standing,
  failures: readonly IntegrationSignInFailure[],
  read: { readonly mark: number; readonly at: number },
): SignIns {
  const next = new Map<IntegrationProvider, SignIn>();
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    const named = failures.find((failure) => failure.provider === provider);
    const signIn = signInAfterRead(signIns.get(provider), {
      status: standing[provider],
      failure:
        named === undefined
          ? undefined
          : {
              reason: named.reason,
              ...(named.message !== undefined ? { message: named.message } : undefined),
            },
      ...read,
    });
    if (signIn !== undefined) next.set(provider, signIn);
  }
  return next;
}

/** Whether the provider is granted by the account's own GitHub, whose connect the service never answers pending. */
function byGitHub(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
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

  const read = useCallback(() => {
    marks.current += 1;
    const mark = marks.current;
    setReadFailed(false);
    return act(ACT_KIND.INTEGRATIONS_STATUS).then(
      (answer) => {
        if ("failure" in answer) {
          setReadFailed(true);
          return;
        }
        const at = now();
        setStatuses(answer.integrations);
        setSignIns((standing) =>
          signInsAfterRead(standing, answer.integrations, answer.signInFailures ?? [], {
            mark,
            at,
          }),
        );
      },
      () => setReadFailed(true),
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
          : new Map(
              [...standing].map(([provider, signIn]) => [provider, signInGraced(signIn, at)]),
            ),
      );
      void read();
    };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [read, now]);

  const settle = useCallback((provider: IntegrationProvider, status: IntegrationStatus) => {
    setStatuses((standing) => ({ ...standing, [provider]: status }));
  }, []);

  // Note that a connection that stands is not waited on, because the service
  // answers it connected throughout, so no read could say how the sign-in ended.
  const signInBegun = useCallback(
    (provider: IntegrationProvider) => {
      if (statuses?.[provider] === INTEGRATION_STATUS.CONNECTED) return;
      marks.current += 1;
      const signIn = begunSignIn(marks.current, now(), !byGitHub(provider));
      setStatuses((standing) => ({ ...standing, [provider]: INTEGRATION_STATUS.PENDING }));
      setSignIns((standing) => new Map(standing).set(provider, signIn));
    },
    [statuses, now],
  );

  // Note that GitHub's connect is ended here alone, because the service holds no sign-in of it.
  const cancelSignIn = useCallback(
    async (provider: IntegrationProvider): Promise<boolean> => {
      const answer: IntegrationStatusView | undefined = byGitHub(provider)
        ? { status: INTEGRATION_STATUS.DISCONNECTED }
        : await act(ACT_KIND.INTEGRATIONS_CANCEL, { provider }).catch(() => undefined);
      if (answer === undefined || "failure" in answer) return false;
      settle(provider, answer.status);
      // A sign-in begun again while the Cancel was out still stands, and is waited on for its own whole wait.
      if (answer.status === INTEGRATION_STATUS.PENDING) {
        marks.current += 1;
        const begun = begunSignIn(marks.current, now(), true);
        setSignIns((standing) => new Map(standing).set(provider, begun));
        return true;
      }
      setSignIns((standing) => {
        const rest = new Map(standing);
        rest.delete(provider);
        return rest;
      });
      return true;
    },
    [act, settle, now],
  );

  return {
    statusOf: (provider) => statuses?.[provider],
    signInOf: (provider) => signIns.get(provider),
    readFailed,
    read,
    settle,
    signInBegun,
    cancelSignIn,
  };
}
