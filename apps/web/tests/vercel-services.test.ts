import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, matchesGlob, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SANDBOX_ORIGIN } from "@luke/features/page-frame";
import { POSTHOG_PROXY } from "@luke/features/posthog-proxy";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
import { temporaryDirectory } from "@luke/runtime/testing";
import { PAGE_LINK_ROUTE } from "@luke/service/pages/page-links";
import { test } from "vitest";
import { functionPublicPath, webFunctions } from "../server/function-layout";
import {
  generatedRewrites,
  readVercelConfig,
  vercelConfigSource,
} from "../server/function-rewrites";
import { changelogRoutes } from "../src/changelog-releases";
import { parseReleases } from "../src/site-markdown";

const SERVICE = { WEB: "web" } as const;

const VERCEL_JSON = readFileSync(
  fileURLToPath(new URL("../../../vercel.json", import.meta.url)),
  "utf8",
);

const WEB = fileURLToPath(new URL("..", import.meta.url));

const vercel = await readVercelConfig(WEB);

/** Whether a route or a top-level rewrite is held to one host, as the sandbox's are. */
const heldToAHost = (route: object) => "has" in route;

test("the /api/ rewrites are generated into the web service's routes, ahead of its other routes but the sandbox host's", async () => {
  const generated = generatedRewrites(await webFunctions(WEB));
  const { routes } = vercel.services[SERVICE.WEB];
  const locked = routes.filter(heldToAHost);
  const rest = routes.slice(locked.length);
  assert.ok(locked.length > 0);
  assert.deepEqual(routes.slice(0, locked.length), locked);
  assert.deepEqual(rest.slice(0, generated.length), generated);
  assert.deepEqual(
    rest.slice(generated.length).filter((route) => route.src.startsWith("/api/")),
    [],
  );
});

/** Whether Vercel deploys a push to the branch, by the `git.deploymentEnabled` globs, where a branch no glob names deploys. */
function deploys(branch: string): boolean {
  const refused = Object.entries(vercel.git.deploymentEnabled).some(
    ([glob, enabled]) => !enabled && matchesGlob(branch, glob),
  );
  return !refused;
}

test("a GitHub merge-queue branch, an agent's branch, a PR media branch, or an evidence branch is not deployed, and every other branch is", () => {
  for (const branch of [
    "gh-readonly-queue/main/pr-3551-d1c107a6f00dbb4b1e5bd2d1b8f3a5c7e9d01234",
    "gh-readonly-queue/release/1.2/pr-7-0123456789abcdef0123456789abcdef01234567",
    "agent/fix-relay",
    "pr-assets",
    "pr-assets-card-redesign",
    "evidence/app-267",
  ]) {
    assert.equal(deploys(branch), false, branch);
  }
  for (const branch of [
    "main",
    "ci/vercel-no-merge-queue-deploys",
    "feature/some-workspace",
    "fix/pr-assets-upload",
    "gh-readonly-queue",
  ]) {
    assert.equal(deploys(branch), true, branch);
  }
});

test("regenerating vercel.json gives back the committed file byte for byte", async () => {
  assert.equal(await vercelConfigSource(WEB), VERCEL_JSON);
});

test("a vercel.json key the generator does not know refuses the generation rather than being dropped", async (t) => {
  const root = await temporaryDirectory(t, "vercel-config-");
  const web = join(root, "apps", "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(root, "vercel.json"), JSON.stringify({ ...vercel, images: { sizes: [256] } }));
  await assert.rejects(vercelConfigSource(web), /images/u);
});

/** The first step of a path, where it is spelled as itself rather than matched. */
const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
  // A route held to the sandbox's host is never the app's own address.
  const routed = [
    ...vercel.services[SERVICE.WEB].routes
      .filter((route) => !heldToAHost(route))
      .map((route) => route.src),
    ...vercel.rewrites.filter((rewrite) => !heldToAHost(rewrite)).map((rewrite) => rewrite.source),
  ];
  const pages = readdirSync(WEB)
    .filter((name) => name.endsWith(".html"))
    .map((name) => `/${name.slice(0, -".html".length)}`);
  const published = readdirSync(`${WEB}/public`, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);
  const steps = new Set(
    [...routed, ...pages, ...published].flatMap((path) => FIRST_STEP.exec(path)?.[1] ?? []),
  );
  steps.delete("index");

  assert.deepEqual(
    [...steps].filter((step) => !RESERVED_WORKSPACE_SLUGS.has(step)),
    [],
  );
});

