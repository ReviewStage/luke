import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_HTTP_STATUS } from "../../server/admin/http";
import { SIGN_IN_CHOSEN } from "./prefs";

/**
 * What one admin read resolved to: the gate's refusals stay distinct here, and
 * a ready answer carries the one failure a later refresh may have landed on
 * it. `missing` reaches only the endpoints that answer 404, and the screens
 * whose endpoint never does word it as their own failure.
 */
export type AdminRead<T> =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "error"; detail: string }
  | { status: "ready"; value: T; question: string; refreshFailure: string | undefined };

/** Reads a 200's body. Every other status is the hook's, so this never branches. */
export type AdminReader<T> = (response: Response) => Promise<T>;

export interface AdminReadOptions<T> {
  /** False parks the read: no fetch, no cancel, the state stands. Default true. */
  enabled?: boolean;
  /**
   * Delays a path changed after the first read by this many milliseconds. The
   * first read and every `reload()` are immediate; a path that changes again
   * inside the window replaces the pending one.
   */
  debounceMs?: number;
  /**
   * Whether a shown answer survives the start of a read. A refresh keeps the
   * page it is refreshing; the detail screens pass an identity check, because
   * the browser's own back and forward can swap the subject without passing
   * the view above, and one subject's numbers must not stand dimmed behind
   * another's read. The default keeps any ready answer.
   */
  keeps?: (shown: T) => boolean;
}

export interface AdminReadHandle<T> {
  state: AdminRead<T>;
  /** True while a request is in flight, whatever `state` shows. */
  refreshing: boolean;
  /** Re-runs the read now, dropping any open one. */
  reload: () => void;
  /**
   * Drops the open read, clears refreshing, awaits the withdrawal, and lands
   * signed out. The read is dropped first: an answer that left carrying the
   * old cookie would otherwise resolve behind the sign-out and put the page
   * back up on a consent that was just withdrawn.
   */
  withdraw: (signOut: () => Promise<void>) => Promise<void>;
  /** Redraws a shown answer in place; a no-op on any other status. */
  revise: (change: (value: T) => T) => void;
}

/** The detail every failed read that is not the endpoint's own carries. */
export const ADMIN_READ_ERROR = {
  UNAVAILABLE: "The service did not answer. It may be briefly unavailable — try again shortly.",
  PROTECTED:
    "The request was redirected before it reached the dashboard. A preview deployment behind Vercel Deployment Protection intercepts the API call; disable protection for this deployment, or use a production URL.",
} as const;

/**
 * One settled response as a state, the hook's whole non-React half, so the
 * state machine is testable without a DOM.
 */
export async function adminReadFromResponse<T>(
  response: Response,
  reader: AdminReader<T>,
  question: string,
  errorDetail: string,
): Promise<AdminRead<T>> {
  // A followed cross-origin redirect means something sat in front of the API —
  // a preview's deployment protection is the usual culprit — so the body is a
  // login page, not JSON.
  if (response.redirected) return { status: "error", detail: ADMIN_READ_ERROR.PROTECTED };
  if (response.status === ADMIN_HTTP_STATUS.UNAUTHORIZED) return { status: "signed-out" };
  if (response.status === ADMIN_HTTP_STATUS.FORBIDDEN) return { status: "forbidden" };
  if (response.status === ADMIN_HTTP_STATUS.NOT_FOUND) return { status: "missing" };
  if (response.status === ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE) {
    return { status: "error", detail: ADMIN_READ_ERROR.UNAVAILABLE };
  }
  if (!response.ok) return { status: "error", detail: errorDetail };
  return {
    status: "ready",
    value: await reader(response),
    question,
    refreshFailure: undefined,
  };
}

/**
 * What a failed read says: its own detail, or — for a status that carries
 * none, a 404 from an endpoint that documents no such answer — the endpoint's
 * own failure, which is what an unexpected refusal has always read as.
 */
export function adminReadFailure(state: AdminRead<unknown>, endpointDetail: string): string {
  return state.status === "error" ? state.detail : endpointDetail;
}

/**
 * What one settled admin read does to the state its screen is showing. Every
 * outcome replaces it — a fresh answer, a still-loading screen's error card,
 * the gate's refusals, a gone account — except a generic error landing on a
 * shown answer to the question the failed read asked: a refresh that failed
 * says the network or the service faltered, not that the numbers on screen
 * stopped being true, so the answer stays up and the failure rides it as a
 * notice. A failure answering a different question — a scope flipped, so the
 * read asked for numbers the shown answer does not cover — lands as the
 * error card instead, or the old question's answer would stand under a
 * control claiming the new one. The gate's outcomes are never held back,
 * because stale data must not stand in front of a withdrawn session, a
 * refused role, or an account that no longer exists.
 */
