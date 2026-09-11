import { HTTP_STATUS, type UnparsedWireValue } from "@sidecar/wire";
import { HOSTED_API_ERROR, type HostedApiError, type HostedQuota } from "../core.js";

/**
 * The response vocabulary the hosted endpoints share. Every answer is JSON,
 * and every refusal names its reason from the wire contract in
 * `@sidecar/hosted` — the same module the desktop's hosted
 * clients validate against, so an error slug cannot drift between the two.
 */

export { HOSTED_API_ERROR, type HostedApiError } from "../core.js";

/** The wire boundary's statuses, plus the ones only a route answers with. */
export const HOSTED_HTTP_STATUS = {
  ...HTTP_STATUS,
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export function jsonResponse<Body extends object>(status: number, body: Body): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface HostedErrorFields {
  quota?: HostedQuota;
  upstreamStatus?: number;
}

export function errorResponse(
  status: number,
  error: HostedApiError,
  extra: HostedErrorFields = {},
): Response {
  const body: { error: HostedApiError } & HostedErrorFields = { error };
  if (extra.quota !== undefined) body.quota = extra.quota;
  if (extra.upstreamStatus !== undefined) body.upstreamStatus = extra.upstreamStatus;
  return jsonResponse(status, body);
}

const BODY_READ = {
  READ: "read",
  TOO_LARGE: "too-large",
  UNREADABLE: "unreadable",
} as const;

type BodyRead =
  | { outcome: typeof BODY_READ.READ; text: string }
  | { outcome: typeof BODY_READ.TOO_LARGE }
  | { outcome: typeof BODY_READ.UNREADABLE };

/**
 * Reads the body as it streams, counting bytes rather than trusting a
 * Content-Length the sender may omit or misstate, and stops reading the
 * moment the bound is passed so an oversized request is never held whole.
 */
async function readBoundedBody(request: Request, maximumBytes: number): Promise<BodyRead> {
  const stream = request.body;
  if (!stream) return { outcome: BODY_READ.UNREADABLE };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { outcome: BODY_READ.TOO_LARGE };
      }
      chunks.push(value);
    }
  } catch {
    return { outcome: BODY_READ.UNREADABLE };
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      outcome: BODY_READ.READ,
      text: new TextDecoder("utf-8", { fatal: true }).decode(joined),
    };
  } catch {
    return { outcome: BODY_READ.UNREADABLE };
  }
}

/**
 * A request's JSON body as the unparsed wire value a schema reads next, or
 * the refusal to answer with: too large past the bound, unreadable, or not
 * JSON. What the value must then be is the endpoint's own schema's to say.
 */
export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<UnparsedWireValue | Response> {
  const body = await readBoundedBody(request, maximumBytes);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  try {
    // SAFETY: JSON.parse answers a runtime value; the endpoint's schema is what holds it to a shape.
    return JSON.parse(body.text) as UnparsedWireValue;
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
}
