import type {
  ExtraRepositoryRefusal,
  LocalAgentRefusal,
  RefusedDevice,
} from "@repo/features/agent-wire";
import type { InstalledSkillRefusal } from "@repo/features/installed-skill-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import type { RepositoryUnreached } from "@repo/features/repository-reach-wire";
import { readEither } from "@repo/wire/effect";
import { type Cause, Effect, type Layer, Option, Result, type Scope, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { type UnparsedWireValue, unparsedWire, wireUuidSchema } from "../core.js";
import { ANY_METHOD, ANY_PATH } from "../route.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { logStoreFailure, type StoreFailure } from "./store-failure.js";

const HOSTED_CACHE_CONTROL = "private, no-store";

export const HOSTED_REFUSAL_STATUS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [HOSTED_API_ERROR.NOT_FOUND]: HOSTED_HTTP_STATUS.NOT_FOUND,
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
  [HOSTED_API_ERROR.UNAVAILABLE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: HOSTED_HTTP_STATUS.BAD_GATEWAY,
  [HOSTED_API_ERROR.NO_REPOSITORY]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.AGENT_NOT_READY]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_RETIRED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [HOSTED_API_ERROR.OPENAI_KEY_MISSING]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.OPENAI_KEY_REFUSED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.OPENAI_KEY_UNFUNDED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.NOT_PERMITTED]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.ALREADY_INVITED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.SANDBOX_STOPPED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.HOST_UPGRADE_NEEDED]: HOSTED_HTTP_STATUS.UPGRADE_REQUIRED,
  [HOSTED_API_ERROR.DEVICE_REMOVED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.TASK_BLOCK_CYCLE]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.TASK_PARENT_CYCLE]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.TASK_PARENT_HELD]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS,
  [HOSTED_API_ERROR.ALREADY_WRITTEN]: HOSTED_HTTP_STATUS.CONFLICT,
  [HOSTED_API_ERROR.MEMORY_OFF]: HOSTED_HTTP_STATUS.FORBIDDEN,
  [HOSTED_API_ERROR.MEMORY_CREDENTIAL]: HOSTED_HTTP_STATUS.BAD_REQUEST,
  [HOSTED_API_ERROR.MEMORY_FULL]: HOSTED_HTTP_STATUS.CONFLICT,
} as const;

type HostedRefusalSlug = keyof typeof HOSTED_REFUSAL_STATUS;

export type HostedRefusal = {
  readonly error: HostedRefusalSlug;
  readonly unreached?: RepositoryUnreached;
  readonly upstreamStatus?: number;
  readonly resetsAt?: number;
  readonly provider?: ModelProvider;
  readonly skillName?: string;
  readonly skillRefusal?: InstalledSkillRefusal;
  readonly localAgentRefusal?: LocalAgentRefusal;
  readonly refusedDevice?: RefusedDevice;
  readonly extraRepositoryRefusal?: ExtraRepositoryRefusal;
  readonly refusedRepository?: string;
  readonly minimumVersion?: string;
  readonly heldUntil?: number;
  readonly hostRemoved?: true;
};

export type UserIdResolver<Input = Request> = (
  input: Input,
) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;

export type SessionUserIdResolver = (
  request: Request,
) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;