/** A condition a route or a rewrite holds a request to: the host it was made to, as a pattern of its spellings. */
interface HostCondition {
  readonly type: "host";
  readonly value: { readonly re: string };
}

/**
 * A route of the web service as the platform reads it: a rewrite to a file
 * of the build and the headers sent beside it, held to one host where it
 * names one, with the status it is answered with where it names one, or the
 * request headers it takes off; a redirect's status and `Location`; or
 * headers alone that routing carries on past (`continue`).
 */
interface WebRoute {
  readonly src: string;
  readonly has?: readonly HostCondition[];
  readonly dest?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly transforms?: readonly {
    readonly type: string;
    readonly op: string;
    readonly target: { readonly key: string };
  }[];
  readonly continue?: true;
}

/** The app's own host: any host but the sandbox's answers alike. */
const APP_HOST = "tryluke.dev";

/** The sandbox's own host, which the routing holds to the page route, by each spelling a browser may send: with a trailing dot too. */
const SANDBOX_HOST = new URL(PAGE_SANDBOX_ORIGIN).host;

const SANDBOX_HOSTS = [SANDBOX_HOST, `${SANDBOX_HOST}.`] as const;

/** Whether a request made to the host meets every condition a route or a rewrite holds it to. */
function heldTo(entry: { readonly has?: readonly HostCondition[] }, host: string): boolean {
  return (entry.has ?? []).every((condition) => new RegExp(condition.value.re, "u").test(host));
}

/**
 * The service a request enters, read as Vercel reads the top-level
 * rewrites: in order, the first whose pattern matches the whole path and
 * whose conditions the request meets.
 */
function serviceFor(path: string, host: string): string | undefined {
  return vercel.rewrites.find(
    (rewrite) => heldTo(rewrite, host) && new RegExp(`^${rewrite.source}$`, "iu").test(path),
  )?.destination.service;
}

/**
 * An answer's headers by their lower-cased names, a later route's standing in
 * for an earlier one's of the same name, and every value the routes it passed
 * named for each.
 */
interface AnswerHeaders {
  readonly headers: ReadonlyMap<string, string>;
  readonly named: ReadonlyMap<string, readonly string[]>;
}

/**
 * What the web service answers a path with: the file of the build a route
 * rewrote it to, with the status the route forces where it names one, or the
 * path left to the build's own files (`file` undefined), with the headers its
 * routes laid on it; or a redirect.
 */
type Served =
  | ({ readonly file: string | undefined; readonly forced?: number } & AnswerHeaders)
  | { readonly status: number; readonly location: string };

const WEB_ROUTES: readonly WebRoute[] = vercel.services[SERVICE.WEB].routes;

/**
 * What the web service answers a path made to a host with, the app's unless
 * named, read as Vercel reads its routes, in order: each whose pattern
 * matches the whole path, whatever its case, and whose conditions the request
 * meets lays its headers on the answer, a later route's header standing in
 * for an earlier one of the same name; one that continues lets routing go on,
 * and the first that does not rewrites the path to its destination, the
 * pattern's groups written in, or redirects it. Where none does, the path is
 * left to the build's own files.
 */
function servedBy(path: string, host = APP_HOST): Served {
  const headers = new Map<string, string>();
  const named = new Map<string, string[]>();
  for (const route of WEB_ROUTES) {
    const pattern = new RegExp(`^${route.src}$`, "iu");
    if (!heldTo(route, host) || !pattern.test(path)) continue;
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      const key = name.toLowerCase();
      headers.set(key, value);
      named.set(key, [...(named.get(key) ?? []), value]);
    }
    if (route.continue) continue;
    if (route.dest !== undefined) {
      const file = path.replace(pattern, route.dest);
      return route.status === undefined
        ? { file, headers, named }
        : { file, forced: route.status, headers, named };
    }
    return { status: route.status ?? 0, location: route.headers?.Location ?? "" };
  }
  return { file: undefined, headers, named };
}

