/**
 * agent-state-blobs.ts -- Luke's private store for device agents' saved state: one upload minted for one fresh path, one short-lived read of a path, and paths deleted.
 *
 * A device agent's host saves an encrypted bundle of what no one can
 * rebuild of the agent at its turn's end, and restores the newest at a cold
 * launch (`@luke/database/models/agent-state-store` keeps the record of each
 * generation). A bundle is up to `DEVICE_AGENT_BOUNDS.MAX_STATE_BYTES`, far past what
 * a Vercel function takes in one request, so its bytes never pass through
 * one: they go between the host and a private Vercel Blob store directly,
 * and the host never holds a credential of the store. The service mints,
 * for the one path it chose, a presigned upload the host PUTs the bundle to,
 * which takes no more than the bound and never writes over a blob already
 * there, and later a presigned read the host GETs it back from; each stands
 * for minutes, and a URL is the whole of what it grants.
 *
 * The store is the one connected to the deployment's project, named by the
 * `BLOB_STORE_ID` its connection sets, and asked under the function's own
 * OIDC token, as Vercel Sandbox is (`vercel-sandbox-api.ts`); a deployment
 * without the id has no store, and every call here answers unavailable.
 * The three calls are copied from `@vercel/blob` 2.8.2 rather than taken
 * from it, as the Sandbox calls are, so the store costs no dependency: a
 * signed token the store issues for one path and its one operation
 * (`issueSignedToken`), the URL for that path signed with it, an HMAC the
 * store checks, made here (`presignUrl`), and a delete (`del`). Re-read
 * those three when it moves.
 *
 * A path is `agent-state/<agent id>/<fresh uuid>` (`freshAgentStatePath`),
 * and no path says whose account it is. What a failure carries is the call,
 * Vercel's status and error code, or the kind of the cause where Vercel
 * never answered, and never its words, a URL, a token, or a path; nothing
 * of a bundle passes through this module at all.
 */

import { createHmac, randomUUID } from "node:crypto";
import { DEVICE_AGENT_BOUNDS } from "@luke/features/device-agent-wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { EXCESS_KEYS, unparsedWire } from "../core.js";
import { jsonOf } from "../http/http-effect.js";
import { deploymentOidcToken, type OidcTokenRead } from "./vercel-sandbox-api.js";

export const AGENT_STATE_BLOBS = {
  /** How long a minted upload stands: a bundle at its bound sent over a slow uplink. */
  UPLOAD_FOR: Duration.minutes(15),
  /** How long a minted read stands: a launch line claimed by its device, and the download it starts. */
  READ_FOR: Duration.hours(1),
  /** The folder every agent's bundles stand under, one folder per agent. */
  ROOT: "agent-state",
} as const;

/** The deployment's environment variable naming the store, as connecting a Blob store to the project sets it. */
const AGENT_STATE_BLOBS_ENVIRONMENT = { STORE_ID: "BLOB_STORE_ID" } as const;

/** The calls this module makes of the store, which a failure names. */
const AGENT_STATE_BLOB_CALL = {
  SIGN: "sign",
  DELETE: "delete",
} as const;

type AgentStateBlobCall = (typeof AGENT_STATE_BLOB_CALL)[keyof typeof AGENT_STATE_BLOB_CALL];

/** The store's API, as `@vercel/blob` 2.8.2 asks it. */
const BLOB_API = {
  ORIGIN: "https://vercel.com",
  PATH: "/api/blob",
  /** The API version the SDK sends on every call, and a host on its upload. */
  VERSION: "13",
  /** The store's own prefix on an id, which every header and host name leaves off. */
  STORE_PREFIX: "store_",
  /** How the store's host names a private store's blobs: `https://<store>.private.blob.vercel-storage.com/<path>`. */
  PRIVATE_HOST_SUFFIX: ".private.blob.vercel-storage.com",
} as const;

/** The operations a signed token is issued for, as the store names them. */
const SIGNED_OPERATION = {
  PUT: "put",
  GET: "get",
} as const;

type SignedOperation = (typeof SIGNED_OPERATION)[keyof typeof SIGNED_OPERATION];

