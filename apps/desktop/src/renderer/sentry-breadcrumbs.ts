/**
 * sentry-breadcrumbs.ts -- the breadcrumbs a renderer's crash reports may carry: none that carries a LiveKit access token.
 *
 * A renderer's `fetch`, XHR, and console become Sentry breadcrumbs, and the
 * call window's avatar session joins a LiveKit room whose failed join asks
 * `https://<host>/rtc/v1/validate?access_token=…`, the grant's own token in
 * the query. That token may reach the call window and never a crash report,
 * so a breadcrumb that names one anywhere it carries text is dropped whole
 * rather than redacted: a URL or a console line is free text, and a pattern
 * that missed one spelling would send the rest.
 */

import type { Breadcrumb } from "@sentry/electron/renderer";
import { Predicate } from "effect";

/** The query parameter LiveKit carries the participant token in. */
const ACCESS_TOKEN_PARAMETER = "access_token";

/** Whether a breadcrumb's text names the token, in its message or its request's URL. */
function carriesAccessToken(breadcrumb: Breadcrumb): boolean {
  const url: unknown = breadcrumb.data?.url;
  return [breadcrumb.message, url].some(
    (text) => Predicate.isString(text) && text.includes(ACCESS_TOKEN_PARAMETER),
  );
}

/** Sentry's `beforeBreadcrumb`: the breadcrumb as it was, or nothing where it carries a token. */
export function withoutAccessTokens(breadcrumb: Breadcrumb): Breadcrumb | null {
  return carriesAccessToken(breadcrumb) ? null : breadcrumb;
}