const servedFile = (path: string, host = APP_HOST) => {
  const served = servedBy(path, host);
  return "file" in served ? served.file : undefined;
};

/** The headers a path is answered with, where it is answered rather than redirected. */
function answeredHeaders(path: string): AnswerHeaders {
  const served = servedBy(path);
  assert.ok("headers" in served, `${path} is answered, not redirected`);
  return served;
}

/**
 * The policies a browser may be sent with an answer: every distinct value its
 * routes named for its Content Security Policy. Vercel documents no
 * precedence between two routes naming one header, so where they name one
 * policy the browser enforces exactly it, whether the later stands in for the
 * earlier or both are sent; where they name two, it may enforce both at once.
 */
function policiesSent(answer: AnswerHeaders): ReadonlySet<string> {
  return new Set(answer.named.get("content-security-policy"));
}

/** A policy's directives by name, each with its sources. */
function directivesOf(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    }),
  );
}

test("a link to any place in Vespin, a plan's, a section's, a picture's, and a box's pairing among them, and the app's own path are served the web app, and no page of Vespin's own is", () => {
  for (const path of [
    "/app",
    "/app/",
    "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
    "/personal-u_1/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/",
    "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/files/0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01",
    "/acme/plan/p1/agent/a1/worker/toolu_1",
    "/acme/task/p1/version/3",
    "/acme/agent/a1",
    "/acme/inbox",
    "/acme/plan/p1/inbox/i1/",
    "/acme/automations",
    "/acme/automation/x1/run/r1",
    "/acme/settings/agents",
    "/acme/person/user_9Fq2-x",
    "/acme/admin",
    "/acme/admin/cost",
    "/acme/admin/user/user_9Fq2-x",
    "/acme/admin/day/2026-10-12",
    "/connect/BCDF-GHJK",
  ]) {
    assert.equal(servedFile(path), "/app.html", path);
  }
  // The build's file name is never an address: it sends the browser to the app's own, for good, and the browser keeps the fragment.
  assert.deepEqual(servedBy("/app.html"), { status: 308, location: "/app" });
  assert.equal(servedFile("/about"), "/about.html");
  assert.equal(servedFile("/privacy"), "/privacy.html");
  assert.equal(servedFile("/changelog"), "/changelog.html");
  assert.equal(servedFile("/changelog/page/2"), "/changelog/page/2.html");
  assert.equal(servedFile("/admin"), "/admin.html");
  // An API path still reaches the oRPC route with the whole path it names, and an exception its own route with the id.
  for (const path of [
    "/api/plans/x/revisions",
    "/api/inbox/i1",
    "/api/automations/x1/runs",
    "/api/agents/a1",
  ]) {
    const served = new URL(servedFile(path) ?? "/", "https://vespin.dev");
    assert.equal(served.pathname, "/api/default.js", path);
    assert.equal(served.searchParams.get("route"), "orpc", path);
    assert.equal(served.searchParams.get("route-path"), path.slice("/api/".length), path);
  }
  for (const [path, route] of [
    ["/api/workspaces/w1/photo", "workspaces/photo"],
    ["/api/automations/x1/webhook", "automations/webhook"],
  ] as const) {
    const served = new URL(servedFile(path) ?? "/", "https://vespin.dev");
    assert.equal(served.pathname, "/api/default.js", path);
    assert.equal(served.searchParams.get("route"), route, path);
    assert.equal(served.searchParams.get("id"), path.split("/")[3], path);
  }
  // The landing page, the sign-in, a static file, and a path naming no place, an old issue's among them, are the build's own files.
  for (const path of [
    "/",
    "/sign-in.html",
    "/favicon.svg",
    "/app/marks/codex-16.png",
    "/acme/plans/x",
    "/acme/issue/i1",
    "/acme",
    "/application",
  ]) {
    assert.equal(servedFile(path), undefined, path);
  }
});

/** A link's token as the routing sees it: its claims and its signature, base64url, joined by a dot. */
const LINK_TOKEN = "eyJzaXRlIjoiaHR0cHM6Ly9mdWxsc3Bpbi5wYWdlIn0.c2lnbmVkLWJ5LXRoZS1zZXJ2aWNl";

