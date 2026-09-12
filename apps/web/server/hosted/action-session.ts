import {
  ACTION_KIND,
  ACTION_RESULT_STATUS,
  type CloudAgentProviderId,
  type HostedActionWorkspaceAnswer,
  isCloudAgentProviderId,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "../core.js";
import { runWeb } from "../runtime.js";
import {
  type ActionExecutionAnswer,
  type ActionRoster,
  actionUnsupportedReason,
  executeSessionAction,
  type HostedSessionActionKind,
} from "./action-execute.js";
import { decryptProviderKey, secretOrUnavailable } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { rosterForAction } from "./observation-pass.js";
import type { HostedVaultRoute } from "./vault-route.js";

/** Maximum length accepted for a provider session id in a URL segment. */
const SESSION_ID_MAX_LENGTH = 200;

/**
 * A provider session id safe to embed in a URL segment: non-empty, no path
 * separators, under the length ceiling. The provider's API returns 404 for
 * an id that does not exist, so format validation here is minimal. The
 * conversation read holds its message-id cursor to the same shape, since a
 * cursor rides a request exactly the way a session id does.
 */
export function parseProviderSessionId(value: UnparsedWireValue): string | undefined {
  const identifier = text(value);
  if (!identifier || identifier.length > SESSION_ID_MAX_LENGTH) return undefined;
  if (identifier.includes("/") || identifier.includes("\\") || identifier.includes("\0")) {
    return undefined;
  }
  return identifier;
}

/**
 * The ask's own fields, with what the body never carried left out: an absent
 * field and a field carrying nothing are the same ask, and admission reads
 * absence as "the developer named none".
 */
function named(entries: Readonly<Record<string, WireValue | undefined>>): WireRecord {
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value] as const],
    ),
  );
}

/**
 * An action aimed at a session, carrying its target. The id is bounded here
 * because it becomes a URL segment inside the adapter; whether it names a
 * session anyone observed is admission's question. An id that could not be a
 * segment is a malformed ask rather than a refusal, so the whole ask answers
 * nothing and the route says `invalid_request`.
 */
function aimed(
  body: WireRecord,
  fields: Readonly<Record<string, WireValue | undefined>>,
): WireRecord | undefined {
  const providerSessionId = parseProviderSessionId(body.providerSessionId);
  return providerSessionId
    ? named({ provider_session_id: providerSessionId, ...fields })
    : undefined;
}

/**
 * The one place this wire's camelCase body becomes the field names admission
 * reads, and the one place that says which actions name a session at all — the
 * creation names a project instead. Nothing here validates a value: it is
 * renamed and handed on unparsed, because whether it is a message, a name, a
 * task, or a model any session or project actually takes is `admit()`'s
 * question, asked once, against the stored snapshot the action stands on.
 */
const HOSTED_ACTION_FIELDS = {
  [ACTION_KIND.MESSAGE]: (body: WireRecord) => aimed(body, { text: body.text }),
  [ACTION_KIND.CONTROL]: (body: WireRecord) => aimed(body, { control_id: body.controlId }),
  [ACTION_KIND.ADD_AGENT]: (body: WireRecord) =>
    aimed(body, {
      agent: body.agent,
      model: body.model,
      effort: body.effort,
      name: body.name,
      task: body.task,
    }),
  [ACTION_KIND.RENAME_SESSION]: (body: WireRecord) => aimed(body, { name: body.name }),
  [ACTION_KIND.RENAME_WORKSPACE]: (body: WireRecord) => aimed(body, { name: body.name }),
  [ACTION_KIND.CREATE_WORKSPACE]: (body: WireRecord) =>
    named({
      project_id: body.providerProjectId,
      agent: body.agent,
      model: body.model,
      effort: body.effort,
      name: body.name,
      task: body.task,
    }),
} as const satisfies Readonly<
  Record<HostedSessionActionKind, (body: WireRecord) => WireRecord | undefined>
>;

/**
 * One action request: every action a mobile row asks shares these gates — bearer
 * auth, a cloud-agent provider id, a readable ask, the unsupported answer
 * before a key is required, and the stored key decrypted only for a request
 * that passed everything else. What a route names is the action's own kind;
 * everything about whether that action may run is admission's, one layer down,
 * over the stored snapshot the user was shown.
 */
export interface SessionActionOptions
  extends Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret" | "readKey"> {
  kind: HostedSessionActionKind;
  /** The roster this action is admitted against: the stored snapshot's slice, or the pass that seeds one. */
  roster: (
    userId: string,
    providerId: CloudAgentProviderId,
    secret: string,
  ) => Promise<ActionRoster>;
  /**
   * The reason this provider cannot take this action. Injected only in tests:
   * every action this build ships is supported by its one provider, so the
   * handler's own ordering — unsupported answered before a key is required —
   * has no other way to be exercised.
   */
  unsupportedReason?: (providerId: CloudAgentProviderId) => string | undefined;
  /** Injected in tests; production hands the ask to `executeSessionAction`. */
  execute?: (options: {
    kind: HostedSessionActionKind;
    providerId: CloudAgentProviderId;
    fields: WireRecord;
    apiKey: string;
    roster: ActionRoster;
  }) => Promise<ActionExecutionAnswer>;
}

