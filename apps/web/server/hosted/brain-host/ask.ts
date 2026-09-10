import { randomUUID } from "node:crypto";
import {
  BRAIN_SUBMISSION_OUTCOME,
  HOSTED_BRAIN_WAIT,
  HOSTED_SERVICE_PATH,
  type HostedBrainAskAnswer,
  type HostedBrainRunAnswer,
  hostedBrainAskRequestSchema,
  isTerminalBrainRequestStatus,
  type UnparsedWireValue,
} from "../../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readBoundedBody,
} from "../http.js";
import { createRateBrake } from "../rate-brake.js";
import { BRAIN_HOST } from "./bounds.js";
import {
  admitBrainRoute,
  type BrainRouteAdmission,
  busyResponse,
  clock,
  HOSTED_CONVERSATION_KEY,
  type HostedBrainRoute,
  leaseNow,
  leaseWithin,
  openAiKeyOrUnavailable,
  openBrainSession,
  pathSegmentAfter,
  readRunRecord,
  runToWire,
} from "./route.js";

/**
 * The developer's ask of the hosted brain, in three routes. The submit takes
 * the conversation's lease, opens the brain, accepts the ask into a run —
 * resuming first whatever the last holder left unfinished — answers the run's
 * id, and finishes the run after the answer. The wait answers the run when
 * it ends or as it stands after a bounded hold, and a wait that finds the
 * run orphaned — its lease expired with the run unfinished — is the request
 * that resumes it. The cancel notes the developer's cancel on the run for
 * its holder, or performs it itself when no holder stands.
 */

const ASK_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 30,
  MAX_TRACKED_USERS: 10_000,
} as const;

const askRateLimited = createRateBrake({
  windowMs: ASK_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: ASK_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: ASK_RATE_LIMIT.MAX_TRACKED_USERS,
});

/** An ask is words and two short ids; anything heavier is not an ask. */
const MAXIMUM_ASK_BODY_BYTES = 64 * 1024;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

function notFound(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
}

function runAnswer(status: number, record: Parameters<typeof runToWire>[0]): Response {
  const answer: HostedBrainRunAnswer = { run: runToWire(record) };
  return jsonResponse(status, answer);
}

async function readAsk(request: Request) {
  const body = await readBoundedBody(request, MAXIMUM_ASK_BODY_BYTES);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) return invalidRequest();
  let payload: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns unknown; the schema below is the validation.
    payload = JSON.parse(body.text) as UnparsedWireValue;
  } catch {
    return invalidRequest();
  }
  const ask = hostedBrainAskRequestSchema.parse(payload);
  return ask ?? invalidRequest();
}

/** POST: accepts one ask into a run of the account's conversation and answers the run's id. */
export async function handleBrainAsk(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.POST);
  if (admission instanceof Response) return admission;
  const openAiKey = openAiKeyOrUnavailable(route);
  if (openAiKey instanceof Response) return openAiKey;
  const now = clock(route);
  if (askRateLimited(admission.userId, now())) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }
  const ask = await readAsk(route.request);
  if (ask instanceof Response) return ask;

  const lease = await leaseWithin(route, admission.store, admission.userId);
  if (!lease) return busyResponse();
  const session = await openBrainSession(route, admission, openAiKey, lease);
  const { agent } = session.brain;
  await session.ready();
  const result = await agent.submitAsk({
    submissionId: ask.submissionId ?? randomUUID(),
    question: ask.question,
    origin: ask.origin,
  });
  // The ask's own line stands in the Conversation before the caller hears
  // of the run, so a device reading the thread finds the ask beside the run.
  await session.brain.publish();
  route.continueAfterResponse(session.finish());
  const answer: HostedBrainAskAnswer =
    result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED
      ? { outcome: result.outcome, runId: result.runId, acceptedAt: result.acceptedAt }
      : { outcome: result.outcome, reason: result.reason };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

function waitMsOf(request: Request): number {
  const asked = new URL(request.url).searchParams.get(HOSTED_BRAIN_WAIT.QUERY);
  const parsed = asked === null ? Number.NaN : Number(asked);
  if (!Number.isFinite(parsed) || parsed < 0) return HOSTED_BRAIN_WAIT.MAXIMUM_MS;
  return Math.min(Math.floor(parsed), HOSTED_BRAIN_WAIT.MAXIMUM_MS);
}