/** The paths of the app, its API, auth, and its files, none of which the sandbox's host may serve. */
const APP_PATHS = [
  "/",
  "/app",
  "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  "/connect/BCDF-GHJK",
  "/api/auth/get-session",
  "/api/plans/x/revisions",
  "/api/pages/sandbox",
  "/api/default.js",
  "/sign-in.html",
  "/page-in-mac-app.html",
  "/favicon.svg",
  "/assets/app-DyIpMmfT.js",
  "/install.sh",
] as const;

/** The file the sandbox's host answers every path but a link's with, under a forced 404. */
const SANDBOX_NOT_FOUND = "/sandbox-not-found.txt";

test("the sandbox's host, spelled with a trailing dot or without, reaches the page route alone, by a link's address, and answers every other path, the app's, the API's, and auth's among them, not found from a static file", async () => {
  const pageRoute = PAGE_LINK_ROUTE.PATH.slice("/api/".length);
  const pages = (await webFunctions(WEB)).find((definition) =>
    definition.routes.includes(pageRoute),
  );
  assert.ok(pages !== undefined);
  // The function a link lands in holds no other route, so no `route` a caller's query names reaches the API.
  assert.deepEqual(pages.routes, [pageRoute]);
  const pagesPath = `/${functionPublicPath(pages)}`;
  const linkPath = `/${PAGE_LINK_ROUTE.STEP}/${LINK_TOKEN}`;
  assert.ok(readdirSync(join(WEB, "public")).includes(SANDBOX_NOT_FOUND.slice(1)));
  for (const host of SANDBOX_HOSTS) {
    // Every path of the host enters the web service, whose routes hold it.
    for (const path of [linkPath, ...APP_PATHS]) {
      assert.equal(serviceFor(path, host), SERVICE.WEB, `${host}${path}`);
    }
    const link = servedBy(linkPath, host);
    assert.ok("file" in link && link.file !== undefined && link.forced === undefined, host);
    const landed = new URL(link.file, PAGE_SANDBOX_ORIGIN);
    assert.equal(landed.pathname, pagesPath, host);
    assert.equal(landed.searchParams.get("route"), pageRoute, host);
    assert.equal(landed.searchParams.get(PAGE_LINK_ROUTE.TOKEN_QUERY), LINK_TOKEN, host);
    // Every other path is a file of the build's own, answered not found, so no function is woken by it.
    for (const path of APP_PATHS) {
      const refused = servedBy(path, host);
      assert.ok("file" in refused, `${host}${path}`);
      assert.deepEqual(
        { file: refused.file, forced: refused.forced },
        { file: SANDBOX_NOT_FOUND, forced: 404 },
        `${host}${path}`,
      );
      assert.equal(refused.headers.get("x-content-type-options"), "nosniff", `${host}${path}`);
      assert.deepEqual(
        directivesOf(refused.headers.get("content-security-policy") ?? "").get("default-src"),
        ["'none'"],
        `${host}${path}`,
      );
    }
  }
});

test("on any host but the sandbox's, a link's address reaches no route, and the app is routed as before", () => {
  const linkPath = `/${PAGE_LINK_ROUTE.STEP}/${LINK_TOKEN}`;
  // A host that holds the sandbox's name within it is no spelling of the sandbox's.
  for (const host of [
    APP_HOST,
    "vespin-web-git-main-stage-review.vercel.app",
    `www.${SANDBOX_HOST}`,
    `${SANDBOX_HOST}.example`,
    `${SANDBOX_HOST}s`,
  ]) {
    assert.equal(serviceFor(linkPath, host), SERVICE.WEB, host);
    // Left to the build's own files, which hold none at that path.
    assert.equal(servedFile(linkPath, host), undefined, host);
    assert.equal(servedFile("/app", host), "/app.html", host);
  }
});

