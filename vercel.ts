/**
 * vercel.ts -- the deployment: the website, the agents' eve services, their routing, and the minute cron.
 *
 * Vercel evaluates this module at the project's Root Directory, the repository
 * root, so each service's `root` is relative to it. `withEve` adds one built
 * service per member of the agents' eve workspace (`apps/eve`), mounted at
 * `/eve/<member>/v1/*`, with the routes that reach it. The web service's `/api/`
 * routes are the committed generation `api-rewrites.json` beside this file
 * (`pnpm --filter @luke/web functions:rewrites`), imported rather than pasted:
 * Vercel bundles a config module's relative imports and evaluates it in plain
 * Node, which takes a JSON table and not the generator's dependencies.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VercelConfig } from "@vercel/config/v1";
import { withEve } from "eve/vercel";
import apiRewrites from "./api-rewrites.json" with { type: "json" };

/**
 * The services, by the names the public routes address them by: the two this
 * file declares, and the one `withEve` generates for the workspace's `luke`
 * member (eve names a member's service `eve-<member>`).
 */
export const SERVICE = { WEB: "web", CODER: "coder", LUKE: "eve-luke" } as const;
type ServiceName = (typeof SERVICE)[keyof typeof SERVICE];
type AuthoredServiceName = typeof SERVICE.WEB | typeof SERVICE.CODER;

/** The agents' eve workspace, from the repository root. */
export const EVE_WORKSPACE = "apps/eve";

/** A route that lands a path on a page or a function of the service it runs in. */
type PathRoute = {
  readonly src: string;
  readonly dest: string;
};

/** A route that rewrites the path a request entered its service with, and names no destination. */
type TransformRoute = {
  readonly src: string;
  readonly transforms: readonly {
    readonly type: string;
    readonly op: string;
    readonly args: string;
  }[];
};

/**
 * One service of a services deployment. `@vercel/config`'s `VercelConfig` has
 * no `services` key yet (only the private `experimentalServices`, without
 * `ignoreCommand` or `routes`), so the shape the deployment already declares
 * is stated here.
 */
type Service = {
  readonly root: string;
  readonly framework: string;
  readonly installCommand: string;
  readonly buildCommand: string;
  readonly ignoreCommand: string;
  readonly routes?: readonly (PathRoute | TransformRoute)[];
};

/**
 * A public route into a service, the shape `withEve` writes its own in, which
 * `@vercel/config` types as `any`. A deployment with top-level `routes` takes
 * no `rewrites` beside them, so every public route is one of these.
 */
type ServiceRoute = {
  readonly src: string;
  readonly destination: { readonly type: "service"; readonly service: ServiceName };
};

type ServicesConfig = Omit<VercelConfig, "rewrites" | "routes"> & {
  readonly services: Readonly<Record<AuthoredServiceName, Service>>;
  readonly routes: readonly ServiceRoute[];
};

/**
 * What a commit must touch for a service to build, as git pathspecs from the
 * repository root: a commit that changes none of it deploys nothing.
 */
const SHARED_TREE = ":/packages :/pnpm-lock.yaml :/pnpm-workspace.yaml :/package.json";
const WEB_TREE = `:/apps/web ${SHARED_TREE}`;
const AGENTS_TREE = `:/${EVE_WORKSPACE} ${SHARED_TREE}`;
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

/** The repository root, found from where Vercel or a test evaluates this module. */
function repositoryRoot(from: string): string {
  if (existsSync(join(from, "vercel.ts"))) return from;
  const parent = dirname(from);
  if (parent === from) throw new Error("vercel.ts: no repository root above the working directory");
  return repositoryRoot(parent);
}

const authored: ServicesConfig = {
  services: {
    [SERVICE.WEB]: {
      root: "apps/web",
      framework: "vite",
      installCommand: "pnpm install --frozen-lockfile --filter @luke/web...",
      buildCommand: "(pnpm db:migrate && pnpm auth:seed) & db=$!; pnpm build && wait $db",
      ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${WEB_TREE} :/CHANGELOG.md :/PRIVACY.md ${DEPLOYMENT_FILES}`,
      routes: [...apiRewrites, ...PAGE_ROUTES],
    },
    [SERVICE.CODER]: {
      root: "apps/web/coder",
      framework: "eve",
      installCommand: "pnpm install --frozen-lockfile --filter @luke/web... --filter @luke/coder",
      buildCommand: "export EVE_PUBLIC_ROUTE_PREFIX=/eve/coder && pnpm exec eve build",
      ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${WEB_TREE} ${DEPLOYMENT_FILES}`,
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
    // Luke's mount before the workspace, kept for the sessions already running and their callbacks; the member reads /eve/v1/* either way.
    { src: "^/eve/v1/(.*)$", destination: { type: "service", service: SERVICE.LUKE } },
    { src: "^/(.*)$", destination: { type: "service", service: SERVICE.WEB } },
  ],
};

const composed = await withEve(authored, {
  root: join(repositoryRoot(process.cwd()), EVE_WORKSPACE),
});

/**
 * Each generated member service, rooted from this file and installed and
 * skipped like the services above. Note that eve 0.74 computes a generated
 * service's `root` from the eve workspace root (`.eve/vercel-services/<name>`)
 * rather than from the configuration file, which only coincides when
 * `vercel.ts` stands at the workspace root, so the workspace's path is put in
 * front of it here; `tests/vercel-services.test.ts` holds the result to a
 * directory that exists, so an eve that fixes this shows up as a failure.
 */
const generatedServices = Object.fromEntries(
  Object.entries(composed.services).map(([name, service]) =>
    Object.hasOwn(authored.services, name)
      ? [name, service]
      : [
          name,
          {
            ...service,
            root: join(EVE_WORKSPACE, service.root ?? "."),
            installCommand: "pnpm install --frozen-lockfile --filter @luke/eve...",
            ignoreCommand: `git diff --quiet HEAD^ HEAD -- ${AGENTS_TREE} ${DEPLOYMENT_FILES}`,
          },
        ],
  ),
);

export const config = { ...composed, services: generatedServices };
