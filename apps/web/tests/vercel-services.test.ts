import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, matchesGlob, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { RESERVED_WORKSPACE_SLUGS } from "@luke/features/workspace-wire";
import { temporaryDirectory } from "@luke/runtime/testing";
import { test } from "vitest";
import { webFunctions } from "../server/function-layout";
import { apiRewrites, rewritesDrifted, vercelConfigSource } from "../server/function-rewrites";
import { changelogRoutes, parseReleases } from "../src/changelog-releases";

interface Route {
  readonly src: string;
  readonly dest: string;
}

interface Transform {
  readonly type: string;
  readonly op: string;
  readonly args: string;
}

interface ServiceRoute {
  readonly src: string;
  readonly transforms?: readonly Transform[];
}

interface Service {
  readonly root: string;
  readonly buildCommand?: string;
  readonly routes?: readonly (Route | ServiceRoute)[];
}

interface Rewrite {
  readonly source: string;
  readonly destination: { readonly service: string };
}

const SERVICE = { WEB: "web", LUKE: "luke", DEV: "dev" } as const;

interface Services {
  readonly [SERVICE.WEB]: Service;
  readonly [SERVICE.LUKE]: Service;
  readonly [SERVICE.DEV]: Service;
}

interface Git {
  readonly deploymentEnabled: Readonly<Record<string, boolean>>;
}

const VERCEL_JSON = readFileSync(
  fileURLToPath(new URL("../../../vercel.json", import.meta.url)),
  "utf8",
);

// SAFETY: the file is this repository's own vercel.json, read for its deployment shape.
const vercel = JSON.parse(VERCEL_JSON) as {
  git: Git;
  services: Services;
  rewrites: readonly Rewrite[];
};

const WEB = fileURLToPath(new URL("..", import.meta.url));

test("the /api/ rewrites are generated into the web service's routes, ahead of its other routes, and the committed file carries exactly that generation", async () => {
  const generated = apiRewrites(await webFunctions(WEB));
  const web = vercel.services[SERVICE.WEB];
  assert.ok(web.routes);
  assert.deepEqual(web.routes.slice(0, generated.length), generated);
  assert.deepEqual(
    web.routes.slice(generated.length).filter((route) => route.src.startsWith("/api/")),
    [],
  );
  assert.equal(await rewritesDrifted(WEB), false);
  // SAFETY: the generator's own output, read back as the JSON it wrote.
  const regenerated = JSON.parse(await vercelConfigSource(WEB)) as typeof vercel;
  assert.equal("routes" in regenerated, false);
  assert.deepEqual(regenerated.services[SERVICE.WEB].routes, web.routes);
  // The generator carries every service whole, the coder's mount route included.
  assert.deepEqual(regenerated.services, vercel.services);
});

/** Whether Vercel deploys a push to the branch, by the `git.deploymentEnabled` globs, where a branch no glob names deploys. */
function deploys(branch: string): boolean {
  const refused = Object.entries(vercel.git.deploymentEnabled).some(
    ([glob, enabled]) => !enabled && matchesGlob(branch, glob),
  );
  return !refused;
}

test("a GitHub merge-queue branch is not deployed, and every other branch is", () => {
  for (const branch of [
    "gh-readonly-queue/main/pr-3551-d1c107a6f00dbb4b1e5bd2d1b8f3a5c7e9d01234",
    "gh-readonly-queue/release/1.2/pr-7-0123456789abcdef0123456789abcdef01234567",
  ]) {
    assert.equal(deploys(branch), false, branch);
  }
  for (const branch of [
    "main",
    "ci/vercel-no-merge-queue-deploys",
    "conductor/some-workspace",
    "pr-assets",
    "gh-readonly-queue",
  ]) {
    assert.equal(deploys(branch), true, branch);
  }
});

test("regenerating vercel.json gives back the committed file byte for byte", async () => {
  assert.equal(await vercelConfigSource(WEB), VERCEL_JSON);
});