test("every path the web app is served at sends its own Content Security Policy and no other, refuses to be framed, keeps the connect tabs it opens, and is never sniffed", () => {
  const app = WEB_ROUTES.filter((route) => route.dest === "/app.html");
  assert.ok(app.length > 0);
  for (const path of [
    "/app",
    "/app/",
    // Vercel matches a route's pattern whatever the address's case.
    "/App",
    "/acme/plan/p1",
    "/acme/inbox",
    "/acme/settings/agents",
  ]) {
    const answer = answeredHeaders(path);
    const { headers } = answer;
    // The app is sent its own policy alone, never the site's beside it to be enforced too.
    assert.deepEqual([...policiesSent(answer)], [headers.get("content-security-policy")], path);
    const directives = directivesOf(headers.get("content-security-policy") ?? "");
    assert.deepEqual(directives.get("default-src"), ["'self'"], path);
    // Files changed colours its diffs with Pierre's Highlights, one WebAssembly module, which this alone lets the app compile.
    assert.deepEqual(directives.get("script-src"), ["'self'", "'wasm-unsafe-eval'"], path);
    assert.deepEqual(directives.get("object-src"), ["'none'"], path);
    assert.deepEqual(directives.get("base-uri"), ["'self'"], path);
    assert.deepEqual(directives.get("form-action"), ["'self'"], path);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], path);
    // An agent's page is framed from the sandbox's own site (`@luke/features/page-frame`), and no other.
    assert.deepEqual(directives.get("frame-src"), ["'self'", PAGE_SANDBOX_ORIGIN], path);
    // The installed app's manifest and its icons are the site's own files.
    assert.deepEqual(directives.get("manifest-src"), ["'self'"], path);
    assert.ok(directives.get("img-src")?.includes("'self'"), path);
    // The tab reaches the processor for session replay through its own origin
    // (`@luke/features/posthog-proxy`), and Sentry's ingest in the organization's region,
    // and no other address.
    assert.deepEqual(
      directives.get("connect-src"),
      ["'self'", "https://*.ingest.us.sentry.io"],
      path,
    );
    assert.equal(headers.get("x-frame-options"), "DENY", path);
    assert.equal(headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin", path);
    // A cross-origin opener loses its hold on the tab, while a connect tab the app opens
    // keeps the app's hold until it leaves for its provider (`src/app/connect-tab.ts`).
    assert.equal(headers.get("cross-origin-opener-policy"), "same-origin-allow-popups", path);
    // Calls and dictation ask for the microphone.
    assert.ok(
      headers.get("permissions-policy")?.split(/,\s*/u).includes("microphone=(self)"),
      path,
    );
  }
  // An API answer's headers are its handler's own; no page's route reaches it.
  for (const path of [
    "/api/plans/x/revisions",
    "/api/workspaces/w1/photo",
    "/api/auth/get-session",
  ]) {
    assert.equal(answeredHeaders(path).headers.size, 0, path);
  }
});

test("PostHog's path passes what the browser sends on to PostHog, without this origin's cookies or a page's headers", () => {
  for (const [path, upstream] of [
    [`${POSTHOG_PROXY.PATH}/i/v0/e/`, "https://us.i.posthog.com/i/v0/e/"],
    [`${POSTHOG_PROXY.PATH}/s/`, "https://us.i.posthog.com/s/"],
    [
      `${POSTHOG_PROXY.PATH}/static/recorder.js`,
      "https://us-assets.i.posthog.com/static/recorder.js",
    ],
    [
      `${POSTHOG_PROXY.PATH}/array/phc_test/config.js`,
      "https://us-assets.i.posthog.com/array/phc_test/config.js",
    ],
  ] as const) {
    assert.equal(servedFile(path), upstream, path);
    assert.equal(answeredHeaders(path).headers.size, 0, path);
    const route = WEB_ROUTES.find(
      (each) =>
        !each.continue && heldTo(each, APP_HOST) && new RegExp(`^${each.src}$`, "iu").test(path),
    );
    // The session cookie is this origin's, and Vercel passes on every header a rewrite does not take off.
    assert.ok(
      route?.transforms?.some(
        (transform) =>
          transform.type === "request.headers" &&
          transform.op === "delete" &&
          transform.target.key === "cookie",
      ),
      path,
    );
  }
});

