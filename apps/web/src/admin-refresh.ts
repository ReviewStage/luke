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
