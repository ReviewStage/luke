import {
  ACT_RESULT_STATUS,
  type CloudAgentProviderId,
  type HostedActWorkspaceAnswer,
  isCloudAgentProviderId,
  isRecord,
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  parseWorkspaceAgentSelection,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  text,
  type UnparsedWireValue,
  type WireRecord,
  type WorkspaceAgentSelection,
} from "../core.js";
import {
  type ActExecutionAnswer,
  AGENT_ACT,
  actUnsupportedReason,
  CONTROL_ACT,
  executeCreateWorkspaceAct,
  executeSessionAct,
  MESSAGE_ACT,
  REMOTE_SESSION_ACT,
  RENAME_SESSION_ACT,
  RENAME_WORKSPACE_ACT,
  type SessionActPlan,
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

/** Maximum length accepted for a provider project id. */
const PROJECT_ID_MAX_LENGTH = 200;

function parseProviderProjectId(value: UnparsedWireValue): string | undefined {
  const identifier = text(value);
  if (!identifier || identifier.length > PROJECT_ID_MAX_LENGTH) return undefined;
  if (identifier.includes("\0")) return undefined;
  return identifier;
}

/**
 * Control ids and agent kinds are short provider-fixed slugs (`cancel-turn`,
 * `archive-agent`; `claude`, `codex`, `opencode`); the bound refuses anything
 * that could not be one. Which ids or kinds exist is not decided here — the
 * executor honours only what the fresh observation pass advertised.
 */
const SLUG_MAX_LENGTH = 100;

/**
 * A bounded name or task an ask may leave out. Blank is left out, and so is a
 * value this boundary cannot read as words at all — both are the ask not
 * carrying one — while words past the bound are the ask carrying something
 * this endpoint refuses, and refuses whole.
 */
function askedText(maximumLength: number): Schema<string | undefined> {
  return s
    .refine(
      s.map(s.dropRefused(s.text({ allowEmpty: true })), (value) => value || undefined),
      (value) => value === undefined || value.length <= maximumLength,
    )
    .optional();
}

/**
 * Each act's own fields, bounded exactly as the desktop bounds them before a
 * network call. The envelope every act request carries — its provider id and
 * its target — is read by the handler itself, so a field table names only
 * what its act adds and ignores the rest of the body.
 */
const BESIDE_THE_ENVELOPE = { extraKeys: RECORD_EXTRA_KEYS.IGNORE } as const;

const MESSAGE_FIELDS = s.record(
  { text: s.text({ max: maximumSessionMessageLength }) },
  BESIDE_THE_ENVELOPE,
);

const CONTROL_FIELDS = s.record(
  { controlId: s.text({ max: SLUG_MAX_LENGTH }) },
  BESIDE_THE_ENVELOPE,
);

const AGENT_FIELDS = s.record(
  {
    agent: s.text({ max: SLUG_MAX_LENGTH }),
    name: askedText(maximumWorkspaceNameLength),
    task: askedText(maximumSessionMessageLength),
  },
  BESIDE_THE_ENVELOPE,
);

const NAME_FIELDS = s.record(
  { name: s.text({ max: maximumWorkspaceNameLength }) },
  BESIDE_THE_ENVELOPE,
);

const WORKSPACE_FIELDS = s.record(
  { name: askedText(maximumWorkspaceNameLength), task: askedText(maximumSessionMessageLength) },
  BESIDE_THE_ENVELOPE,
);

/**
 * One session-scoped act request: every act a mobile row asks of an observed
 * session shares these gates — bearer auth, a cloud-agent provider id, a bounded
 * session id, the act's own bounded fields, the unsupported answer before a
 * key is required, and the stored key decrypted only for a request that
 * passed everything else. Only the act's fields and its plan differ, so they
 * are what a route names.
 */
export interface SessionActOptions<Fields, Target>
  extends Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret" | "readKey"> {
  plan: SessionActPlan<Fields, Target>;
  fields: Schema<Fields>;
  /**
   * The reason this provider cannot take this act. Injected only in tests:
   * every act this build ships is supported by its one provider, so the
   * handler's own ordering — unsupported answered before a key is required —
   * has no other way to be exercised.
   */
  unsupportedReason?: (providerId: CloudAgentProviderId) => string | undefined;
  /** Injected in tests; production runs the plan through `executeSessionAct`. */
  execute?: (options: {
    providerId: CloudAgentProviderId;
    providerSessionId: string;
    fields: Fields;
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

/** Validates and delivers one act aimed at a cloud session on the user's behalf. */
export async function handleSessionAct<Fields, Target>(
  options: SessionActOptions<Fields, Target>,
): Promise<Response> {
  const admission = await admitActRequest(options);
  if (admission instanceof Response) return admission;
  const { userId, secret, providerId, body } = admission;

  const providerSessionId = parseProviderSessionId(body.providerSessionId);
  if (!providerSessionId) return invalidRequest();

  const fields = options.fields.parse(body);
  if (fields === undefined) return invalidRequest();

  const unsupported = (
    options.unsupportedReason ?? ((id) => actUnsupportedReason(options.plan.act, id))
  )(providerId);
  if (unsupported) return refusedAnswer(ACT_RESULT_STATUS.UNSUPPORTED, unsupported);

  const key = await apiKeyOrAnswer(options.readKey, userId, providerId, secret);
  if (key instanceof Response) return key;

  const execute = options.execute ?? ((request) => executeSessionAct(options.plan, request));
  return actAnswer(await execute({ providerId, providerSessionId, fields, apiKey: key.apiKey }));
}

export interface WorkspaceActOptions
  extends Pick<HostedVaultRoute, "request" | "resolveUserId" | "encryptionSecret" | "readKey"> {
  /** Injected in tests, for the reason {@link SessionActOptions.unsupportedReason} gives. */
  unsupportedReason?: (providerId: CloudAgentProviderId) => string | undefined;
  /** Injected in tests; production reaches the provider through `executeCreateWorkspaceAct`. */
  executeCreateWorkspace?: (options: {
    providerId: CloudAgentProviderId;
    providerProjectId: string;
    name: string | undefined;
    task: string | undefined;
    agentSelection: WorkspaceAgentSelection | undefined;
    apiKey: string;
  }) => Promise<ActExecutionAnswer>;
}

/**
 * Validates and creates a workspace in a cloud project on the user's behalf.
 * It shares every gate with a session act and differs in its target: a
 * project the provider reported rather than a session it observed, which is
 * why it names its own fields and its own executor rather than a plan.
 */
export async function handleWorkspaceAct(options: WorkspaceActOptions): Promise<Response> {
  const admission = await admitActRequest(options);
  if (admission instanceof Response) return admission;
  const { userId, secret, providerId, body } = admission;

  const providerProjectId = parseProviderProjectId(body.providerProjectId);
  if (!providerProjectId) return invalidRequest();

  const asked = WORKSPACE_FIELDS.parse(body);
  if (asked === undefined) return invalidRequest();

  // An agent choice must be one the build's own table lists for this
  // provider — the same gate the desktop's stores, offers, and adapters all
  // answer to — so a request carrying any of the three fields either parses
  // whole against that table or is invalid, never trimmed to something else.
  let agentSelection: WorkspaceAgentSelection | undefined;
  if (body.agent !== undefined || body.model !== undefined || body.effort !== undefined) {
    agentSelection = parseWorkspaceAgentSelection(providerId, body);
    if (!agentSelection) return invalidRequest();
  }

  const unsupported = (
    options.unsupportedReason ??
    ((id) => actUnsupportedReason(REMOTE_SESSION_ACT.CREATE_WORKSPACE, id))
  )(providerId);
  if (unsupported) return refusedAnswer(ACT_RESULT_STATUS.UNSUPPORTED, unsupported);

  const key = await apiKeyOrAnswer(options.readKey, userId, providerId, secret);
  if (key instanceof Response) return key;

  const create = options.executeCreateWorkspace ?? executeCreateWorkspaceAct;
  return actAnswer(
    await create({
      providerId,
      providerProjectId,
      name: asked.name,
      task: asked.task,
      agentSelection,
      apiKey: key.apiKey,
    }),
  );
}

/** The five acts aimed at an observed session, each as the one thing its route names. */
export const handleMessageAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, plan: MESSAGE_ACT, fields: MESSAGE_FIELDS });

export const handleControlAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, plan: CONTROL_ACT, fields: CONTROL_FIELDS });

export const handleAgentAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, plan: AGENT_ACT, fields: AGENT_FIELDS });

export const handleRenameSessionAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, plan: RENAME_SESSION_ACT, fields: NAME_FIELDS });

export const handleRenameWorkspaceAct = (route: HostedVaultRoute): Promise<Response> =>
  handleSessionAct({ ...route, plan: RENAME_WORKSPACE_ACT, fields: NAME_FIELDS });