test("a content-hashed build asset is cached for a year, and nothing unhashed under /assets is", () => {
  // Vite's default `build.assetsDir` is `assets`, which `public/assets` shares with unhashed files.
  for (const path of [
    "/assets/app-DyIpMmfT.js",
    "/assets/app-a1_B-2cD.css",
    "/assets/chunk-Zx9_QwEr.js",
  ]) {
    assert.equal(
      answeredHeaders(path).headers.get("cache-control"),
      "public, max-age=31536000, immutable",
      path,
    );
  }
  for (const path of [
    "/assets/charles-pan.jpeg",
    "/assets/dean-stratakos.jpeg",
    "/app",
    "/about",
  ]) {
    assert.equal(answeredHeaders(path).headers.get("cache-control"), undefined, path);
  }
});

/** The pages the web app frames itself, which this site alone may frame: the one a page's frame is sent to where the deployment has no sandbox (`packages/service/src/pages/page-frame.ts`). */
const FRAMED_BY_THE_APP: ReadonlySet<string> = new Set(["page-in-mac-app.html"]);

/** The maintainers' dashboard, which runs no analytics and draws charts and accounts' pictures. */
const ADMIN_PAGE = "admin.html";

/** The HTML files the web app's entry pages are built from, at the web app's root. */
const ENTRY_PAGES = readdirSync(WEB).filter((name) => name.endsWith(".html"));

/**
 * Every HTML file the build emits, relative to its root, with the addresses
 * that may serve it: Vite's entry pages, at their own path and without their
 * extension; the files `public/` carries as they are; and every changelog
 * page and release `scripts/prerender.ts` writes, at its own path and its
 * route's.
 */
function emittedPages(): ReadonlyMap<string, readonly string[]> {
  const pages = new Map<string, readonly string[]>();
  const add = (file: string, ...addresses: readonly string[]) =>
    pages.set(file, [...(pages.get(file) ?? []), `/${file}`, ...addresses]);
  for (const file of ENTRY_PAGES) {
    add(file, `/${file.slice(0, -".html".length)}`, ...(file === "index.html" ? ["/"] : []));
  }
  for (const file of readdirSync(join(WEB, "public"), { recursive: true, encoding: "utf8" })) {
    if (file.endsWith(".html")) add(file.split(sep).join("/"));
  }
  const changelog = readFileSync(
    fileURLToPath(new URL("../../../CHANGELOG.md", import.meta.url)),
    "utf8",
  );
  for (const route of changelogRoutes(parseReleases(changelog))) add(route.file, route.path);
  return pages;
}

/** The addresses among a page's candidates the web service answers with it: a route's rewrite to it, or its own path left to the build's files. */
function addressesServing(file: string, candidates: readonly string[]): readonly string[] {
  return [...new Set(candidates)].filter((address) => {
    const served = servedBy(address);
    if (!("file" in served)) return false;
    if (served.file !== undefined) return served.file === `/${file}`;
    return address === `/${file}` || (file === "index.html" && address === "/");
  });
}

/** Every page the build emits, at every address it is served at, with the headers it is answered with. */
function pageAnswers(): readonly { file: string; address: string; answer: AnswerHeaders }[] {
  return [...emittedPages()].flatMap(([file, candidates]) => {
    const addresses = addressesServing(file, candidates);
    assert.ok(addresses.length > 0, `${file} is served at an address`);
    return addresses.map((address) => ({ file, address, answer: answeredHeaders(address) }));
  });
}

/** The sources a policy's directive names, or its `default-src` where it names none. */
function sourcesOf(directives: ReadonlyMap<string, readonly string[]>, name: string) {
  return directives.get(name) ?? directives.get("default-src") ?? [];
}

