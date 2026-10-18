/**
 * preview-database.ts -- whether a deployment's build makes its Preview's database the Preview's own, and the run that does.
 *
 * A Preview's database is Neon's branch of production's, taken with every row
 * production held, and `@luke/database/models/preview-fork` is the run that
 * cuts it down to the team's workspaces and settles what was in flight. That
 * run deletes every account outside the workspaces it is handed, so this is
 * the one place that decides whether it runs at all, and it runs only when all
 * of these hold:
 *
 * - the build is a Preview's (`VERCEL_ENV`);
 * - the deployment names the workspaces to keep, by slug
 *   (`LUKE_PREVIEW_WORKSPACES`, comma-separated), and production's Neon
 *   endpoint (`LUKE_PRODUCTION_DATABASE_ENDPOINT`, its `ep-…` id or host);
 * - neither connection string the build holds names that endpoint, and the
 *   database the run reaches does not say it is that endpoint
 *   (`neon.endpoint_id`), which catches a connection string that reaches
 *   production under another name.
 *
 * A build that is not a Preview's, or a Preview without both variables, leaves
 * the database as it stands, which is every deployment's behavior before
 * the variables are set. A Preview whose database is production's fails the
 * build, as does one whose database holds no member of a workspace the slugs
 * name: both are a deployment configured wrong, and
 * either run would leave the Preview a copy no one meant it to hold. Neither
 * refusal names a connection string, which carries the database's password.
 */

import {
  PREVIEW_FORK_OUTCOME,
  type PreviewForkCounts,
  preparePreviewFork,
} from "@luke/database/models/preview-fork";
import { storeWriter } from "@luke/database/models/writer";
import { text } from "@luke/wire";
import { Clock, Data, Effect } from "effect";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";

/** The variables the decision is read from; a blank value is absent. */
export const PREVIEW_DATABASE_ENVIRONMENT = {
  /** Vercel's own name for the environment the build deploys to. */
  ENVIRONMENT: "VERCEL_ENV",
  /** The slugs of the workspaces a Preview keeps, comma-separated. */
  WORKSPACES: "LUKE_PREVIEW_WORKSPACES",
  /** Production's Neon endpoint, as its `ep-…` id or a host or connection string naming it. */
  PRODUCTION_ENDPOINT: "LUKE_PRODUCTION_DATABASE_ENDPOINT",
  /** The pooled connection the deployment's functions, and this run, use. */
  DATABASE_URL: "DATABASE_URL",
  /** The direct connection the build's migrations use. */
  DATABASE_URL_UNPOOLED: "DATABASE_URL_UNPOOLED",
} as const;

/** `VERCEL_ENV` on a Preview's build. */
const PREVIEW_ENVIRONMENT = "preview";

/** The suffix Neon's pooled host carries after the endpoint id. */
const POOLER_SUFFIX = "-pooler";

/** Why a build refused to touch its database, in words that name no connection string. */
export class PreviewDatabaseRefused extends Data.TaggedError("PreviewDatabaseRefused")<{
  readonly reason: string;
}> {}

/**
 * Neon's endpoint id in a connection string, a host, or a bare id: the
 * host's first label without the pooler's suffix. Undefined where nothing
 * names one.
 */
function neonEndpointOf(value: string): string | undefined {
  const host = URL.canParse(value) ? new URL(value).hostname : value;
  const [label] = host.split(".");
  const endpoint = label?.endsWith(POOLER_SUFFIX) ? label.slice(0, -POOLER_SUFFIX.length) : label;
  return endpoint === undefined || endpoint === "" ? undefined : endpoint.toLowerCase();
}

/**
 * Whether a connection's endpoint is production's: the endpoint itself, or
 * one of its computes, whose hosts carry the endpoint id and a suffix of
 * their own (`ep-…-sk7`). An endpoint id is Neon's random words, so another
 * branch's never starts with production's.
 */
function reaches(endpoint: string, production: string): boolean {
  return endpoint === production || endpoint.startsWith(`${production}-`);
}

/** The workspace slugs a comma-separated value names, trimmed, each once. */
function slugsOf(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return [...new Set(value.split(",").flatMap((slug) => text(slug) ?? []))];
}