test("a vercel.json key the generator does not know refuses the generation rather than being dropped", async (t) => {
  const root = await temporaryDirectory(t, "luke-vercel-config-");
  const web = join(root, "apps", "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(root, "vercel.json"), JSON.stringify({ ...vercel, images: { sizes: [256] } }));
  await assert.rejects(vercelConfigSource(web), /images/u);
});

/**
 * The name eve knows each agent service by, which it derives from the
 * service's package name without its scope and names the service's Workflow
 * queue after. A standing session wakes only on its owning deployment's
 * queue, so these never change once a session has started under them.
 */
const EVE_AGENT_NAME = { [SERVICE.LUKE]: "luke", [SERVICE.DEV]: "coder" } as const;

test("each eve service keeps the agent name its standing sessions' queue is named after, whatever its directory or service key", () => {
  for (const service of [SERVICE.LUKE, SERVICE.DEV] as const) {
    const manifest = new URL(
      `../../../${vercel.services[service].root}/package.json`,
      import.meta.url,
    );
    // SAFETY: the service's own package.json, read for its name.
    const { name } = JSON.parse(readFileSync(fileURLToPath(manifest), "utf8")) as { name: string };
    assert.equal(name.slice(name.lastIndexOf("/") + 1), EVE_AGENT_NAME[service], service);
  }
});

/** The first step of a path, where it is spelled as itself rather than matched. */
const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
  const routed = [
    ...(vercel.services[SERVICE.WEB].routes ?? []).map((route) => route.src),
    ...vercel.rewrites.map((rewrite) => rewrite.source),
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

/**
 * A route of the web service as the platform reads it: a rewrite to a file
 * of the build and the headers sent beside it, a redirect's status and
 * `Location`, or headers alone that routing carries on past (`continue`).
 */
interface WebRoute {
  readonly src: string;
  readonly dest?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly continue?: true;
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
 * rewrote it to, or the path left to the build's own files (`file`
 * undefined), with the headers its routes laid on it; or a redirect.
 */
type Served =
  | ({ readonly file: string | undefined } & AnswerHeaders)
  | { readonly status: number; readonly location: string };

// SAFETY: the web service's routes as this repository's vercel.json writes them, which the generator's schema holds to these three shapes.
const WEB_ROUTES = (vercel.services[SERVICE.WEB].routes ?? []) as readonly WebRoute[];

/**
 * What the web service answers a path with, read as Vercel reads its routes,
 * in order: each whose pattern matches the whole path lays its headers on the
 * answer, a later route's header standing in for an earlier one of the same
 * name; one that continues lets routing go on, and the first that does not
 * rewrites the path to its destination, the pattern's groups written in, or
 * redirects it. Where none does, the path is left to the build's own files.
 */
function servedBy(path: string): Served {
  const headers = new Map<string, string>();
  const named = new Map<string, string[]>();
  for (const route of WEB_ROUTES) {
    const pattern = new RegExp(`^${route.src}$`, "u");
    if (!pattern.test(path)) continue;
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      const key = name.toLowerCase();
      headers.set(key, value);
      named.set(key, [...(named.get(key) ?? []), value]);
    }
    if (route.continue) continue;
    if (route.dest !== undefined) {
      return { file: path.replace(pattern, route.dest), headers, named };
    }
    return { status: route.status ?? 0, location: route.headers?.Location ?? "" };
  }
  return { file: undefined, headers, named };
}

const servedFile = (path: string) => {
  const served = servedBy(path);
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

test("a link to any place in Luke, a plan's, a section's and a picture's among them, and the app's own path are served the web app, and no page of Luke's own is", () => {
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
    "/acme/factory",
    "/acme/settings/coding-agents",
    "/acme/person/user_9Fq2-x",
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
    "/api/plans/x/board",
    "/api/inbox/i1",
    "/api/automations/x1/runs",
    "/api/agents/a1",
  ]) {
    const served = new URL(servedFile(path) ?? "/", "https://tryluke.dev");
    assert.equal(served.pathname, "/api/default.js", path);
    assert.equal(served.searchParams.get("route"), "orpc", path);
    assert.equal(served.searchParams.get("route-path"), path.slice("/api/".length), path);
  }
  for (const [path, route] of [
    ["/api/workspaces/w1/photo", "workspaces/photo"],
    ["/api/automations/x1/webhook", "automations/webhook"],
  ] as const) {
    const served = new URL(servedFile(path) ?? "/", "https://tryluke.dev");
    assert.equal(served.pathname, "/api/default.js", path);
    assert.equal(served.searchParams.get("route"), route, path);
    assert.equal(served.searchParams.get("id"), path.split("/")[3], path);
  }
  // The landing page, the sign-in, a static file, and a path naming no place, an old issue's among them, are the build's own files.
  for (const path of [
    "/",
    "/sign-in.html",
    "/favicon.svg",
    "/app/fonts/x.woff2",
    "/acme/plans/x",
    "/acme/issue/i1",
    "/acme",
    "/application",
  ]) {
    assert.equal(servedFile(path), undefined, path);
  }
});

