/**
 * page-links.ts -- a page's short-lived link on the sandbox's own site: minted for an account that reaches one version of one page, and read back by the sandbox's page route alone.
 *
 * A page runs the script an agent wrote, so a browser draws it from a site of
 * its own (`PAGE_SANDBOX_ORIGIN`), never the app's: no cookie of the app's is
 * sent there, and nothing a page runs shares a site with the app. That site
 * holds no session, so a link is its own credential: it names the sandbox it
 * is for, the account it was minted for, the version of the page, and when
 * it lapses, a minute after it was minted, and is signed with HMAC-SHA256
 * under a key nothing outside the service holds (`AGENT_PAGES_SECRET`),
 * checked in constant time. Its claims are readable by whoever holds it, the
 * page's own script among them; the signature is what admits it.
 *
 * A link is minted as a frame loads (`page-frame.ts`), which follows it at
 * once, and every load mints anew, so a link outlives its load only as a
 * replay of that one version to that one account until it lapses. The page
 * route reads the version again on the account's own reach, so an account
 * that lost the task within that minute is refused too.
 *
 * A link is minted and served to a frame's load alone (`loadsAFrame`). In a
 * whole tab a page's script would answer to no `frame-src` of the app's and
 * could send the browser anywhere from a domain of our own, and the link
 * would stand in the tab's history; so a load the browser names as anything
 * but a frame's, or names as nothing, is refused, never served.
 *
 * The deployment has a sandbox only where it is production and its
 * environment names both the key and the origin, and holds them apart: a key
 * shorter than 32 characters or one another of the deployment's secrets
 * holds, and an origin other than the one the deployment's routing locks to
 * the page route, are read as unset, which the build says once by the
 * variables' names. A Preview has no sandbox domain, so it never has a
 * sandbox. Without one every page frame is sent to the page saying pages open
 * in the Mac app, and the page route answers nothing.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { PAGE_SANDBOX_ORIGIN } from "@luke/features/page-frame";
import { PAGE_OWNER, type PageOwner, pageVersionNumberSchema } from "@luke/features/page-wire";
import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import { EVE_HOST_ENVIRONMENT } from "../agents/eve-host/bounds.js";
import {
  AUTH_DEPLOYMENT_ENVIRONMENT,
  AUTH_SECRET_ENVIRONMENT,
  authDeployment,
  DEPLOYMENT_ENVIRONMENT,
} from "../auth/auth-deployment.js";
import { text } from "../core.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";

/** The variables the sandbox is read from; a blank value is absent. */
export const AGENT_PAGES_ENVIRONMENT = {
  /** The key every link is signed with, which only the service holds. */
  SECRET: "AGENT_PAGES_SECRET",
  /** The sandbox's own origin, which must be `PAGE_SANDBOX_ORIGIN`. */
  ORIGIN: "AGENT_PAGES_ORIGIN",
} as const;

/**
 * How a link travels: the step it is served under on the sandbox's own site,
 * ahead of its token, and the page route's own path, which the deployment's
 * routing hands it to with the token moved into a query (the root
 * `vercel.json`).
 */
export const PAGE_LINK_ROUTE = {
  STEP: "p",
  PATH: "/api/pages/sandbox",
  TOKEN_QUERY: "token",
} as const;

/**
 * What a browser names a frame's load as in `Sec-Fetch-Dest`, which no page's
 * script can set: every current browser sends it with every load it makes.
 */
const FRAME_DESTINATION = { HEADER: "sec-fetch-dest", FRAME: "iframe" } as const;

/** How long a link admits its page: long enough for the frame that asked for it to follow it, and no longer. */
const PAGE_LINK_LIFETIME = Duration.minutes(1);

/** The fewest characters a link's key may have. */
const MINIMUM_SECRET_CHARACTERS = 32;

/** What a link's signature is made over ahead of its claims, so no other MAC under the key could stand for one. */
const PAGE_LINK_PURPOSE = "luke-page-link-v1";

/** The deployment's other secrets, none of whose values the link's key may hold. */
const OTHER_SECRETS = [
  AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
  AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_SECRET,
  CRON_ENVIRONMENT.CRON_SECRET,
  EVE_HOST_ENVIRONMENT.DEPLOYMENT_SECRET,
] as const;

/** Why the environment's sandbox is read as none, said once by the build, by the variables' names alone. */
const SANDBOX_UNSET = {
  NOT_PRODUCTION: `${AGENT_PAGES_ENVIRONMENT.SECRET} or ${AGENT_PAGES_ENVIRONMENT.ORIGIN} is set on a deployment that is not production, so pages open in the Mac app.`,
  HALF: `${AGENT_PAGES_ENVIRONMENT.SECRET} and ${AGENT_PAGES_ENVIRONMENT.ORIGIN} are not both set, so pages open in the Mac app.`,
  SHORT: `${AGENT_PAGES_ENVIRONMENT.SECRET} is shorter than ${MINIMUM_SECRET_CHARACTERS} characters, so it is read as unset and pages open in the Mac app.`,
  SHARED: `${AGENT_PAGES_ENVIRONMENT.SECRET} holds the value of another of the deployment's secrets, so it is read as unset and pages open in the Mac app.`,
  ORIGIN: `${AGENT_PAGES_ENVIRONMENT.ORIGIN} names an origin other than ${PAGE_SANDBOX_ORIGIN}, the one the deployment's routing locks to the page route, so it is read as unset and pages open in the Mac app.`,
} as const;

/** A deployment's sandbox: where its pages are served, the key their links are signed with, and the app's own origins, which alone may frame them. */
export interface PageSandbox {
  readonly origin: string;
  readonly key: Redacted.Redacted;
  readonly appOrigins: readonly string[];
}