export function settleRead<State extends { status: string }>(
  current: State,
  next: State,
  asked: string,
): State {
  if (isFailedRead(next) && isShownAnswer(current) && current.question === asked) {
    return { ...current, refreshFailure: next.detail };
  }
  return next;
}

interface ShownAnswer {
  status: "ready";
  /** The request the answer came from, so a failure can say whether it asked the same one. */
  question: string;
  refreshFailure: string | undefined;
}

interface FailedRead {
  status: "error";
  detail: string;
}

function isShownAnswer<State extends { status: string }>(
  state: State,
): state is State & ShownAnswer {
  return state.status === "ready";
}

function isFailedRead<State extends { status: string }>(state: State): state is State & FailedRead {
  return state.status === "error";
}

/**
 * The one read every admin screen makes: one request at a time, the gate's
 * refusals kept distinct, and the last answer held up while the next is in
 * flight. A screen names its address, how to read a 200, and what to say when
 * the endpoint refuses for no reason of the gate's; everything else — the
 * local sign-in consent, the cancellation discipline, the refreshing flag, the
 * sign-out withdrawal — is the same on every screen and lives here.
 */
export function useAdminRead<T>(
  path: string,
  reader: AdminReader<T>,
  errorDetail: string,
  options: AdminReadOptions<T> = {},
): AdminReadHandle<T> {
  const { enabled = true, debounceMs = 0, keeps } = options;
  const [state, setState] = useState<AdminRead<T>>(() =>
    // A first visit is signed-out from the very first frame: it never fetches,
    // so a loading state would pose as a request that is not in flight.
    SIGN_IN_CHOSEN.read() ? { status: "loading" } : { status: "signed-out" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef<AbortController>(null);

  // The reader, the detail, and the identity check are read at the moment a
  // read starts rather than closed over, so a screen may write them inline
  // without every render restarting its own fetch: the address alone decides
  // when to read.
  const latest = useRef({ reader, errorDetail, keeps });
  useEffect(() => {
    latest.current = { reader, errorDetail, keeps };
  });

  const run = useCallback(() => {
    // A session earned elsewhere on the site does not open the dashboard by
    // itself: until a sign-in has been pressed on this page once, the card is
    // the answer, whatever cookie the browser holds.
    if (!SIGN_IN_CHOSEN.read()) {
      setState({ status: "signed-out" });
      return;
    }
    // One read at a time: a scope flipped twice, or a refresh pressed on a slow
    // answer, would otherwise leave two in flight and let the older one land
    // last and overwrite the newer.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { reader: read, errorDetail: detail, keeps: shownStands } = latest.current;
    // Only a read with nothing to keep clears the page. A refetch keeps the
    // last answer up until the next one arrives, because blanking a read page
    // for a press that changes one filter throws away the reader's place and
    // reads as a fault.
    setState((current) =>
      current.status === "ready" && (shownStands === undefined || shownStands(current.value))
        ? current
        : { status: "loading" },
    );
    setRefreshing(true);
    void (async () => {
      try {
        const next = await adminReadFromResponse(
          await fetch(path, { headers: { accept: "application/json" }, signal: controller.signal }),
          read,
          path,
          detail,
        );
        if (!controller.signal.aborted) setState((current) => settleRead(current, next, path));
      } catch {
        if (!controller.signal.aborted) {
          setState((current) => settleRead(current, { status: "error", detail }, path));
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
  }, [path]);

  // The first read is immediate whatever the debounce says: the window exists
  // so a typed word coalesces into one read, not so the page opens late.
  const started = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const immediate = debounceMs === 0 || !started.current;
    started.current = true;
    if (immediate) {
      run();
      return () => inFlight.current?.abort();
    }
    const timer = window.setTimeout(run, debounceMs);
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [run, enabled, debounceMs]);

  const withdraw = useCallback(async (signOut: () => Promise<void>) => {
    inFlight.current?.abort();
    setRefreshing(false);
    await signOut();
    setState({ status: "signed-out" });
  }, []);

  const revise = useCallback((change: (value: T) => T) => {
    setState((current) =>
      current.status === "ready" ? { ...current, value: change(current.value) } : current,
    );
  }, []);

  return { state, refreshing, reload: run, withdraw, revise };
}