/**
 * Neon Realtime's socket for production's branch and for a Preview's, as
 * Neon names them: `<branch>-neonrealtimesocket` in the project's cell.
 *
 * The app's policy admits them as `wss://*.compute.c-10.us-east-1.aws.neon.tech`:
 * every branch's socket in the project's cell, `c-10`, which Neon keeps every
 * branch of a project in. Note that this names the cell, because each
 * Preview's branch has a host of its own that only its deployment's
 * `NEON_REALTIME_URL` knows, which a static `vercel.json` cannot. Were Neon
 * ever to move the project to another cell, the web app's inbox would stop
 * following (the tab reports the refused socket to Sentry): the source then
 * moves to the new cell, or widens back to `wss://*.us-east-1.aws.neon.tech`,
 * in one line of each app route's policy.
 */
const REALTIME_SOCKETS = [
  "wss://br-lucky-block-au052vsp-neonrealtimesocket.compute.c-10.us-east-1.aws.neon.tech/",
  "wss://br-steep-boat-au63hal6-neonrealtimesocket.compute.c-10.us-east-1.aws.neon.tech/",
] as const;

/**
 * Neon addresses that are not the project's Realtime sockets, which any Neon
 * account may own: a compute endpoint's SQL over HTTP and its serverless
 * driver's socket, in the project's own cell and outside any cell, and another
 * cell's Realtime socket.
 */
const OTHER_NEON_ADDRESSES = [
  "https://ep-cool-darkness-a1b2c3d4.c-10.us-east-1.aws.neon.tech/sql",
  "wss://ep-cool-darkness-a1b2c3d4-pooler.c-10.us-east-1.aws.neon.tech/v2",
  "https://ep-cool-darkness-a1b2c3d4.us-east-1.aws.neon.tech/sql",
  "wss://br-quiet-sun-a1b2c3d4-neonrealtimesocket.compute.c-2.us-east-1.aws.neon.tech/",
] as const;

/**
 * The schemes a source's scheme admits, as CSP3's scheme-part match reads
 * them: its own, and the secure one or the page's own a socket stands for,
 * so a `wss:` source admits an `https:` address on its hosts too.
 */
const SCHEMES_ADMITTED: ReadonlyMap<string, readonly string[]> = new Map([
  ["http", ["http", "https"]],
  ["ws", ["ws", "wss", "http", "https"]],
  ["wss", ["wss", "https"]],
]);

/**
 * Whether a policy's host source admits an address, as a browser matches one
 * (CSP3's host-source): the scheme as `SCHEMES_ADMITTED` widens it, then the
 * host, where a leading `*.` stands for one label or more. A keyword such as
 * `'self'` admits nothing here.
 */
function hostSourceAllows(source: string, address: string): boolean {
  const matched = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([^/:]+)/u.exec(source);
  if (!matched) return false;
  const [, scheme = "", wildcard, host = ""] = matched;
  const url = new URL(address);
  const schemes = SCHEMES_ADMITTED.get(scheme) ?? [scheme];
  if (!schemes.includes(url.protocol.slice(0, -1))) return false;
  return wildcard ? url.hostname.endsWith(`.${host}`) : url.hostname === host;
}

