import {
  ACT_KIND,
  ACT_RESULT_STATUS,
  type CloudAgentProviderId,
  type HostedActWorkspaceAnswer,
  isCloudAgentProviderId,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "../core.js";
import {
  type ActExecutionAnswer,
  actUnsupportedReason,
  executeSessionAct,
  type HostedSessionActKind,
} from "./act-execute.js";
import { decryptProviderKey, secretOrUnavailable } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
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
 * An act aimed at a session, carrying its target. The id is bounded here
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
 * reads, and the one place that says which acts name a session at all — the
 * creation names a project instead. Nothing here validates a value: it is
 * renamed and handed on unparsed, because whether it is a message, a name, a
 * task, or a model any session or project actually takes is `admit()`'s
 * question, asked once, against the observation pass the act goes out on.
 */
const HOSTED_ACT_FIELDS = {
  [ACT_KIND.MESSAGE]: (body: WireRecord) => aimed(body, { text: body.text }),
  [ACT_KIND.CONTROL]: (body: WireRecord) => aimed(body, { control_id: body.controlId }),
  [ACT_KIND.ADD_AGENT]: (body: WireRecord) =>
    aimed(body, { agent: body.agent, name: body.name, task: body.task }),
  [ACT_KIND.RENAME_SESSION]: (body: WireRecord) => aimed(body, { name: body.name }),
  [ACT_KIND.RENAME_WORKSPACE]: (body: WireRecord) => aimed(body, { name: body.name }),
  [ACT_KIND.CREATE_WORKSPACE]: (body: WireRecord) =>
    named({
      project_id: body.providerProjectId,
      agent: body.agent,
      model: body.model,
      effort: body.effort,
      name: body.name,
      task: body.task,
    }),
} as const satisfies Readonly<
  Record<HostedSessionActKind, (body: WireRecord) => WireRecord | undefined>
>;

/**
 * One act request: every act a mobile row asks shares these gates — bearer
 * auth, a cloud-agent provider id, a readable ask, the unsupported answer
 * before a key is required, and the stored key decrypted only for a request
 * that passed everything else. What a route names is the act's own kind;
 * everything about whether that act may run is admission's, one layer down,
 * over the same observation pass the write goes out on.
 */
export interface SessionActOptions
  extends Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret" | "readKey"> {
  kind: HostedSessionActKind;
  /**
   * The reason this provider cannot take this act. Injected only in tests:
   * every act this build ships is supported by its one provider, so the
   * handler's own ordering — unsupported answered before a key is required —
   * has no other way to be exercised.
   */
  unsupportedReason?: (providerId: CloudAgentProviderId) => string | undefined;
  /** Injected in tests; production hands the ask to `executeSessionAct`. */
  execute?: (options: {
    kind: HostedSessionActKind;
    providerId: CloudAgentProviderId;
    fields: WireRecord;
    apiKey: string;
  }) => Promise<ActExecutionAnswer>;
}

/**
 * What every act handler resolves before it looks at the act's own fields, or
 * the answer the caller gets instead. The gates and their order are the same
 * for a session act and a workspace creation: the method, the encryption
 * secret this deployment must hold, the bearer, a body that is a record, and
 * a cloud-agent provider the vault accepts a key for.
 */
interface ActAdmission {
  userId: string;
  secret: string;
  providerId: CloudAgentProviderId;
  body: WireRecord;
}

async function admitActRequest(
  options: Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret">,
): Promise<ActAdmission | Response> {
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
function refusedAnswer(result: HostedActWorkspaceAnswer["result"], reason: string): Response {
  const answer: HostedActWorkspaceAnswer = { result, reason };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

function actAnswer(executed: ActExecutionAnswer): Response {
  const answer: HostedActWorkspaceAnswer = {
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
      ACT_RESULT_STATUS.REJECTED,
      "No provider key stored. Add a key for this provider in settings.",
    );
  }
  try {
    return { apiKey: decryptProviderKey(keyRow.ciphertext, secret) };
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
}

/** Admits and delivers one act aimed at a cloud session or project on the user's behalf. */
export async function handleSessionAct(options: SessionActOptions): Promise<Response> {
  const admission = await admitActRequest(options);
  if (admission instanceof Response) return admission;
  const { userId, secret, providerId, body } = admission;
  const { kind } = options;

  const asked = HOSTED_ACT_FIELDS[kind](body);
  if (asked === undefined) return invalidRequest();
  const fields: WireRecord = { provider_id: providerId, ...asked };

  const unsupported = (options.unsupportedReason ?? ((id) => actUnsupportedReason(kind, id)))(
    providerId,
  );
  if (unsupported) return refusedAnswer(ACT_RESULT_STATUS.UNSUPPORTED, unsupported);

  const key = await apiKeyOrAnswer(options.readKey, userId, providerId, secret);
  if (key instanceof Response) return key;

  const execute = options.execute ?? executeSessionAct;
  return actAnswer(await execute({ kind, providerId, fields, apiKey: key.apiKey }));
}

/** The six acts, each as the one thing its route names. */
export const handleMessageAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.MESSAGE });

export const handleControlAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.CONTROL });

export const handleAgentAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.ADD_AGENT });

export const handleRenameSessionAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.RENAME_SESSION });

export const handleRenameWorkspaceAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.RENAME_WORKSPACE });

export const handleWorkspaceAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, kind: ACT_KIND.CREATE_WORKSPACE });