function sleepFor(route: Pick<HostedBrainRoute, "sleep">, ms: number): Promise<void> {
  return (
    route.sleep?.(ms) ??
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
  );
}

/**
 * Whether the conversation's lease is free to take: none stands, or the one
 * standing has expired. A lease held by a live function is the run's own
 * holder, and this request only watches the record.
 */
async function leaseIsFree(admission: BrainRouteAdmission, now: number): Promise<boolean> {
  const lease = await admission.store.leases.read(admission.userId, HOSTED_CONVERSATION_KEY);
  return lease === undefined || lease.expiresAt <= now;
}

/**
 * GET: the run as it stands, answered when it ends or when the hold runs
 * out. A run whose holder died is resumed by this request under the lease it
 * takes, and the hold then waits on the resumed run itself.
 */
export async function handleBrainAskWait(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.GET);
  if (admission instanceof Response) return admission;
  const runId = pathSegmentAfter(route.request, HOSTED_SERVICE_PATH.BRAIN_ASK);
  if (!runId) return invalidRequest();
  const now = clock(route);
  const deadline = now() + waitMsOf(route.request);

  const record = await readRunRecord(admission.store, admission.userId, runId);
  if (!record) return notFound();
  if (isTerminalBrainRequestStatus(record.status)) {
    return runAnswer(HOSTED_HTTP_STATUS.OK, record);
  }

  for (;;) {
    if (await leaseIsFree(admission, now())) {
      const openAiKey = openAiKeyOrUnavailable(route);
      if (openAiKey instanceof Response) return openAiKey;
      const lease = await leaseNow(route, admission.store, admission.userId);
      if (lease) {
        const session = await openBrainSession(route, admission, openAiKey, lease);
        await session.ready();
        const waited = await session.brain.agent.waitAsk(runId, Math.max(0, deadline - now()));
        // A run that ended inside the hold reaches the Conversation before
        // its reply is answered, so a device never hears a reply the thread
        // has yet to take.
        if (waited && isTerminalBrainRequestStatus(waited.status)) await session.brain.publish();
        route.continueAfterResponse(session.finish());
        const current = waited ?? (await readRunRecord(admission.store, admission.userId, runId));
        return current ? runAnswer(HOSTED_HTTP_STATUS.OK, current) : notFound();
      }
    }
    const current = await readRunRecord(admission.store, admission.userId, runId);
    if (!current) return notFound();
    if (
      isTerminalBrainRequestStatus(current.status) ||
      now() + BRAIN_HOST.WAIT_POLL_MS > deadline
    ) {
      return runAnswer(HOSTED_HTTP_STATUS.OK, current);
    }
    await sleepFor(route, BRAIN_HOST.WAIT_POLL_MS);
  }
}

/**
 * POST: cancels a run. The cancel is noted on the run row first, so the
 * function holding the run reads it at its next heartbeat; when no holder
 * stands, this request takes the lease and cancels the run itself, which
 * settles it as cancelled through the brain's own path.
 */
export async function handleBrainAskCancel(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.POST);
  if (admission instanceof Response) return admission;
  const runId = pathSegmentAfter(route.request, HOSTED_SERVICE_PATH.BRAIN_ASK);
  if (!runId) return invalidRequest();
  const now = clock(route);

  const noted = await admission.store.runs.requestCancel(admission.userId, runId, now());
  if (!noted) {
    const record = await readRunRecord(admission.store, admission.userId, runId);
    return record ? runAnswer(HOSTED_HTTP_STATUS.OK, record) : notFound();
  }
  const openAiKey = openAiKeyOrUnavailable(route);
  const lease =
    openAiKey instanceof Response
      ? undefined
      : await leaseNow(route, admission.store, admission.userId);
  if (lease && !(openAiKey instanceof Response)) {
    const session = await openBrainSession(route, admission, openAiKey, lease);
    await session.ready();
    const cancelled = await session.brain.agent.cancelAsk(runId);
    if (cancelled) await session.brain.publish();
    route.continueAfterResponse(session.finish());
    if (cancelled) return runAnswer(HOSTED_HTTP_STATUS.OK, cancelled);
  }
  const record = await readRunRecord(admission.store, admission.userId, runId);
  return record ? runAnswer(HOSTED_HTTP_STATUS.ACCEPTED, record) : notFound();
}