test("every path the web app is served at sends its own Content Security Policy and no other, refuses to be framed, keeps the connect tabs it opens, and is never sniffed", () => {
  const app = WEB_ROUTES.filter((route) => route.dest === "/app.html");
  assert.ok(app.length > 0);
  for (const path of [
    "/app",
    "/app/",
    "/acme/plan/p1",
    "/acme/inbox",
    "/acme/settings/coding-agents",
  ]) {
    const answer = answeredHeaders(path);
    const { headers } = answer;
    // The app is sent its own policy alone, never the site's beside it to be enforced too.
    assert.deepEqual([...policiesSent(answer)], [headers.get("content-security-policy")], path);
    const directives = directivesOf(headers.get("content-security-policy") ?? "");
    assert.deepEqual(directives.get("default-src"), ["'self'"], path);
    assert.deepEqual(directives.get("script-src"), ["'self'"], path);
    assert.deepEqual(directives.get("object-src"), ["'none'"], path);
    assert.deepEqual(directives.get("base-uri"), ["'self'"], path);
    assert.deepEqual(directives.get("form-action"), ["'self'"], path);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], path);
    // The installed app's manifest and its icons are the site's own files.
    assert.deepEqual(directives.get("manifest-src"), ["'self'"], path);
    assert.ok(directives.get("img-src")?.includes("'self'"), path);
    // The tab reaches the processor for session replay, its configuration's host among it,
    // and Sentry's ingest in the organization's region, and no script from either.
    const connect = directives.get("connect-src") ?? [];
    for (const host of [
      "https://us.i.posthog.com",
      "https://us-assets.i.posthog.com",
      "https://*.ingest.us.sentry.io",
    ]) {
      assert.ok(connect.includes(host), `${path} connects to ${host}`);
    }
    // The account inbox is followed over Neon Realtime's socket, one per branch
    // of the deployment's database, production's and each Preview's, and no other
    // address of Neon's, whose compute endpoints anyone may own and post to.
    for (const socket of REALTIME_SOCKETS) {
      assert.ok(
        connect.some((source) => hostSourceAllows(source, socket)),
        `${path} connects to ${socket}`,
      );
    }
    for (const elsewhere of [...OTHER_NEON_ADDRESSES, "wss://elsewhere.example/"]) {
      assert.ok(
        !connect.some((source) => hostSourceAllows(source, elsewhere)),
        `${path} connects to no ${elsewhere}`,
      );
    }
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
  for (const path of ["/api/plans/x/board", "/api/workspaces/w1/photo", "/api/auth/get-session"]) {
    assert.equal(answeredHeaders(path).headers.size, 0, path);
  }
});

/** The pages the web app frames itself, which this site alone may frame (`src/app/web-platform.ts`). */
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

test("the site's pages run scripts from this origin and PostHog's assets alone, connect to this origin and PostHog alone, and draw no inline style", () => {
  const site = pageAnswers().filter(
    ({ file }) => file !== "app.html" && file !== ADMIN_PAGE && !FRAMED_BY_THE_APP.has(file),
  );
  assert.ok(site.length > 0);
  for (const { address, answer } of site) {
    const directives = directivesOf(answer.headers.get("content-security-policy") ?? "");
    assert.deepEqual(directives.get("default-src"), ["'self'"], address);
    // The analytics client (`src/analytics.ts`) loads its configuration and its recorder from PostHog's assets.
    assert.deepEqual(
      directives.get("script-src"),
      ["'self'", "https://us-assets.i.posthog.com"],
      address,
    );
    assert.deepEqual(directives.get("style-src"), ["'self'"], address);
    assert.deepEqual(
      directives.get("connect-src"),
      ["'self'", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
      address,
    );
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:"], address);
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

test("the page the web app frames admits the one style it carries, by its digest, and loads nothing", () => {
  const html = readFileSync(join(WEB, "public", "page-in-mac-app.html"), "utf8");
  const digests = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)].map(
    ([, style = ""]) => `'sha256-${createHash("sha256").update(style).digest("base64")}'`,
  );
  assert.equal(digests.length, 1);
  assert.equal(/<(?:script|link|img|iframe)\b/u.test(html), false);
  for (const file of FRAMED_BY_THE_APP) {
    const directives = directivesOf(
      answeredHeaders(`/${file}`).headers.get("content-security-policy") ?? "",
    );
    assert.deepEqual(directives.get("default-src"), ["'none'"], file);
    assert.deepEqual(directives.get("style-src"), digests, file);
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
