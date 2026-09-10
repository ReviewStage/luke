import { randomUUID } from "node:crypto";
import {
  type BrainRequestRecord,
  type CloudAgentProviderId,
  type HostedBrainRun,
  isCloudAgentProviderId,
  MAIN_SESSION_KEY,
  type ModelAdapter,
  openAiModelAdapter,
  type SessionKey,
} from "../../core.js";
import { executeSessionAction } from "../action-execute.js";
import { decryptProviderKey } from "../encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http.js";
import type { HostedSpend } from "../quota.js";
import type { HostedStore } from "../store/index.js";
import type { VaultKeyRow } from "../vault-route.js";
import { BRAIN_HOST } from "./bounds.js";
import type { HostedWorkspaceDefaults } from "./context.js";
import { type HostedBrain, type HostedBrainSeams, openHostedBrain } from "./host.js";
import {
  acquireLeaseNow,
  acquireLeaseWithin,
  type HeldLease,
  type LeaseSeams,
} from "./lease-run.js";
import { meteredModelAdapter } from "./metered-model.js";
import type { CloudActionExecutor } from "./performer.js";

/**
 * The deployment's seams behind every brain-host route, handed to a handler
 * once: the bearer's account, the vault's secret and the account's stored
 * keys, the store under the payload key ring, Luke's own OpenAI key and
 * model, the meter every inference spends, and the one thing a function on
 * Vercel needs to finish a run after it has answered. A handler takes only
 * what its route needs, and a test hands in a scripted model and a clock.
 */
export interface HostedBrainRoute {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Luke's own OpenAI key, from the deployment environment; absent means the brain is off. */
  openAiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model: string | undefined;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  store: (secret: string) => HostedStore;
  spend: (userId: string) => Promise<HostedSpend>;
  workspaceDefaults: (userId: string) => Promise<HostedWorkspaceDefaults>;
  /**
   * Keeps the function alive past its response until the work settles:
   * Vercel's `waitUntil` in production. A test collects the work and awaits
   * it itself.
   */
  continueAfterResponse: (work: Promise<void>) => void;
  /** The cloud action execution the brain's session actions go out through. */
  executeAction?: CloudActionExecutor;
  /** The model the runtime reaches; production builds the OpenAI adapter on the key. */
  modelAdapter?: (apiKey: string, model: string | undefined) => ModelAdapter;
  cloudPlugin?: HostedBrainSeams["cloudPlugin"];
  now?: () => number;
  createId?: () => string;
  report?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  leaseWaitMs?: number;
  /** How long the drain after a response waits for the run before leaving it to the next holder. */
  drainMs?: number;
}

/** The main conversation is the one every route reaches; private threads keep their code and no route. */
export const HOSTED_CONVERSATION_KEY: SessionKey = MAIN_SESSION_KEY;

export function reporter(route: Pick<HostedBrainRoute, "report">): (message: string) => void {
  return route.report ?? ((message) => process.stderr.write(`${message}\n`));
}

export function clock(route: Pick<HostedBrainRoute, "now">): () => number {
  return route.now ?? Date.now;
}

function sleeper(route: Pick<HostedBrainRoute, "sleep">): (ms: number) => Promise<void> {
  return (
    route.sleep ??
    ((ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }))
  );
}

/** What every brain-host route resolves before it looks at its own ask, or the answer the caller gets instead. */
export interface BrainRouteAdmission {
  userId: string;
  secret: string;
  store: HostedStore;
}

export async function admitBrainRoute(
  route: Pick<HostedBrainRoute, "request" | "resolveUserId" | "encryptionSecret" | "store">,
  method: string,
): Promise<BrainRouteAdmission | Response> {
  if (route.request.method !== method) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const secret = route.encryptionSecret?.trim();
  if (!secret) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  const userId = await route.resolveUserId(route.request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  return { userId, secret, store: route.store(secret) };
}

/** The key the brain infers on, or the 503 the whole hosted tier answers without one. */
export function openAiKeyOrUnavailable(
  route: Pick<HostedBrainRoute, "openAiKey">,
): string | Response {
  const key = route.openAiKey?.trim();
  return key
    ? key
    : errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
}

/** A run as the wire carries it: the record's own fields and no other. */
export function runToWire(record: BrainRequestRecord): HostedBrainRun {
  return {
    runId: record.runId,
    submissionId: record.submissionId,
    origin: record.origin,
    question: record.question,
    status: record.status,
    revision: record.revision,
    acceptedAt: record.acceptedAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : undefined),
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : undefined),
    ...(record.text !== undefined ? { text: record.text } : undefined),
    ...(record.failure !== undefined ? { failure: record.failure } : undefined),
    performedActions: record.performedActions,
    unknownActions: record.unknownActions,
    ...(record.askRecordedAt !== undefined ? { askRecordedAt: record.askRecordedAt } : undefined),
    ...(record.conversationRecordedAt !== undefined
      ? { conversationRecordedAt: record.conversationRecordedAt }
      : undefined),
  };
}

/** One run's record as the store holds it, read without opening a brain; nothing for a run the conversation does not hold. */
export async function readRunRecord(
  store: HostedStore,
  userId: string,
  runId: string,
): Promise<BrainRequestRecord | undefined> {
  const loaded = await store.brainStateRepository(userId, HOSTED_CONVERSATION_KEY).load();
  return loaded.state?.requests.find((record) => record.runId === runId);
}