/**
 * What every action handler resolves before it looks at the action's own fields, or
 * the answer the caller gets instead. The gates and their order are the same
 * for a session action and a workspace creation: the method, the encryption
 * secret this deployment must hold, the bearer, a body that is a record, and
 * a cloud-agent provider the vault accepts a key for.
 */
interface ActionAdmission {
  userId: string;
  secret: string;
  providerId: CloudAgentProviderId;
  body: WireRecord;
}

async function admitActionRequest(
  options: Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret">,
): Promise<ActionAdmission | Response> {
  const { request, resolveUserId, encryptionSecret } = options;

  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = secretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  let body: UnparsedWireValue;
  try {
    // SAFETY: request.json() returns unknown; isRecord below validates the shape.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return invalidRequest();
  }
  if (!isRecord(body)) return invalidRequest();

  const providerId = text(body.providerId);
  if (!isCloudAgentProviderId(providerId)) return invalidRequest();

  return { userId, secret: secretResult.secret, providerId, body };
}

function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

/** The unsupported and no-key answers, which are 200s carrying a refusal rather than errors. */
function refusedAnswer(result: HostedActionWorkspaceAnswer["result"], reason: string): Response {
  const answer: HostedActionWorkspaceAnswer = { result, reason };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

function actionAnswer(executed: ActionExecutionAnswer): Response {
  const answer: HostedActionWorkspaceAnswer = {
    result: executed.result,
    ...(executed.reason ? { reason: executed.reason } : undefined),
    ...(executed.providerSessionId ? { providerSessionId: executed.providerSessionId } : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

/**
 * The stored key for this user and provider, decrypted, or the answer the
 * caller gets instead: a rejection naming the missing key, or a 503 for a
 * ciphertext this deployment's secret cannot open.
 */
async function apiKeyOrAnswer(
  readKey: HostedVaultRoute["readKey"],
  userId: string,
  providerId: CloudAgentProviderId,
  secret: string,
): Promise<{ apiKey: string } | Response> {
  const keyRow = await readKey(userId, providerId);
  if (!keyRow) {
    return refusedAnswer(
      ACTION_RESULT_STATUS.REJECTED,
      "No provider key stored. Add a key for this provider in settings.",
    );
  }
  try {
    return { apiKey: decryptProviderKey(keyRow.ciphertext, secret) };
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
}

/** Admits and delivers one action aimed at a cloud session or project on the user's behalf. */
export async function handleSessionAction(options: SessionActionOptions): Promise<Response> {
  const admission = await admitActionRequest(options);
  if (admission instanceof Response) return admission;
  const { userId, secret, providerId, body } = admission;
  const { kind } = options;

  const asked = HOSTED_ACTION_FIELDS[kind](body);
  if (asked === undefined) return invalidRequest();
  const fields: WireRecord = { provider_id: providerId, ...asked };

  const unsupported = (options.unsupportedReason ?? ((id) => actionUnsupportedReason(kind, id)))(
    providerId,
  );
  if (unsupported) return refusedAnswer(ACTION_RESULT_STATUS.UNSUPPORTED, unsupported);

  const key = await apiKeyOrAnswer(options.readKey, userId, providerId, secret);
  if (key instanceof Response) return key;

  const roster = await options.roster(userId, providerId, secret);
  const execute = options.execute ?? executeSessionAction;
  return actionAnswer(await execute({ kind, providerId, fields, apiKey: key.apiKey, roster }));
}

/**
 * The roster a deployed route admits against: the stored snapshot, or the
 * pass that seeds one for a user no scheduled pass has reached yet.
 */
function routeRoster(route: HostedVaultRoute): SessionActionOptions["roster"] {
  return (userId, providerId, secret) =>
    runWeb(
      rosterForAction({
        userId,
        providerId,
        secret,
        store: route.store(secret),
        readVaultKeys: route.readVaultKeys,
        seams: {},
        now: Date.now(),
      }),
    );
}

/** The six actions, each as the one thing its route names. */
export const handleMessageAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({ ...route, kind: ACTION_KIND.MESSAGE, roster: routeRoster(route) });

export const handleControlAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({ ...route, kind: ACTION_KIND.CONTROL, roster: routeRoster(route) });

export const handleAgentAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({ ...route, kind: ACTION_KIND.ADD_AGENT, roster: routeRoster(route) });

export const handleRenameSessionAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({ ...route, kind: ACTION_KIND.RENAME_SESSION, roster: routeRoster(route) });

export const handleRenameWorkspaceAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({
    ...route,
    kind: ACTION_KIND.RENAME_WORKSPACE,
    roster: routeRoster(route),
  });

export const handleWorkspaceAction = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAction({ ...route, kind: ACTION_KIND.CREATE_WORKSPACE, roster: routeRoster(route) });