/** The query parameters a presigned URL carries, as the store reads them. */
const PRESIGN_QUERY = {
  MAXIMUM_SIZE: "vercel-blob-maximum-size-in-bytes",
  ADD_RANDOM_SUFFIX: "vercel-blob-add-random-suffix",
  ALLOW_OVERWRITE: "vercel-blob-allow-overwrite",
  DELEGATION: "vercel-blob-delegation",
  SIGNATURE: "vercel-blob-signature",
} as const;

/** The most characters a failure's detail keeps. */
const DETAIL_CHARS = 200;

/** One path's upload: the URL the host PUTs the bundle to with the headers given, when the URL stops being taken, and the most bytes it takes. */
interface AgentStateUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
  readonly maxBytes: number;
}

/** One path's read: the URL the host GETs the bundle from, and when it stops being taken. */
interface AgentStateRead {
  readonly url: string;
  readonly expiresAt: Date;
}

/** The store did not do what was asked, or the deployment has none; nothing was granted. */
export class AgentStateBlobsUnavailable extends Data.TaggedError("AgentStateBlobsUnavailable")<{
  readonly call?: AgentStateBlobCall;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
}> {
  override get message(): string {
    const asked =
      this.call === undefined ? "the agent state store" : `the agent state store's ${this.call}`;
    const answer =
      this.status === undefined ? `${asked} was unavailable` : `${asked} answered ${this.status}`;
    const coded = this.code === undefined ? answer : `${answer} (${this.code})`;
    return this.detail === undefined ? coded : `${coded}: ${this.detail}`;
  }
}

/** What the store answers in its place where the deployment has none. */
const UNCONFIGURED = new AgentStateBlobsUnavailable({ detail: "no BLOB_STORE_ID" });

/** The store as the service asks it. */
export interface AgentStateBlobsService {
  /** Whether the deployment has a store, so a sweep with nothing it could delete passes over state rather than failing. */
  readonly configured: boolean;
  /** One upload to the path given, which must be a fresh one (`freshAgentStatePath`), since it never writes over a blob. */
  readonly mintUpload: (
    path: string,
  ) => Effect.Effect<AgentStateUpload, AgentStateBlobsUnavailable>;
  /** One read of the path given. */
  readonly mintRead: (path: string) => Effect.Effect<AgentStateRead, AgentStateBlobsUnavailable>;
  /** Deletes the paths given; a path with no blob counts as deleted. */
  readonly remove: (paths: readonly string[]) => Effect.Effect<void, AgentStateBlobsUnavailable>;
}

export class AgentStateBlobs extends Context.Service<AgentStateBlobs, AgentStateBlobsService>()(
  "AgentStateBlobs",
) {}

/** A signed token's answer: the public delegation every URL carries, and the secret it is signed with. */
const SignedTokenSchema = Schema.Struct({
  delegationToken: Schema.String,
  clientSigningToken: Schema.String,
  validUntil: Schema.Number,
});

/** What a delegation names of itself, in the payload before its first dot. */
const DelegationSchema = Schema.Struct({ storeId: Schema.String });

/** Vercel's refusal, where it wrote one. */
const ErrorAnswerSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.optional(Schema.String) }),
});

const readSignedToken = readEither(SignedTokenSchema, { excess: EXCESS_KEYS.DROP });
const readDelegation = readEither(DelegationSchema, { excess: EXCESS_KEYS.DROP });
const readErrorAnswer = readEither(ErrorAnswerSchema, { excess: EXCESS_KEYS.DROP });

/** The store's id as headers and host names spell it, without the store's own prefix. */
function bareStoreId(storeId: string): string {
  return storeId.startsWith(BLOB_API.STORE_PREFIX)
    ? storeId.slice(BLOB_API.STORE_PREFIX.length)
    : storeId;
}

/** Where a path's blob stands in a private store. */
function blobUrl(storeId: string, path: string): string {
  return `https://${storeId}${BLOB_API.PRIVATE_HOST_SUFFIX}/${path}`;
}

