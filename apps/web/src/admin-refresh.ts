/**
 * What one settled admin read does to the state its screen is showing. Every
 * outcome replaces it — a fresh answer, a still-loading screen's error card,
 * the gate's refusals, a gone account — except a generic error landing on a
 * shown answer: a refresh that failed says the network or the service
 * faltered, not that the numbers on screen stopped being true, so the answer
 * stays up and the failure rides it as a notice. The gate's outcomes are
 * never held back, because stale data must not stand in front of a withdrawn
 * session, a refused role, or an account that no longer exists.
 */
export function settleRead<State extends { status: string }>(current: State, next: State): State {
  if (isFailedRead(next) && isShownAnswer(current)) {
    return { ...current, refreshFailure: next.detail };
  }
  return next;
}

interface ShownAnswer {
  status: "ready";
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
