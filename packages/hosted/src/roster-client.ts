import type * as HttpClient from "@effect/platform/HttpClient";
import {
  ACTION_KIND,
  type AdvertisedAction,
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  isCloudAgentProviderId,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionControlKind,
  type SessionDetail,
  type SessionStatus,
} from "@sidecar/session";
import { HTTP_METHOD } from "@sidecar/wire";
import type { Effect } from "effect";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type ObserveAnswer, type ObservedSession, observeAnswerSchema } from "./observe-wire.js";
import { type HostedProjectsAnswer, hostedProjectsAnswerSchema } from "./projects-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedRosterClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

/**
 * The desktop's side of the stored snapshot: the roster the service's own
 * scheduled pass last stored for the signed-in account, read as the phone
 * reads it and never asked fresh, so a Mac drawing its rows every minute
 * spends no provider request and no rate brake, and the projects the same
 * snapshot lists for the account's keys, where a workspace can be created.
 * An answer the call could not get resolves to nothing, and the caller keeps
 * what it last drew.
 */
export class HostedRosterClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedRosterClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  observe(): Effect.Effect<ObserveAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.OBSERVE },
      observeAnswerSchema,
    );
  }

  projects(): Effect.Effect<HostedProjectsAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.PROJECTS },
      hostedProjectsAnswerSchema,
    );
  }
}

/** A vocabulary's members by name, so a wire string is answered as the member it names or nothing. */
function membersByName<Member extends string>(
  vocabulary: Readonly<Record<string, Member>>,
): ReadonlyMap<string, Member> {
  return new Map(Object.values(vocabulary).map((member) => [member, member]));
}

const SESSION_STATUS_BY_NAME = membersByName<SessionStatus>(SESSION_STATUS);

const CONTROL_KIND_BY_NAME = membersByName<SessionControlKind>(SESSION_CONTROL_KIND);

/**
 * The actions a wire row says its session advertised, in the observation's
 * own vocabulary. Each is presence alone, because that is all the wire
 * carries: what a control targets, or which workspace a rename lands on,
 * stays in the stored snapshot the action endpoints admit against, so a row
 * can offer a button and can never aim a write. A workspace rename is the one
 * advertisement that cannot travel this way at all, since its shape carries
 * the target it lands on, and a row that reports it advertises none here.
 */
function advertisedActions(session: ObservedSession): readonly AdvertisedAction[] {
  const advertises: AdvertisedAction[] = [];
  if (session.canReceiveMessage) advertises.push({ kind: ACTION_KIND.MESSAGE });
  for (const control of session.controls ?? []) {
    const kind = control.kind === undefined ? undefined : CONTROL_KIND_BY_NAME.get(control.kind);
    advertises.push({
      kind: ACTION_KIND.CONTROL,
      id: control.id,
      label: control.label,
      ...(kind !== undefined ? { controlKind: kind } : undefined),
    });
  }
  if (session.spawnableAgents && session.spawnableAgents.length > 0) {
    advertises.push({ kind: ACTION_KIND.ADD_AGENT, agents: [...session.spawnableAgents] });
  }
  if (session.canRename) advertises.push({ kind: ACTION_KIND.RENAME_SESSION });
  return advertises;
}

/**
 * One wire row as the observation a roster holds. The row's own instant
 * places it in time; a row the service dated only by the snapshot takes the
 * snapshot's instant, and one with neither cannot be sorted or aged and is
 * left out rather than dated by this machine's clock.
 */
function snapshotObservation(
  session: ObservedSession,
  observedAt: number | undefined,
): ProviderSessionObservation | undefined {
  const status = SESSION_STATUS_BY_NAME.get(session.status);
  const lastActivityAt = session.lastActivityAt ?? observedAt;
  if (status === undefined || lastActivityAt === undefined) return undefined;
  const detail: SessionDetail = {};
  if (session.workspace !== undefined) detail.repository = session.workspace;
  if (session.branch !== undefined) detail.branch = session.branch;
  if (session.change !== undefined) detail.change = session.change;
  if (session.link !== undefined) detail.link = session.link;
  if (session.error !== undefined) detail.error = session.error;
  return {
    providerSessionId: session.sessionId,
    title: session.title,
    status,
    lastActivityAt,
    detail,
    advertises: advertisedActions(session),
  };
}

/**
 * The answer as one list of observations per cloud provider, every provider
 * this build knows present so a roster replaces each slice whole: a provider
 * the answer holds no row for is a provider with no session, not one left
 * standing on its last pass. A row under a provider this build does not
 * observe in the cloud is dropped.
 */
export function snapshotRoster(
  answer: ObserveAnswer,
): ReadonlyMap<CloudAgentProviderId, readonly ProviderSessionObservation[]> {
  const roster = new Map<CloudAgentProviderId, ProviderSessionObservation[]>(
    Object.values(CLOUD_AGENT_PROVIDER_ID).map((providerId) => [providerId, []]),
  );
  for (const session of answer.sessions) {
    if (!isCloudAgentProviderId(session.providerId)) continue;
    const observation = snapshotObservation(session, answer.observedAt);
    if (observation) roster.get(session.providerId)?.push(observation);
  }
  return roster;
}