export const HOSTED_REFUSAL = {
  INVALID_TOKEN: { error: HOSTED_API_ERROR.INVALID_TOKEN },
  INVALID_REQUEST: { error: HOSTED_API_ERROR.INVALID_REQUEST },
  METHOD_NOT_ALLOWED: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
  NOT_FOUND: { error: HOSTED_API_ERROR.NOT_FOUND },
  PROMPT_TOO_LARGE: { error: HOSTED_API_ERROR.PROMPT_TOO_LARGE },
  QUOTA_EXHAUSTED: { error: HOSTED_API_ERROR.QUOTA_EXHAUSTED },
  UNKNOWN_TOOL: { error: HOSTED_API_ERROR.UNKNOWN_TOOL },
  REQUEST_TOO_LARGE: { error: HOSTED_API_ERROR.REQUEST_TOO_LARGE },
  UNAVAILABLE: { error: HOSTED_API_ERROR.UNAVAILABLE },
  UPSTREAM_ERROR: { error: HOSTED_API_ERROR.UPSTREAM_ERROR },
  REPOSITORY_NOT_REACHABLE: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE },
  GITHUB_UNANSWERED: { error: HOSTED_API_ERROR.GITHUB_UNANSWERED },
  NO_REPOSITORY: { error: HOSTED_API_ERROR.NO_REPOSITORY },
  BRANCH_NOT_FOUND: { error: HOSTED_API_ERROR.BRANCH_NOT_FOUND },
  MESSAGE_TOO_LONG: { error: HOSTED_API_ERROR.MESSAGE_TOO_LONG },
  AGENT_NOT_READY: { error: HOSTED_API_ERROR.AGENT_NOT_READY },
  AGENT_RETIRED: { error: HOSTED_API_ERROR.AGENT_RETIRED },
  NATIVE_AGENT_NOT_HERE: { error: HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE },
  OPENAI_KEY_MISSING: { error: HOSTED_API_ERROR.OPENAI_KEY_MISSING },
  AGENT_PLAN_SIGNED_OUT: { error: HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT },
  AGENT_PLAN_UNREACHABLE: { error: HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE },
  AGENT_PLAN_LIMIT_REACHED: { error: HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED },
  AGENT_PLAN_INELIGIBLE: { error: HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE },
  AGENT_CREDENTIAL_MISSING: { error: HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING },
  AGENT_API_KEY_UNREADABLE: { error: HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE },
  NOT_PERMITTED: { error: HOSTED_API_ERROR.NOT_PERMITTED },
  ALREADY_INVITED: { error: HOSTED_API_ERROR.ALREADY_INVITED },
  SANDBOX_STOPPED: { error: HOSTED_API_ERROR.SANDBOX_STOPPED },
  SANDBOX_SNAPSHOT_GONE: { error: HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE },
  SKILL_NAME_TAKEN: { error: HOSTED_API_ERROR.SKILL_NAME_TAKEN },
  SKILL_FILES_REFUSED: { error: HOSTED_API_ERROR.SKILL_FILES_REFUSED },
  WORKSPACE_SLUG_MALFORMED: { error: HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED },
  WORKSPACE_SLUG_RESERVED: { error: HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED },
  WORKSPACE_SLUG_TAKEN: { error: HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN },
  LOCAL_AGENT_REFUSED: { error: HOSTED_API_ERROR.LOCAL_AGENT_REFUSED },
  EXTRA_REPOSITORY_REFUSED: { error: HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED },
  HOST_UPGRADE_NEEDED: { error: HOSTED_API_ERROR.HOST_UPGRADE_NEEDED },
  DEVICE_REMOVED: { error: HOSTED_API_ERROR.DEVICE_REMOVED },
  CHILD_REPOSITORY_LOCKED: { error: HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED },
  TASK_BLOCK_CYCLE: { error: HOSTED_API_ERROR.TASK_BLOCK_CYCLE },
  TASK_PARENT_CYCLE: { error: HOSTED_API_ERROR.TASK_PARENT_CYCLE },
  TASK_PARENT_HELD: { error: HOSTED_API_ERROR.TASK_PARENT_HELD },
  HOST_PAIRING_HELD: { error: HOSTED_API_ERROR.HOST_PAIRING_HELD },
  ALREADY_WRITTEN: { error: HOSTED_API_ERROR.ALREADY_WRITTEN },
  MEMORY_OFF: { error: HOSTED_API_ERROR.MEMORY_OFF },
  MEMORY_CREDENTIAL: { error: HOSTED_API_ERROR.MEMORY_CREDENTIAL },
  MEMORY_FULL: { error: HOSTED_API_ERROR.MEMORY_FULL },
} as const satisfies Record<string, HostedRefusal>;

export function planLimitReached(resetsAt: number | undefined): HostedRefusal {
  return resetsAt === undefined
    ? HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED
    : { ...HOSTED_REFUSAL.AGENT_PLAN_LIMIT_REACHED, resetsAt };
}

export function localAgentRefused(
  localAgentRefusal: LocalAgentRefusal,
  refusedDevice?: RefusedDevice,
): HostedRefusal {
  return {
    ...HOSTED_REFUSAL.LOCAL_AGENT_REFUSED,
    localAgentRefusal,
    ...(refusedDevice === undefined ? undefined : { refusedDevice }),
  };
}

export function extraRepositoryRefused(
  extraRepositoryRefusal: ExtraRepositoryRefusal,
  refusedRepository?: string,
): HostedRefusal {
  return {
    ...HOSTED_REFUSAL.EXTRA_REPOSITORY_REFUSED,
    extraRepositoryRefusal,
    ...(refusedRepository === undefined ? undefined : { refusedRepository }),
  };
}

export function hostUpgradeNeeded(minimumVersion: string): HostedRefusal {
  return { ...HOSTED_REFUSAL.HOST_UPGRADE_NEEDED, minimumVersion };
}

export const HOST_REMOVED_REFUSAL: HostedRefusal = {
  ...HOSTED_REFUSAL.INVALID_TOKEN,
  hostRemoved: true,
};

