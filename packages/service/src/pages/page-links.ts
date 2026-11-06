import { createHmac, timingSafeEqual } from "node:crypto";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { PAGE_OWNER, type PageOwner, pageVersionNumberSchema } from "@repo/features/page-wire";
import { Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  AUTH_DEPLOYMENT_ENVIRONMENT,
  AUTH_SECRET_ENVIRONMENT,
  authDeployment,
  DEPLOYMENT_ENVIRONMENT,
} from "../auth/auth-deployment.js";
import { text } from "../core.js";
import { CRON_ENVIRONMENT } from "../maintenance/maintenance-bounds.js";

export const AGENT_PAGES_ENVIRONMENT = {
  SECRET: "AGENT_PAGES_SECRET",
  ORIGIN: "AGENT_PAGES_ORIGIN",
} as const;

export const PAGE_LINK_ROUTE = {
  STEP: "p",
  PATH: "/api/pages/sandbox",
  TOKEN_QUERY: "token",
} as const;

const FRAME_DESTINATION = { HEADER: "sec-fetch-dest", FRAME: "iframe" } as const;

const PAGE_LINK_LIFETIME = Duration.minutes(1);

const MINIMUM_SECRET_CHARACTERS = 32;

const PAGE_LINK_PURPOSE = "app-page-link-v1";

const OTHER_SECRETS = [
  AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
  AUTH_DEPLOYMENT_ENVIRONMENT.PROXY_SECRET,
  CRON_ENVIRONMENT.CRON_SECRET,
] as const;

const SANDBOX_UNSET = {
  NOT_PRODUCTION: `${AGENT_PAGES_ENVIRONMENT.SECRET} or ${AGENT_PAGES_ENVIRONMENT.ORIGIN} is set on a deployment that is not production, so pages open in the Mac app.`,
  HALF: `${AGENT_PAGES_ENVIRONMENT.SECRET} and ${AGENT_PAGES_ENVIRONMENT.ORIGIN} are not both set, so pages open in the Mac app.`,
  SHORT: `${AGENT_PAGES_ENVIRONMENT.SECRET} is shorter than ${MINIMUM_SECRET_CHARACTERS} characters, so it is read as unset and pages open in the Mac app.`,
  SHARED: `${AGENT_PAGES_ENVIRONMENT.SECRET} holds the value of another of the deployment's secrets, so it is read as unset and pages open in the Mac app.`,
  ORIGIN: `${AGENT_PAGES_ENVIRONMENT.ORIGIN} names an origin other than ${PAGE_SANDBOX_ORIGIN}, the one the deployment's routing locks to the page route, so it is read as unset and pages open in the Mac app.`,
} as const;

export interface PageSandbox {
  readonly origin: string;
  readonly key: Redacted.Redacted;
  readonly appOrigins: readonly string[];
}

export interface LinkedPage {
  readonly userId: string;
  readonly owner: PageOwner;
  readonly pageId: string;
  readonly version: number;
}

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

function signatureOf(key: Redacted.Redacted, claims: string): string {
  return createHmac("sha256", Redacted.value(key))
    .update(`${PAGE_LINK_PURPOSE}.${claims}`)
    .digest("base64url");
}

function sameText(offered: string, held: string): boolean {
  const left = Buffer.from(offered);
  const right = Buffer.from(held);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function loadsAFrame(request: Request): boolean {
  return request.headers.get(FRAME_DESTINATION.HEADER) === FRAME_DESTINATION.FRAME;
}

function originOf(address: string): string | undefined {
  return URL.canParse(address) ? new URL(address).origin : undefined;
}

export function mintPageLink(sandbox: PageSandbox, page: LinkedPage, now: number): string {
  const until = now + Duration.toMillis(PAGE_LINK_LIFETIME);
  const claims = Buffer.from(
    Schema.encodeSync(PageLinkClaimsJson)({ site: sandbox.origin, ...page, until }),
  ).toString("base64url");
  const token = `${claims}.${signatureOf(sandbox.key, claims)}`;
  return new URL(`/${PAGE_LINK_ROUTE.STEP}/${token}`, sandbox.origin).href;
}

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

export class PageLinks extends Context.Service<
  PageLinks,
  { readonly sandbox: PageSandbox | undefined }
>()("PageLinks") {}

export const pageLinksFromEnvironment: Layer.Layer<PageLinks> = Layer.effect(
  PageLinks,
  Effect.suspend(() => {
    const { sandbox, unset } = pageSandboxIn(process.env);
    return Effect.as(unset === undefined ? Effect.void : Effect.logWarning(unset), { sandbox });
  }),
);
