/**
 * vercel.ts -- the deployment: the website and the two eve services, their routing, and the minute cron.
 *
 * Vercel evaluates this module at the project's Root Directory, the repository
 * root, so each service's `root` is relative to it. The web service's `/api/`
 * routes are the committed generation `api-rewrites.json` beside this file
 * (`pnpm --filter @luke/web functions:rewrites`), imported rather than pasted:
 * Vercel bundles a config module's relative imports and evaluates it in plain
 * Node, which takes a JSON table and not the generator's dependencies.
 */

import type { VercelConfig } from "@vercel/config/v1";
import apiRewrites from "./api-rewrites.json" with { type: "json" };

/** The three services, by the names the public routes address them by. */
export const SERVICE = { WEB: "web", EVE: "eve", CODER: "coder" } as const;
type ServiceName = (typeof SERVICE)[keyof typeof SERVICE];

/** A route that lands a path on a page or a function of the service it runs in. */
interface PathRoute {
  readonly src: string;
  readonly dest: string;
}

/** A route that rewrites the path a request entered its service with, and names no destination. */
interface TransformRoute {
  readonly src: string;
  readonly transforms: readonly {
    readonly type: string;
    readonly op: string;
    readonly args: string;
  }[];
}

/**
 * One service of a services deployment. `@vercel/config`'s `VercelConfig` has
 * no `services` key yet (only the private `experimentalServices`, without
 * `ignoreCommand` or `routes`), so the shape the deployment already declares
 * is stated here.
 */
interface Service {
  readonly root: string;
  readonly framework: string;
  readonly installCommand: string;
  readonly buildCommand: string;
  readonly ignoreCommand: string;
  readonly routes?: readonly (PathRoute | TransformRoute)[];
}

/**
 * A public route into a service. Vercel's `vercel.ts` schema refuses a
 * service destination on a top-level rewrite (`rewrites[0].destination
 * should be string`), though `vercel.json` takes one, so the public routing
 * is top-level `routes`, each naming its service as eve's `vercel.ts` guide
 * writes them; `@vercel/config` types a route as `any`.
 */
type ServiceRoute = {
  readonly src: string;
  readonly destination: { readonly type: "service"; readonly service: ServiceName };
};

type ServicesConfig = Omit<VercelConfig, "rewrites" | "routes"> & {
  readonly services: Readonly<Record<ServiceName, Service>>;
  readonly routes: readonly ServiceRoute[];
};

/**
 * What a commit must touch for a service to build, as git pathspecs from the
 * repository root: a commit that changes none of it deploys nothing.
 */
const WORKSPACE_TREE =
  ":/apps/web :/packages :/pnpm-lock.yaml :/pnpm-workspace.yaml :/package.json";
const DEPLOYMENT_FILES = ":/vercel.ts :/api-rewrites.json";

/** The website's own pages, served under names of their own after the generated `/api/` routes. */
const PAGE_ROUTES: readonly PathRoute[] = [
  { src: "/about", dest: "/about.html" },
  { src: "/privacy", dest: "/privacy.html" },
  { src: "/changelog", dest: "/changelog.html" },
  { src: "/changelog/page/(\\d+)", dest: "/changelog/page/$1.html" },
  { src: "/changelog/(\\d+\\.\\d+\\.\\d+)", dest: "/changelog/$1.html" },
  { src: "/admin", dest: "/admin.html" },
  { src: "/[^/]+/plan/[^/]+/?", dest: "/open.html" },
];

export const config: ServicesConfig = {
  services: {
    [SERVICE.WEB]: {
      root: "apps/web",
      framework: "vite",
      installCommand: "pnpm install --frozen-lockfile --filter @luke/web...",
      buildCommand: "(pnpm db:migrate && pnpm auth:seed) & db=$!; pnpm build && wait $db",
      ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${WORKSPACE_TREE} :/CHANGELOG.md :/PRIVACY.md ${DEPLOYMENT_FILES}`,
      routes: [...apiRewrites, ...PAGE_ROUTES],
    },
    [SERVICE.EVE]: {
      root: "apps/web/eve",
      framework: "eve",
      installCommand: "pnpm install --frozen-lockfile --filter @luke/web... --filter @luke/eve",
      buildCommand: "pnpm exec eve build",
      ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${WORKSPACE_TREE} ${DEPLOYMENT_FILES}`,
    },
    [SERVICE.CODER]: {
      root: "apps/web/coder",
      framework: "eve",
      installCommand: "pnpm install --frozen-lockfile --filter @luke/web... --filter @luke/coder",
      buildCommand: "export EVE_PUBLIC_ROUTE_PREFIX=/eve/coder && pnpm exec eve build",
      ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${WORKSPACE_TREE} ${DEPLOYMENT_FILES}`,
      routes: [
        {
          src: "^/eve/coder/v1/(.*)$",
          transforms: [{ type: "request.path", op: "set", args: "/eve/v1/$1" }],
        },
      ],
    },
  },
  crons: [{ path: "/api/maintenance/sweep", schedule: "* * * * *" }],
  routes: [
    { src: "^/eve/coder/v1/(.*)$", destination: { type: "service", service: SERVICE.CODER } },
    { src: "^/eve/v1/(.*)$", destination: { type: "service", service: SERVICE.EVE } },
    { src: "^/(.*)$", destination: { type: "service", service: SERVICE.WEB } },
  ],
};
