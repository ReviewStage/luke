import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { connect as connectHttp2, constants as http2Constants } from "node:http2";
import {
  isRecord,
  PUSH_ENVIRONMENT,
  type PushEnvironment,
  text,
  type UnparsedWireValue,
} from "../core.js";

/**
 * The deployment's Apple push credential, read from the environment. The
 * private key is the signing key of an APNs auth key (a `.p8`), the team and
 * key ids name it to Apple, and the bundle id is the app the token belongs
 * to. Any one absent or blank means no sender is constructed at all — the
 * same kill switch the OpenAI and vault endpoints keep — so a deployment
 * without the credential addresses no phone rather than failing on one.
 */
export const APNS_ENVIRONMENT = {
  TEAM_ID: "APNS_TEAM_ID",
  KEY_ID: "APNS_KEY_ID",
  PRIVATE_KEY: "APNS_PRIVATE_KEY",
  BUNDLE_ID: "APNS_BUNDLE_ID",
} as const;

export interface ApnsCredentials {
  teamId: string;
  keyId: string;
  /** The PEM-encoded EC private key of the auth key. */
  privateKey: string;
  bundleId: string;
}

function trimmedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Reads the credential, or nothing when any part is missing. A dashboard
 * often stores a multi-line key with its newlines escaped, so the two-character
 * escape is turned back into the line break the PEM parser needs.
 */
export function apnsCredentialsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): ApnsCredentials | undefined {
  const teamId = trimmedText(environment[APNS_ENVIRONMENT.TEAM_ID]);
  const keyId = trimmedText(environment[APNS_ENVIRONMENT.KEY_ID]);
  const privateKey = trimmedText(environment[APNS_ENVIRONMENT.PRIVATE_KEY])?.replace(/\\n/g, "\n");
  const bundleId = trimmedText(environment[APNS_ENVIRONMENT.BUNDLE_ID]);
  if (!teamId || !keyId || !privateKey || !bundleId) return undefined;
  return { teamId, keyId, privateKey, bundleId };
}

/** Apple's two gateways, one per token environment. */
export const APNS_HOST = {
  [PUSH_ENVIRONMENT.PRODUCTION]: "api.push.apple.com",
  [PUSH_ENVIRONMENT.SANDBOX]: "api.sandbox.push.apple.com",
} as const;

/**
 * How long one provider token is reused before a fresh one is signed. Apple
 * refuses a token older than an hour and throttles one refreshed more often
 * than every twenty minutes; fifty minutes sits inside both.
 */
export const APNS_PROVIDER_TOKEN_LIFETIME_MS = 50 * 60_000;

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Signs the ES256 provider token Apple authenticates a request with: the key
 * id in the header, the team id and issue time in the claims, and the raw
 * `r || s` signature JOSE expects rather than the DER a signer emits by default.
 */
