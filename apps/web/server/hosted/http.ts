import type { HostedApiError, HostedQuota } from "../core.js";

/**
 * The response vocabulary the hosted endpoints share. Every answer is JSON,
 * and every refusal names its reason from the wire contract in
 * `@sidecar/hosted` — the same module the desktop's hosted
 * clients validate against, so an error slug cannot drift between the two.
 */

export { HOSTED_API_ERROR, type HostedApiError } from "../core.js";

export const HOSTED_HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
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

export const BODY_READ = {
  READ: "read",
  TOO_LARGE: "too-large",
  UNREADABLE: "unreadable",
} as const;

export type BodyRead =
  | { outcome: typeof BODY_READ.READ; text: string }
  | { outcome: typeof BODY_READ.TOO_LARGE }
  | { outcome: typeof BODY_READ.UNREADABLE };

/**
 * Reads the body as it streams, counting bytes rather than trusting a
 * Content-Length the sender may omit or misstate, and stops reading the
 * moment the bound is passed so an oversized request is never held whole.
 */
export async function readBoundedBody(request: Request, maximumBytes: number): Promise<BodyRead> {
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