test("every HTML page the build emits is served at every address under one Content Security Policy that runs no inline script, framed by no other site, and never sniffed", () => {
  const answers = pageAnswers();
  assert.ok(answers.some(({ file }) => file.startsWith("changelog/page/")));
  for (const { file, address, answer } of answers) {
    const { headers } = answer;
    // No page is sent two policies to be enforced together.
    assert.equal(policiesSent(answer).size, 1, address);
    const directives = directivesOf(headers.get("content-security-policy") ?? "");
    const scripts = sourcesOf(directives, "script-src");
    assert.ok(scripts.length > 0, `${address} names where its scripts may come from`);
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:", "https:"]) {
      assert.ok(!scripts.includes(unsafe), `${address} runs no script from ${unsafe}`);
    }
    assert.deepEqual(sourcesOf(directives, "object-src"), ["'none'"], address);
    assert.equal(directives.get("base-uri")?.length, 1, address);
    assert.ok(["'self'", "'none'"].includes(directives.get("base-uri")?.[0] ?? ""), address);
    assert.ok(directives.has("form-action"), address);
    const framed = FRAMED_BY_THE_APP.has(file);
    assert.deepEqual(directives.get("frame-ancestors"), [framed ? "'self'" : "'none'"], address);
    assert.equal(headers.get("x-frame-options"), framed ? "SAMEORIGIN" : "DENY", address);
    assert.equal(headers.get("x-content-type-options"), "nosniff", address);
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin", address);
    const permissions = headers.get("permissions-policy")?.split(/,\s*/u) ?? [];
    for (const denied of ["camera=()", "geolocation=()", "payment=()", "usb=()"]) {
      assert.ok(permissions.includes(denied), `${address} denies ${denied}`);
    }
  }
});

test("the site's pages run scripts from this origin alone, connect to it alone, and draw no inline style", () => {
  const site = pageAnswers().filter(
    ({ file }) => file !== "app.html" && file !== ADMIN_PAGE && !FRAMED_BY_THE_APP.has(file),
  );
  assert.ok(site.length > 0);
  for (const { address, answer } of site) {
    const directives = directivesOf(answer.headers.get("content-security-policy") ?? "");
    assert.deepEqual(directives.get("default-src"), ["'self'"], address);
    // The analytics client (`src/analytics.ts`) loads its configuration and its recorder,
    // and posts what it counts, through this origin (`@luke/features/posthog-proxy`).
    assert.deepEqual(directives.get("script-src"), ["'self'"], address);
    assert.deepEqual(directives.get("style-src"), ["'self'"], address);
    assert.deepEqual(directives.get("connect-src"), ["'self'"], address);
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:"], address);
    // Only the app frames the sandbox's site.
    assert.equal(directives.get("frame-src"), undefined, address);
  }
});

test("the maintainers' dashboard runs scripts from this origin alone and connects to it alone, its charts' inline styles and accounts' pictures its only exceptions", () => {
  for (const address of ["/admin", "/admin.html"]) {
    const directives = directivesOf(
      answeredHeaders(address).headers.get("content-security-policy") ?? "",
    );
    assert.deepEqual(directives.get("script-src"), ["'self'"], address);
    assert.deepEqual(directives.get("connect-src"), ["'self'"], address);
    // A chart's colours are an inline sheet `@luke/ui`'s chart writes (`ChartStyle`).
    assert.deepEqual(directives.get("style-src"), ["'self'", "'unsafe-inline'"], address);
    // An account's picture is its provider's (`@luke/features/account-picture`).
    assert.deepEqual(
      directives.get("img-src"),
      [
        "'self'",
        "data:",
        "https://*.googleusercontent.com",
        "https://avatars.githubusercontent.com",
      ],
      address,
    );
  }
});

/** The entry pages a connect lands on, which close their tab once the app's tab answers (`src/connect-return.ts`). */
const CONNECT_LANDINGS = ENTRY_PAGES.filter((file) => {
  const entry = /<script type="module" src="\/(src\/[^"]+)"/u.exec(
    readFileSync(join(WEB, file), "utf8"),
  )?.[1];
  return (
    entry !== undefined && readFileSync(join(WEB, entry), "utf8").includes('"./connect-return"')
  );
});

test("a page a connect lands on keeps the opener policy its tab came with, so it can close it; every other page of the site cuts a cross-origin opener", () => {
  assert.ok(CONNECT_LANDINGS.length > 0);
  for (const { file, address, answer } of pageAnswers()) {
    if (file === "app.html" || FRAMED_BY_THE_APP.has(file)) continue;
    const policy = answer.headers.get("cross-origin-opener-policy");
    assert.equal(policy, CONNECT_LANDINGS.includes(file) ? undefined : "same-origin", address);
  }
});
