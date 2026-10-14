import { useAtom } from "@effect/atom-react";
import type { IntegrationStatusView } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { type Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import {
  SIGN_IN,
  SIGN_IN_GRACE,
  SIGN_IN_WAIT,
  type SignIn,
  signInAfterRead,
} from "./integration-sign-in";
import { rendererRuntime } from "./renderer-runtime";

/**
 * integration-statuses.ts -- where every one of the account's integrations stands, as every surface that draws one reads it.
 *
 * Read once for all of them, when first drawn and again whenever the window
 * is focused, which is how the developer comes back from a sign-in in the
 * browser. Settings › Integrations and the composer's list of servers draw
 * from it alike, so the two never disagree about a provider, and so does a
 * sign-in the window waits on (`integration-sign-in.ts`): begun here, ended
 * by the reads, given up on by one more read at the end of its wait, which
 * the window's focus shortens to a grace, and cancelled here, which ends it
 * at the service so the provider no longer stands pending.
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
  /** Ends a sign-in waited on, at the service too; answers whether the service ended it. */
  readonly cancelSignIn: (provider: IntegrationProvider) => Promise<boolean>;
}

type Standing = Partial<Record<IntegrationProvider, IntegrationStatus>>;

type SignIns = ReadonlyMap<IntegrationProvider, SignIn>;

const NO_SIGN_INS: SignIns = new Map();

/** The one wait a surface holds: a write arms it afresh, cutting short the wait before it. */
const signInWaitAtom = () => rendererRuntime.fn((wait: Duration.Duration) => Effect.sleep(wait));

/** Every provider's sign-in as one read leaves it. */
function signInsAfterRead(
  signIns: SignIns,
  standing: Standing,
  read: { readonly mark: number; readonly due: boolean },
): SignIns {
  const next = new Map<IntegrationProvider, SignIn>();
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    const signIn = signInAfterRead(signIns.get(provider), { status: standing[provider], ...read });
    if (signIn !== undefined) next.set(provider, signIn);
  }
  return next;
}

/** The latest mark a sign-in waited on began at, which arms the wait anew whenever it moves. */
function latestWait(signIns: SignIns): number | undefined {
  const since = [...signIns.values()].flatMap((signIn) =>
    signIn.kind === SIGN_IN.WAITING ? [signIn.since] : [],
  );
  return since.length === 0 ? undefined : Math.max(...since);
}

export function useIntegrationStatuses(): IntegrationStatuses {
  const { act } = useAct();
  const [statuses, setStatuses] = useState<Standing | undefined>(undefined);
  const [signIns, setSignIns] = useState(NO_SIGN_INS);
  const [readFailed, setReadFailed] = useState(false);
  const [waitAtom] = useState(signInWaitAtom);
  const [waited, arm] = useAtom(waitAtom);
  // Note that the marks are a ref, because a read's answer compares its own
  // mark with the sign-ins' as it lands, which no render stands between.
  const marks = useRef(0);

  const readOnce = useCallback(
    (due: boolean) => {
      marks.current += 1;
      const mark = marks.current;
      setReadFailed(false);
      return act(ACT_KIND.INTEGRATIONS_STATUS).then(
        (answer) => {
          if ("failure" in answer) {
            setReadFailed(true);
            return;
          }
          setStatuses(answer.integrations);
          setSignIns((standing) => signInsAfterRead(standing, answer.integrations, { mark, due }));
        },
        () => setReadFailed(true),
      );
    },
    [act],
  );
  const read = useCallback(() => readOnce(false), [readOnce]);

  useEffect(() => {
    void read();
  }, [read]);

  // The wait ran out: one more read, which gives up on a sign-in still pending.
  useEffect(() => {
    if (AsyncResult.isSuccess(waited) && !waited.waiting) void readOnce(true);
  }, [waited, readOnce]);

  // Each sign-in begun, or found pending, waits its whole wait afresh.
  const waitingSince = latestWait(signIns);
  useEffect(() => {
    if (waitingSince !== undefined) arm(SIGN_IN_WAIT);
  }, [waitingSince, arm]);

  // The focus is the developer back from the browser, where a sign-in settles; one still pending is given a grace to land.
  const waiting = waitingSince !== undefined;
  useEffect(() => {
    const focused = () => {
      void read();
      if (waiting) arm(SIGN_IN_GRACE);
    };
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [read, waiting, arm]);

  const settle = useCallback((provider: IntegrationProvider, status: IntegrationStatus) => {
    setStatuses((standing) => ({ ...standing, [provider]: status }));
  }, []);

  // Note that a connection that stands is not waited on, because the service
  // answers it connected throughout, and a Cancel there would disconnect it.
  const signInBegun = useCallback(
    (provider: IntegrationProvider) => {
      if (statuses?.[provider] === INTEGRATION_STATUS.CONNECTED) return;
      marks.current += 1;
      const since = marks.current;
      setStatuses((standing) => ({ ...standing, [provider]: INTEGRATION_STATUS.PENDING }));
      setSignIns((standing) => new Map(standing).set(provider, { kind: SIGN_IN.WAITING, since }));
    },
    [statuses],
  );

  const cancelSignIn = useCallback(
    async (provider: IntegrationProvider): Promise<boolean> => {
      const answer: IntegrationStatusView | undefined = await act(
        ACT_KIND.INTEGRATIONS_DISCONNECT,
        { provider },
      ).catch(() => undefined);
      if (answer === undefined || "failure" in answer) return false;
      settle(provider, answer.status);
      setSignIns((standing) => {
        const rest = new Map(standing);
        rest.delete(provider);
        return rest;
      });
      return true;
    },
    [act, settle],
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
