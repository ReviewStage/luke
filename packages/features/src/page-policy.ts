const CDNJS = "https://cdnjs.cloudflare.com";

const PAGE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNJS}`,
  `style-src 'unsafe-inline' ${CDNJS}`,
  "img-src data: blob:",
  `font-src data: ${CDNJS}`,
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "sandbox allow-scripts",
].join("; ");

export const PAGE_RESPONSE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": PAGE_CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
} as const;

export function sandboxPageResponseHeaders(appOrigins: readonly string[]) {
  const ancestors = appOrigins.length === 0 ? "'none'" : appOrigins.join(" ");
  return {
    ...PAGE_RESPONSE_HEADERS,
    "content-security-policy": `${PAGE_CONTENT_SECURITY_POLICY}; frame-ancestors ${ancestors}`,
    "cache-control": "private, no-store",
  } as const;
}