type Step =
  | { readonly kind: "leave"; readonly why: string }
  | { readonly kind: "refuse"; readonly why: string }
  | {
      readonly kind: "prepare";
      readonly keepWorkspaceSlugs: readonly string[];
      readonly productionEndpoint: string;
    };

function stepOf(variables: Record<string, string | undefined>): Step {
  const names = PREVIEW_DATABASE_ENVIRONMENT;
  if (text(variables[names.ENVIRONMENT]) !== PREVIEW_ENVIRONMENT) {
    return { kind: "leave", why: "the build is not a Preview's" };
  }
  const keepWorkspaceSlugs = slugsOf(text(variables[names.WORKSPACES]));
  const configured = text(variables[names.PRODUCTION_ENDPOINT]);
  const production = configured === undefined ? undefined : neonEndpointOf(configured);
  if (keepWorkspaceSlugs.length === 0 || production === undefined) {
    return {
      kind: "leave",
      why: `${names.WORKSPACES} and ${names.PRODUCTION_ENDPOINT} are not both set`,
    };
  }
  const pooled = text(variables[names.DATABASE_URL]);
  if (pooled === undefined) {
    return { kind: "refuse", why: `the build holds no ${names.DATABASE_URL}` };
  }
  const unpooled = text(variables[names.DATABASE_URL_UNPOOLED]);
  for (const [name, value] of [
    [names.DATABASE_URL, pooled],
    [names.DATABASE_URL_UNPOOLED, unpooled],
  ] as const) {
    if (value === undefined) continue;
    const endpoint = neonEndpointOf(value);
    if (endpoint === undefined) {
      return { kind: "refuse", why: `${name} names no database host` };
    }
    if (reaches(endpoint, production)) {
      return {
        kind: "refuse",
        why: `${name} reaches production's database (${names.PRODUCTION_ENDPOINT}), which a Preview's build never cuts down`,
      };
    }
  }
  return { kind: "prepare", keepWorkspaceSlugs, productionEndpoint: production };
}

/** The counts a run wrote into the build's log, one phrase each. */
function countsLine(counts: PreviewForkCounts): string {
  return [
    `kept ${counts.keptWorkspaces} workspaces and ${counts.keptAccounts} accounts`,
    `removed ${counts.removedWorkspaces} workspaces and ${counts.removedAccounts} accounts`,
    `settled ${counts.settledTurns} turns`,
    `archived ${counts.archivedAgents} coding agents`,
  ].join(", ");
}

/**
 * Makes the build's Preview database the Preview's own where the variables
 * say to, once per branch, and leaves it as it stands otherwise; fails with
 * `PreviewDatabaseRefused` where the build is configured wrong. What the run
 * did goes to the build's log as counts.
 */
export const preparePreviewDatabase = /* @__PURE__ */ Effect.fn("web/preparePreviewDatabase")(
  function* (variables: Record<string, string | undefined>) {
    const step = stepOf(variables);
    if (step.kind === "leave") {
      yield* Effect.logInfo(`Preview database left as it stands: ${step.why}`);
      return;
    }
    if (step.kind === "refuse") return yield* new PreviewDatabaseRefused({ reason: step.why });

    const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
    const now = yield* Clock.currentTimeMillis;
    const outcome = yield* preparePreviewFork(
      { writer },
      {
        keepWorkspaceSlugs: step.keepWorkspaceSlugs,
        productionEndpoint: step.productionEndpoint,
        now,
      },
    );
    switch (outcome.kind) {
      case PREVIEW_FORK_OUTCOME.ALREADY_PREPARED:
        yield* Effect.logInfo("Preview database already made this Preview's own");
        return;
      case PREVIEW_FORK_OUTCOME.NO_WORKSPACE:
        return yield* new PreviewDatabaseRefused({
          reason: `no workspace in this database with a slug ${PREVIEW_DATABASE_ENVIRONMENT.WORKSPACES} names has a member`,
        });
      case PREVIEW_FORK_OUTCOME.PRODUCTION:
        return yield* new PreviewDatabaseRefused({
          reason: `the database this build reached says it is production's endpoint (${PREVIEW_DATABASE_ENVIRONMENT.PRODUCTION_ENDPOINT}), which a Preview's build never cuts down`,
        });
      case PREVIEW_FORK_OUTCOME.PREPARED:
        yield* Effect.logInfo(`Preview database made this Preview's own: ${countsLine(outcome)}`);
        return;
    }
  },
);