export function apnsProviderToken(
  credentials: Pick<ApnsCredentials, "teamId" | "keyId" | "privateKey">,
  issuedAt: number,
): string {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const claims = base64Url(
    JSON.stringify({ iss: credentials.teamId, iat: Math.floor(issuedAt / 1000) }),
  );
  const signingInput = `${header}.${claims}`;
  const key: KeyObject = createPrivateKey(credentials.privateKey);
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64Url(signature)}`;
}

/**
 * The interruption levels this build may ask for. Time-sensitive is the
 * loudest a notification may be without a special entitlement: it breaks
 * through Focus for a session that needs the developer, and nothing here
 * ever asks for critical.
 */
export const APNS_INTERRUPTION_LEVEL = {
  PASSIVE: "passive",
  ACTIVE: "active",
  TIME_SENSITIVE: "time-sensitive",
} as const;

export type ApnsInterruptionLevel =
  (typeof APNS_INTERRUPTION_LEVEL)[keyof typeof APNS_INTERRUPTION_LEVEL];

export interface ApnsAlert {
  title: string;
  subtitle?: string;
  body?: string;
}

/** The `aps` dictionary the system reads, as Apple documents it. */
export interface ApnsSystemFields {
  alert: ApnsAlert;
  sound?: string;
  "interruption-level"?: ApnsInterruptionLevel;
  "thread-id"?: string;
}

/**
 * One notification's payload: the `aps` dictionary, and the custom keys the
 * app reads on a tap, which Apple places beside `aps` at the top level of the
 * wire object. Every custom value is a string the caller already bounded.
 */
export interface ApnsPayload {
  aps: ApnsSystemFields;
  custom: Readonly<Record<string, string>>;
}

/** The payload as it travels: `aps` and the custom keys as one flat JSON object. */
export function apnsWireBody(payload: ApnsPayload): string {
  return JSON.stringify({ ...payload.custom, aps: payload.aps });
}

export interface ApnsNotification {
  token: string;
  environment: PushEnvironment;
  payload: ApnsPayload;
  /** Later notifications with the same id replace earlier ones still on the lock screen. */
  collapseId?: string;
}

/**
 * What became of one send. A gone token is the one answer that changes state
 * here: the row behind it is deleted, because Apple has said the phone will
 * never take another. Refused means this deployment's credential or topic
 * was rejected and no retry will help; failed is a transient answer the next
 * tick may retry.
 */
export const APNS_DELIVERY = {
  DELIVERED: "delivered",
  TOKEN_GONE: "token-gone",
  REFUSED: "refused",
  FAILED: "failed",
} as const;

export type ApnsDelivery = (typeof APNS_DELIVERY)[keyof typeof APNS_DELIVERY];

/** The reasons Apple gives for a token no notification will ever reach again. */
const TOKEN_GONE_REASONS: ReadonlySet<string> = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
]);

export interface ApnsTransportRequest {
  host: string;
  path: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface ApnsTransportAnswer {
  status: number;
  body: string;
}

/**
 * The one seam between the sender and the network: one HTTP/2 POST, answered
 * with a status and a body. Production speaks to Apple; tests hand back an
 * answer.
 */
export interface ApnsTransport {
  send(request: ApnsTransportRequest): Promise<ApnsTransportAnswer>;
  close(): Promise<void>;
}

const APNS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * HTTP/2 over Node's own client, one connection per gateway host, kept open
 * for the life of the sender so a tick's notifications share it and closed
 * when the sender is.
 */
export function http2ApnsTransport(): ApnsTransport {
  const sessions = new Map<string, ReturnType<typeof connectHttp2>>();

  /**
   * One connection per gateway, replaced when Apple ends it: a session that
   * errors, is told to go away, or closes leaves the map at once, so the next
   * send opens a fresh one instead of writing into a dead socket. The error
   * listener is the session's own, attached once, so a long-lived connection
   * does not gather one per notification.
   */
  function sessionFor(host: string) {
    const held = sessions.get(host);
    if (held && !held.closed && !held.destroyed) return held;
    const session = connectHttp2(`https://${host}:443`);
    const forget = () => {
      if (sessions.get(host) === session) sessions.delete(host);
    };
    session.on("error", forget);
    session.on("goaway", forget);
    session.on("close", forget);
    sessions.set(host, session);
    return session;
  }

  return {
    send(request) {
      return new Promise<ApnsTransportAnswer>((resolve, reject) => {
        const session = sessionFor(request.host);
        const stream = session.request({
          [http2Constants.HTTP2_HEADER_METHOD]: "POST",
          [http2Constants.HTTP2_HEADER_PATH]: request.path,
          ...request.headers,
        });
        const timer = setTimeout(() => {
          stream.close(http2Constants.NGHTTP2_CANCEL);
          reject(new Error("APNs request timed out"));
        }, APNS_REQUEST_TIMEOUT_MS);
        let status = 0;
        const chunks: Buffer[] = [];
        stream.on("response", (headers) => {
          status = Number(headers[http2Constants.HTTP2_HEADER_STATUS] ?? 0);
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          clearTimeout(timer);
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
        // A session failing mid-flight surfaces on its streams as well, so
        // the request's own error event is the one place a send fails from.
        stream.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        stream.end(request.body);
      });
    },
    async close() {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(
        open.map(
          (session) =>
            new Promise<void>((resolve) => {
              if (session.closed || session.destroyed) {
                resolve();
                return;
              }
              session.once("close", () => resolve());
              session.close();
            }),
        ),
      );
    },
  };
}

export interface ApnsSenderOptions {
  credentials: ApnsCredentials;
  transport?: ApnsTransport;
  now?: () => number;
}

function reasonFrom(body: string): string | undefined {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a runtime value; isRecord and text below validate the wire shape.
    parsed = JSON.parse(body) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? text(parsed.reason) : undefined;
}

/**
 * Sends alert notifications to Apple under one deployment credential. The
 * provider token is signed lazily and reused inside its lifetime; the
 * notification body is the payload the caller composed and nothing is added
 * to it here beyond the headers Apple requires to route it.
 */
export class ApnsSender {
  readonly #credentials: ApnsCredentials;
  readonly #transport: ApnsTransport;
  readonly #now: () => number;
  #providerToken: { value: string; issuedAt: number } | undefined;

  constructor(options: ApnsSenderOptions) {
    this.#credentials = options.credentials;
    this.#transport = options.transport ?? http2ApnsTransport();
    this.#now = options.now ?? Date.now;
  }

  #currentProviderToken(): string {
    const now = this.#now();
    if (
      this.#providerToken === undefined ||
      now - this.#providerToken.issuedAt >= APNS_PROVIDER_TOKEN_LIFETIME_MS
    ) {
      this.#providerToken = { value: apnsProviderToken(this.#credentials, now), issuedAt: now };
    }
    return this.#providerToken.value;
  }

  async send(notification: ApnsNotification): Promise<ApnsDelivery> {
    const headers = {
      authorization: `bearer ${this.#currentProviderToken()}`,
      "apns-topic": this.#credentials.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
      "content-type": "application/json",
      ...(notification.collapseId ? { "apns-collapse-id": notification.collapseId } : undefined),
    };

    let answer: ApnsTransportAnswer;
    try {
      answer = await this.#transport.send({
        host: APNS_HOST[notification.environment],
        path: `/3/device/${notification.token}`,
        headers,
        body: apnsWireBody(notification.payload),
      });
    } catch {
      return APNS_DELIVERY.FAILED;
    }

    if (answer.status === 200) return APNS_DELIVERY.DELIVERED;
    if (answer.status === 410) return APNS_DELIVERY.TOKEN_GONE;
    const reason = reasonFrom(answer.body);
    if (reason !== undefined && TOKEN_GONE_REASONS.has(reason)) return APNS_DELIVERY.TOKEN_GONE;
    if (answer.status === 403 || answer.status === 400) return APNS_DELIVERY.REFUSED;
    return APNS_DELIVERY.FAILED;
  }

  close(): Promise<void> {
    return this.#transport.close();
  }
}