/** The path segment after a fixed prefix, decoded, or nothing for a path that is not one of the route's. */
export function pathSegmentAfter(request: Request, prefix: string): string | undefined {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${prefix}/`)) return undefined;
  const rest = pathname.slice(prefix.length + 1);
  const [segment] = rest.split("/");
  if (!segment) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** The lease seams for one request over the account's conversation. */
export function leaseSeamsFor(
  route: Pick<HostedBrainRoute, "now" | "sleep">,
  store: HostedStore,
  userId: string,
): LeaseSeams {
  return {
    store,
    userId,
    sessionKey: HOSTED_CONVERSATION_KEY,
    ownerId: randomUUID(),
    now: clock(route),
    sleep: sleeper(route),
  };
}

/** A lease taken now, or nothing while another holder's stands. */
export function leaseNow(
  route: Pick<HostedBrainRoute, "now" | "sleep">,
  store: HostedStore,
  userId: string,
): Promise<HeldLease | undefined> {
  return acquireLeaseNow(leaseSeamsFor(route, store, userId));
}

/** A lease taken within the route's wait, or nothing when the conversation stayed busy. */
export function leaseWithin(
  route: Pick<HostedBrainRoute, "now" | "sleep" | "leaseWaitMs">,
  store: HostedStore,
  userId: string,
): Promise<HeldLease | undefined> {
  return acquireLeaseWithin(
    leaseSeamsFor(route, store, userId),
    route.leaseWaitMs ?? BRAIN_HOST.LEASE_WAIT_MS,
  );
}

export function busyResponse(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.CONVERSATION_BUSY);
}

/**
 * One holder's use of the brain: opened under a lease already taken, its
 * heartbeat running and the developer's cancels applied at every beat, and
 * finished by draining the agent, publishing what its runs left for the
 * Conversation, stopping it, and releasing the lease. A run the drain could
 * not wait out is left running for the lease to expire under: the next
 * request or wake resumes it from its journal, and stopping it here would
 * write an interruption over a run this function only ran out of time for.
 */
export interface BrainSession {
  readonly brain: HostedBrain;
  readonly lease: HeldLease;
  finish(): Promise<void>;
}

/** The seams a brain session needs of a route: everything but the request's own admission, so the wake can open one too. */
export type BrainSessionSeams = Pick<
  HostedBrainRoute,
  | "model"
  | "readVaultKeys"
  | "spend"
  | "workspaceDefaults"
  | "executeAction"
  | "modelAdapter"
  | "cloudPlugin"
  | "now"
  | "createId"
  | "report"
  | "sleep"
  | "drainMs"
>;

export async function openBrainSession(
  route: BrainSessionSeams,
  admission: BrainRouteAdmission,
  openAiKey: string,
  lease: HeldLease,
): Promise<BrainSession> {
  const { userId, secret, store } = admission;
  const now = clock(route);
  const report = reporter(route);
  const buildModel =
    route.modelAdapter ??
    ((apiKey: string, model: string | undefined): ModelAdapter => {
      const adapter = openAiModelAdapter(apiKey, { ...(model ? { model } : undefined), now });
      if (!adapter) throw new Error("the OpenAI adapter needs a key");
      return adapter;
    });
  const model = meteredModelAdapter(buildModel(openAiKey, route.model?.trim() || undefined), () =>
    route.spend(userId),
  );
  const rows = await route.readVaultKeys(userId);
  const apiKey = async (providerId: CloudAgentProviderId) => {
    const row = rows.find((candidate) => candidate.providerId === providerId);
    if (!row) return undefined;
    try {
      return decryptProviderKey(row.ciphertext, secret);
    } catch {
      return undefined;
    }
  };
  const execute: CloudActionExecutor =
    route.executeAction ??
    ((input) =>
      executeSessionAction({
        kind: input.kind,
        providerId: input.providerId,
        fields: input.fields,
        apiKey: input.apiKey,
      }));
  let lost = false;
  const brain = await openHostedBrain({
    store,
    userId,
    sessionKey: HOSTED_CONVERSATION_KEY,
    model,
    now,
    createId: route.createId ?? randomUUID,
    report,
    apiKey: (providerId) =>
      isCloudAgentProviderId(providerId) ? apiKey(providerId) : Promise.resolve(undefined),
    executeAction: execute,
    workspaceDefaults: () => route.workspaceDefaults(userId),
    ...(route.cloudPlugin ? { cloudPlugin: route.cloudPlugin } : undefined),
    writable: () => !lost,
  });
  // A lease that passed to another holder means that holder now runs the
  // conversation: this brain writes nothing more and stands down, its runs
  // ending in memory alone while the successor resumes them from the store.
  const stopHeartbeat = lease.heartbeat(
    () => brain.applyCancels(),
    () => {
      lost = true;
      report("The conversation's lease passed to another holder; this brain stands down.");
      void brain.stop();
    },
  );
  const sleep = sleeper(route);
  const drainMs = route.drainMs ?? BRAIN_HOST.RUN_DEADLINE_MS + 20_000;
  return {
    brain,
    lease,
    finish: async () => {
      try {
        const idle = await Promise.race([
          brain.agent.idle().then(() => true),
          sleep(drainMs).then(() => false),
        ]);
        if (lost) return;
        if (!idle) {
          report("A brain run outlasted its function's drain and is left for the next holder.");
          stopHeartbeat();
          return;
        }
        await brain.publish();
        stopHeartbeat();
        await brain.stop();
        await lease.release();
      } catch (error) {
        stopHeartbeat();
        report(
          `The brain session did not finish cleanly: ${error instanceof Error ? error.name : "unknown error"}`,
        );
      }
    },
  };
}