/** The store id a delegation names, read from its payload; the store verifies the delegation itself. */
function delegationStore(delegationToken: string): string | undefined {
  const payload = delegationToken.split(".")[0];
  if (payload === undefined) return undefined;
  const decoded = Result.try(() => JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (Result.isFailure(decoded)) return undefined;
  const read = readDelegation(unparsedWire(decoded.success));
  return Result.isSuccess(read) ? bareStoreId(read.success.storeId) : undefined;
}

/**
 * The signature of one operation on one path, with the query entries it
 * signs: the lines `key=value` sorted by their UTF-8 bytes and joined by
 * newlines, signed with the token's secret as HMAC-SHA256, in unpadded
 * base64url, as `@vercel/blob`'s `presign` signs them.
 */
function signature(
  signingToken: string,
  operation: SignedOperation,
  path: string,
  entries: readonly (readonly [string, string])[],
): string {
  const lines = [
    `operation=${operation}`,
    `pathname=${path}`,
    ...entries.map(([key, value]) => `${key}=${value}`),
  ];
  lines.sort((first, second) => Buffer.compare(Buffer.from(first), Buffer.from(second)));
  return createHmac("sha256", signingToken).update(lines.join("\n")).digest("base64url");
}

/** The URL given with the entries, the delegation, and the signature as its query. */
function presigned(
  url: URL,
  entries: readonly (readonly [string, string])[],
  token: typeof SignedTokenSchema.Type,
  signed: string,
): string {
  for (const [key, value] of entries) url.searchParams.set(key, value);
  url.searchParams.set(PRESIGN_QUERY.DELEGATION, token.delegationToken);
  url.searchParams.set(PRESIGN_QUERY.SIGNATURE, signed);
  return url.toString();
}

/** A failure's detail, in one short line. */
function capped(text: string): string {
  return text.length <= DETAIL_CHARS ? text : `${text.slice(0, DETAIL_CHARS)}…`;
}

/** Why a call never reached the store, as its cause's kind alone, since a transport's words may carry what was sent. */
function causeDetail(cause: unknown): string {
  return capped(cause instanceof Error ? cause.name : typeof cause);
}

/** A call's refusal: its status, and Vercel's error code where it wrote one. */
function refused(
  call: AgentStateBlobCall,
  answered: { readonly status: number; readonly text: string },
): AgentStateBlobsUnavailable {
  const read = readErrorAnswer(jsonOf(answered.text));
  const code = Result.isSuccess(read) ? read.success.error.code : undefined;
  return new AgentStateBlobsUnavailable({
    call,
    status: answered.status,
    ...(code === undefined ? undefined : { code }),
  });
}

/** Whether a status is a success. */
function succeeded(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The path of a fresh bundle of the agent's, under its own folder. */
export function freshAgentStatePath(agentId: string): string {
  return [AGENT_STATE_BLOBS.ROOT, agentId, randomUUID()].join("/");
}

/** The store named, asked on the client given under the token the read answers. */
export function agentStateBlobsOver(
  storeId: string,
  readToken: OidcTokenRead,
): Effect.Effect<AgentStateBlobsService, never, HttpClient.HttpClient> {
  const store = bareStoreId(storeId);
  return Effect.map(HttpClient.HttpClient, (client) => {
    /** One call's status and text, or unavailable, with why, where it never answered. */
    const called = (call: AgentStateBlobCall, path: string, body: object) =>
      Effect.gen(function* () {
        const token = yield* Effect.tryPromise({
          try: readToken,
          catch: (cause) => new AgentStateBlobsUnavailable({ call, detail: causeDetail(cause) }),
        });
        const request = HttpClientRequest.post(
          new URL(`${BLOB_API.PATH}${path}`, BLOB_API.ORIGIN),
          {
            headers: {
              authorization: `Bearer ${token}`,
              "x-vercel-blob-store-id": store,
              "x-api-version": BLOB_API.VERSION,
            },
          },
        ).pipe(HttpClientRequest.bodyJsonUnsafe(body));
        const answered = yield* client.execute(request).pipe(
          Effect.flatMap((response) =>
            Effect.map(
              Effect.orElseSucceed(response.text, () => ""),
              (text) => ({ status: response.status, text }),
            ),
          ),
          Effect.scoped,
          Effect.mapError(
            (cause) => new AgentStateBlobsUnavailable({ call, detail: causeDetail(cause) }),
          ),
        );
        if (!succeeded(answered.status)) return yield* refused(call, answered);
        return answered.text;
      });

    /** A token the store signed for the one operation on the one path, standing for the span given. */
    const signedFor = (
      operation: SignedOperation,
      path: string,
      span: Duration.Duration,
      bound?: number,
    ) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const text = yield* called(AGENT_STATE_BLOB_CALL.SIGN, "/signed-token", {
          pathname: path,
          operations: [operation],
          validUntil: now + Duration.toMillis(span),
          ...(bound === undefined ? undefined : { maximumSizeInBytes: bound }),
        });
        const token = readSignedToken(jsonOf(text));
        const signedStore = Result.isSuccess(token)
          ? delegationStore(token.success.delegationToken)
          : undefined;
        if (Result.isFailure(token) || signedStore === undefined) {
          return yield* new AgentStateBlobsUnavailable({
            call: AGENT_STATE_BLOB_CALL.SIGN,
            detail: "an answer that could not be read",
          });
        }
        return { token: token.success, store: signedStore };
      });

    return {
      configured: true,
      mintUpload: (path) =>
        Effect.gen(function* () {
          const { token } = yield* signedFor(
            SIGNED_OPERATION.PUT,
            path,
            AGENT_STATE_BLOBS.UPLOAD_FOR,
            DEVICE_AGENT_BOUNDS.MAX_STATE_BYTES,
          );
          // Note that the bound and the refusal to write over a blob are signed into the URL, so the host cannot loosen them.
          const entries = [
            [PRESIGN_QUERY.MAXIMUM_SIZE, String(DEVICE_AGENT_BOUNDS.MAX_STATE_BYTES)],
            [PRESIGN_QUERY.ADD_RANDOM_SUFFIX, "false"],
            [PRESIGN_QUERY.ALLOW_OVERWRITE, "false"],
          ] as const;
          const url = new URL(`${BLOB_API.PATH}/`, BLOB_API.ORIGIN);
          url.searchParams.set("pathname", path);
          return {
            url: presigned(
              url,
              entries,
              token,
              signature(token.clientSigningToken, SIGNED_OPERATION.PUT, path, entries),
            ),
            headers: {
              "content-type": "application/octet-stream",
              "x-api-version": BLOB_API.VERSION,
              "x-vercel-blob-access": "private",
            },
            expiresAt: new Date(token.validUntil),
            maxBytes: DEVICE_AGENT_BOUNDS.MAX_STATE_BYTES,
          };
        }),
      mintRead: (path) =>
        Effect.gen(function* () {
          const signed = yield* signedFor(SIGNED_OPERATION.GET, path, AGENT_STATE_BLOBS.READ_FOR);
          const url = presigned(
            new URL(blobUrl(signed.store, path)),
            [],
            signed.token,
            signature(signed.token.clientSigningToken, SIGNED_OPERATION.GET, path, []),
          );
          return { url, expiresAt: new Date(signed.token.validUntil) };
        }),
      remove: (paths) =>
        paths.length === 0
          ? Effect.void
          : Effect.asVoid(
              called(AGENT_STATE_BLOB_CALL.DELETE, "/delete", {
                urls: paths.map((path) => blobUrl(store, path)),
              }),
            ),
    };
  });
}

/** The service where the deployment has no store: nothing to delete, and every grant unavailable. */
const unconfigured: AgentStateBlobsService = {
  configured: false,
  mintUpload: () => Effect.fail(UNCONFIGURED),
  mintRead: () => Effect.fail(UNCONFIGURED),
  remove: () => Effect.fail(UNCONFIGURED),
};

/** The store as the deployment runs it: the one its environment names, on the function's own OIDC token, or none. */
export const agentStateBlobsLayer: Layer.Layer<AgentStateBlobs, never, HttpClient.HttpClient> =
  Layer.effect(
    AgentStateBlobs,
    Effect.gen(function* () {
      const named = yield* Config.option(
        Config.String(AGENT_STATE_BLOBS_ENVIRONMENT.STORE_ID),
      ).pipe(Effect.orElseSucceed(() => Option.none<string>()));
      const storeId = Option.getOrUndefined(named)?.trim();
      if (storeId === undefined || storeId === "") return unconfigured;
      return yield* agentStateBlobsOver(storeId, deploymentOidcToken);
    }),
  );