/** One version of one page, as a link admits it to the account it was minted for. */
export interface LinkedPage {
  readonly userId: string;
  readonly owner: PageOwner;
  readonly pageId: string;
  readonly version: number;
}

/** What a link claims: the page it admits and to whom, the sandbox it is for, and when it lapses, in milliseconds since the epoch. */
const PageLinkClaimsJson = Schema.fromJsonString(
  Schema.Struct({
    site: Schema.String,
    userId: Schema.String,
    owner: Schema.Union([
      Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.TASK), taskId: Schema.String }),
      Schema.Struct({ kind: Schema.Literal(PAGE_OWNER.AGENT), agentId: Schema.String }),
    ]),
    pageId: Schema.String,
    version: pageVersionNumberSchema,
    until: Schema.Number,
  }),
);

/** The signature of a link's encoded claims under the key, as base64url. */
function signatureOf(key: Redacted.Redacted, claims: string): string {
  return createHmac("sha256", Redacted.value(key))
    .update(`${PAGE_LINK_PURPOSE}.${claims}`)
    .digest("base64url");
}

/** Whether two runs of text are the same, compared in time that does not hang on where they differ. */
function sameText(offered: string, held: string): boolean {
  const left = Buffer.from(offered);
  const right = Buffer.from(held);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether the browser says the request loads a frame: the one load a page or its link is answered to. */
export function loadsAFrame(request: Request): boolean {
  return request.headers.get(FRAME_DESTINATION.HEADER) === FRAME_DESTINATION.FRAME;
}

/** An address's origin, where it is one; nothing for anything that does not parse. */
function originOf(address: string): string | undefined {
  return URL.canParse(address) ? new URL(address).origin : undefined;
}

/** The link that admits one version of one page to the account, from `now` until its lifetime has passed. */
export function mintPageLink(sandbox: PageSandbox, page: LinkedPage, now: number): string {
  const until = now + Duration.toMillis(PAGE_LINK_LIFETIME);
  const claims = Buffer.from(
    Schema.encodeSync(PageLinkClaimsJson)({ site: sandbox.origin, ...page, until }),
  ).toString("base64url");
  const token = `${claims}.${signatureOf(sandbox.key, claims)}`;
  return new URL(`/${PAGE_LINK_ROUTE.STEP}/${token}`, sandbox.origin).href;
}

/**
 * The page a link's token admits at `now`: nothing for a token the
 * sandbox's key did not sign, one minted for another sandbox, or one that has
 * lapsed. Note that the signature is checked before the claims are read, so
 * nothing a caller wrote is decoded unless the service wrote it.
 */
export function readPageLink(
  sandbox: PageSandbox,
  token: string,
  now: number,
): LinkedPage | undefined {
  const [claims, signature, ...rest] = token.split(".");
  if (claims === undefined || signature === undefined || rest.length > 0) return undefined;
  if (!sameText(signature, signatureOf(sandbox.key, claims))) return undefined;
  const read = Schema.decodeUnknownOption(PageLinkClaimsJson)(
    Buffer.from(claims, "base64url").toString("utf8"),
  );
  if (Option.isNone(read)) return undefined;
  const { site, until, ...page } = read.value;
  return site === sandbox.origin && now < until ? page : undefined;
}

/** The sandbox an environment record names, or why it names none: nothing for either where both variables are unset. */
function pageSandboxIn(environment: Readonly<Record<string, string | undefined>>): {
  readonly sandbox: PageSandbox | undefined;
  readonly unset: string | undefined;
} {
  const secret = text(environment[AGENT_PAGES_ENVIRONMENT.SECRET]);
  const origin = text(environment[AGENT_PAGES_ENVIRONMENT.ORIGIN]);
  const none = (unset: string | undefined) => ({ sandbox: undefined, unset });
  if (secret === undefined && origin === undefined) return none(undefined);
  if (environment[AUTH_DEPLOYMENT_ENVIRONMENT.ENVIRONMENT] !== DEPLOYMENT_ENVIRONMENT.PRODUCTION) {
    return none(SANDBOX_UNSET.NOT_PRODUCTION);
  }
  if (secret === undefined || origin === undefined) return none(SANDBOX_UNSET.HALF);
  if (secret.length < MINIMUM_SECRET_CHARACTERS) return none(SANDBOX_UNSET.SHORT);
  const shared = OTHER_SECRETS.some((name) => {
    const other = text(environment[name]);
    return other !== undefined && sameText(secret, other);
  });
  if (shared) return none(SANDBOX_UNSET.SHARED);
  if (originOf(origin) !== PAGE_SANDBOX_ORIGIN) return none(SANDBOX_UNSET.ORIGIN);
  const appOrigins = authDeployment({ ...environment }).ownOrigins;
  return {
    sandbox: { origin: PAGE_SANDBOX_ORIGIN, key: Redacted.make(secret), appOrigins },
    unset: undefined,
  };
}

/** The deployment's page links: its sandbox, where its environment names one. */
export class PageLinks extends Context.Service<
  PageLinks,
  { readonly sandbox: PageSandbox | undefined }
>()("PageLinks") {}

/**
 * The sandbox as this deployment's environment names it, read as the
 * services are built rather than at each request, as `environment.ts` reads
 * the rest; one read as unset is said once, by the variables' names, never a
 * value.
 */
export const pageLinksFromEnvironment: Layer.Layer<PageLinks> = Layer.effect(
  PageLinks,
  Effect.suspend(() => {
    const { sandbox, unset } = pageSandboxIn(process.env);
    return Effect.as(unset === undefined ? Effect.void : Effect.logWarning(unset), { sandbox });
  }),
);