export function hostPairingHeld(heldUntil: number): HostedRefusal {
  return { ...HOSTED_REFUSAL.HOST_PAIRING_HELD, heldUntil };
}

export function credentialMissing(provider: ModelProvider): HostedRefusal {
  return { ...HOSTED_REFUSAL.AGENT_CREDENTIAL_MISSING, provider };
}

export function installedSkillRefused(
  refusal: typeof HOSTED_REFUSAL.SKILL_NAME_TAKEN | typeof HOSTED_REFUSAL.SKILL_FILES_REFUSED,
  skillName: string | undefined,
  skillRefusal?: InstalledSkillRefusal,
): HostedRefusal {
  return {
    ...refusal,
    ...(skillName === undefined ? undefined : { skillName }),
    ...(skillRefusal === undefined ? undefined : { skillRefusal }),
  };
}

export function repositoryNotReachable(unreached: RepositoryUnreached): HostedRefusal {
  return { ...HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE, unreached };
}

export function upstreamRefused(upstreamStatus: number): HostedRefusal {
  return { ...HOSTED_REFUSAL.UPSTREAM_ERROR, upstreamStatus };
}

export function hostedCarriesBearer(request: Request): boolean {
  return request.headers.has("authorization");
}

export const HOSTED_BYTES_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "cross-origin-resource-policy": "same-origin",
} as const;

export function hostedStoreOrUnavailable<A, R>(
  effect: Effect.Effect<A, StoreFailure, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return effect.pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

export function resolvedAccount<Input>(
  resolveUserId: UserIdResolver<Input>,
  input: Input,
): Effect.Effect<Option.Option<string>, HostedRefusal> {
  return resolveUserId(input).pipe(
    Effect.tapError((failure) => Effect.logWarning("the auth service resolved no caller", failure)),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

export const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: { readonly resolveUserId: UserIdResolver },
  request: Request,
): Effect.fn.Return<string, HostedRefusal, Scope.Scope> {
  const account = yield* resolvedAccount(seams.resolveUserId, request);
  if (Option.isNone(account))
    return yield* Effect.fail<HostedRefusal>(HOSTED_REFUSAL.INVALID_TOKEN);
  yield* Effect.annotateLogsScoped({ userId: account.value });
  return account.value;
});

export const pathUuid = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail<HostedRefusal>(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

export const uuidOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(name);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail<HostedRefusal>(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return yield* pathUuid(id);
});

export function hostedRefusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

function hostedRefusalResponse(refusal: HostedRefusal): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(refusal, {
    status: HOSTED_REFUSAL_STATUS[refusal.error],
  });
}

export const hostedNotFoundRoute: Layer.Layer<never, never, HttpRouter.HttpRouter> = HttpRouter.add(
  ANY_METHOD,
  ANY_PATH,
  hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND),
);

const HTTP_METHOD = { HEAD: "HEAD" } as const;

function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers],
  });
}

export const effectPassthrough = /* @__PURE__ */ Effect.fn("web/effectPassthrough")(function* <R>(
  handle: (request: Request) => Effect.Effect<Response, unknown, R>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  R | HttpServerRequest.HttpServerRequest
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const answer = yield* Effect.orDie(handle(request));
  return incoming.method === HTTP_METHOD.HEAD
    ? bodylessAnswer(answer)
    : HttpServerResponse.raw(answer);
});

export function hostedJsonResponse<Body extends object>(
  status: number,
  body: Body,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "cache-control": HOSTED_CACHE_CONTROL },
  });
}

export const readBodyBytesEffect = /* @__PURE__ */ Effect.fn("web/readBodyBytesEffect")(function* (
  maximumBytes: number,
): Effect.fn.Return<Uint8Array, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const chunks: Uint8Array[] = [];
  let counted = 0;
  const received = yield* Stream.runForEachWhile(request.stream, (chunk) => {
    chunks.push(chunk);
    counted += chunk.byteLength;
    return Effect.succeed(counted <= maximumBytes);
  }).pipe(
    Effect.map(() => counted),
    Effect.mapError((): HostedRefusal => HOSTED_REFUSAL.INVALID_REQUEST),
  );
  if (received > maximumBytes) return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
});

export function jsonOf(text: string): UnparsedWireValue {
  const parsed = Result.try(() => JSON.parse(text));
  return unparsedWire(Result.isSuccess(parsed) ? parsed.success : undefined);
}

export function parseJsonBytes(bytes: Uint8Array): Effect.Effect<UnparsedWireValue, HostedRefusal> {
  return Effect.try({
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as UnparsedWireValue,
    catch: () => HOSTED_REFUSAL.INVALID_REQUEST,
  });
}
