import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, matchesGlob, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SANDBOX_ORIGIN } from "@repo/features/page-frame";
import { POSTHOG_PROXY } from "@repo/features/posthog-proxy";
import { RESERVED_WORKSPACE_SLUGS } from "@repo/features/workspace-wire";
import { temporaryDirectory } from "@repo/runtime/testing";
import { PAGE_LINK_ROUTE } from "@repo/service/pages/page-links";
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
    "luke/fix-relay",
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

const FIRST_STEP = /^\^?\/([a-z0-9-]+)(?:\/|$)/u;

test("no workspace's slug can be the first step of a page the web app serves under its own name", () => {
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

interface HostCondition {
  readonly type: "host";
  readonly value: { readonly re: string };
}

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

const APP_HOST = "tryluke.dev";

const SANDBOX_HOST = new URL(PAGE_SANDBOX_ORIGIN).host;

const SANDBOX_HOSTS = [SANDBOX_HOST, `${SANDBOX_HOST}.`] as const;

function heldTo(entry: { readonly has?: readonly HostCondition[] }, host: string): boolean {
  return (entry.has ?? []).every((condition) => new RegExp(condition.value.re, "u").test(host));
}

function serviceFor(path: string, host: string): string | undefined {
  return vercel.rewrites.find(
    (rewrite) => heldTo(rewrite, host) && new RegExp(`^${rewrite.source}$`, "iu").test(path),
  )?.destination.service;
}

interface AnswerHeaders {
  readonly headers: ReadonlyMap<string, string>;
  readonly named: ReadonlyMap<string, readonly string[]>;
}

type Served =
  | ({ readonly file: string | undefined; readonly forced?: number } & AnswerHeaders)
  | { readonly status: number; readonly location: string };

const WEB_ROUTES: readonly WebRoute[] = vercel.services[SERVICE.WEB].routes;

function servedBy(path: string, host = APP_HOST): Served {
  const headers = new Map<string, string>();
  const named = new Map<string, string[]>();
  for (const route of WEB_ROUTES) {
    const pattern = new RegExp(`^${route.src}$`, "u");
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
    return {
      status: route.status ?? 0,
      location: path.replace(pattern, route.headers?.Location ?? ""),
    };
  }
  return { file: undefined, headers, named };
}

const servedFile = (path: string, host = APP_HOST) => {
  const served = servedBy(path, host);
  return "file" in served ? served.file : undefined;
};

function answeredHeaders(path: string): AnswerHeaders {
  const served = servedBy(path);
  assert.ok("headers" in served, `${path} is answered, not redirected`);
  return served;
}

function policiesSent(answer: AnswerHeaders): ReadonlySet<string> {
  return new Set(answer.named.get("content-security-policy"));
}

function directivesOf(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    }),
  );
}

test("a link to any place in Vespin, a workspace's Home and Board, a plan's, a section's, a picture's, and a box's pairing among them, and the app's own path are served the web app, and no page of Vespin's own is", () => {
  for (const path of [
    "/app",
    "/app/",
    "/acme",
    "/acme/",
    "/personal-u_1",
    "/application",
    "/acme/tasks",
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
    "/acme/settings/",
  ]) {
    assert.equal(servedFile(path), "/app.html", path);
  }
  assert.deepEqual(servedBy("/app.html"), { status: 308, location: "/app" });
  assert.equal(servedFile("/about"), "/about.html");
  assert.equal(servedFile("/privacy"), "/privacy.html");
  assert.equal(servedFile("/changelog"), "/changelog.html");
  assert.equal(servedFile("/changelog/page/2"), "/changelog/page/2.html");
  assert.equal(servedFile("/admin"), "/admin.html");
  for (const [path, location] of [
    ["/about/", "/about"],
    ["/privacy/", "/privacy"],
    ["/changelog/", "/changelog"],
    ["/changelog/page/2/", "/changelog/page/2"],
    ["/changelog/0.24.0/", "/changelog/0.24.0"],
    ["/changelog/page/1", "/changelog"],
    ["/changelog/page/1/", "/changelog"],
  ] as const) {
    assert.deepEqual(servedBy(path), { status: 308, location }, path);
  }
  for (const path of [
    "/api/plans/x/description/revisions",
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
  for (const path of [
    "/",
    "/sign-in.html",
    "/favicon.svg",
    "/app/marks/codex-16.png",
    "/robots.txt",
    "/acme/plans/x",
    "/acme/issue/i1",
  ]) {
    assert.equal(servedFile(path), undefined, path);
  }
});

test("no page of Vespin's own, by any first step a workspace's slug may not take, nor a file of the site's, is served the web app as a workspace's Home", () => {
  const reserved = [...RESERVED_WORKSPACE_SLUGS].filter((step) => step !== "app");
  for (const step of reserved) {
    for (const path of [`/${step}`, `/${step}/`, `/${step}.html`]) {
      assert.notEqual(servedFile(path), "/app.html", path);
    }
  }
  for (const path of [
    "/robots.txt",
    "/favicon.ico",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/@vite",
  ]) {
    assert.notEqual(servedFile(path), "/app.html", path);
  }
});

test("a first step no workspace's slug or id could be is answered the site's not-found page under a 404, and one a workspace's could be is served the web app, to say nothing of which are taken", () => {
  for (const path of ["/About", "/Stage/", `/${"a".repeat(97)}`]) {
    const served = servedBy(path);
    assert.ok("file" in served && served.file === "/404.html" && served.forced === 404, path);
  }
  for (const path of [
    "/xyz",
    "/Xq3vT9bLmN2pRw7sYk4dHc6fJg8aZe1u",
    `/personal-${"Ab3".repeat(10)}Cd-3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b`,
  ]) {
    assert.equal(servedFile(path), "/app.html", path);
  }
});

test("each standalone page is served at its clean path and at its .html file's alike, under the same headers, and neither is redirected", () => {
  for (const page of [
    "sign-in",
    "consent",
    "desktop-session",
    "accept-invitation",
    "connect-github",
    "github-installed",
    "integration-connected",
    "page-in-mac-app",
  ]) {
    const file = `/${page}.html`;
    const clean = servedBy(`/${page}`);
    const alias = servedBy(file);
    assert.ok("file" in clean && clean.file === file && clean.forced === undefined, page);
    assert.ok("file" in alias && (alias.file ?? file) === file && alias.forced === undefined, page);
    assert.deepEqual([...clean.named], [...alias.named], page);
  }
});

const LINK_TOKEN = "eyJzaXRlIjoiaHR0cHM6Ly9mdWxsc3Bpbi5wYWdlIn0.c2lnbmVkLWJ5LXRoZS1zZXJ2aWNl";

const APP_PATHS = [
  "/",
  "/app",
  "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  "/connect/BCDF-GHJK",
  "/api/auth/get-session",
  "/api/plans/x/description/revisions",
  "/api/pages/sandbox",
  "/api/default.js",
  "/sign-in.html",
  "/page-in-mac-app.html",
  "/favicon.svg",
  "/assets/app-DyIpMmfT.js",
  "/install.sh",
] as const;

const SANDBOX_NOT_FOUND = "/sandbox-not-found.txt";

test("the sandbox's host, spelled with a trailing dot or without, reaches the page route alone, by a link's address, and answers every other path, the app's, the API's, and auth's among them, not found from a static file", async () => {
  const pageRoute = PAGE_LINK_ROUTE.PATH.slice("/api/".length);
  const pages = (await webFunctions(WEB)).find((definition) =>
    definition.routes.includes(pageRoute),
  );
  assert.ok(pages !== undefined);
  assert.deepEqual(pages.routes, [pageRoute]);
  const pagesPath = `/${functionPublicPath(pages)}`;
  const linkPath = `/${PAGE_LINK_ROUTE.STEP}/${LINK_TOKEN}`;
  assert.ok(readdirSync(join(WEB, "public")).includes(SANDBOX_NOT_FOUND.slice(1)));
  for (const host of SANDBOX_HOSTS) {
    for (const path of [linkPath, ...APP_PATHS]) {
      assert.equal(serviceFor(path, host), SERVICE.WEB, `${host}${path}`);
    }
    const link = servedBy(linkPath, host);
    assert.ok("file" in link && link.file !== undefined && link.forced === undefined, host);
    const landed = new URL(link.file, PAGE_SANDBOX_ORIGIN);
    assert.equal(landed.pathname, pagesPath, host);
    assert.equal(landed.searchParams.get("route"), pageRoute, host);
    assert.equal(landed.searchParams.get(PAGE_LINK_ROUTE.TOKEN_QUERY), LINK_TOKEN, host);
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
  for (const host of [
    APP_HOST,
    "vespin-web-git-main-stage-review.vercel.app",
    `www.${SANDBOX_HOST}`,
    `${SANDBOX_HOST}.example`,
    `${SANDBOX_HOST}s`,
  ]) {
    assert.equal(serviceFor(linkPath, host), SERVICE.WEB, host);
    assert.equal(servedFile(linkPath, host), undefined, host);
    assert.equal(servedFile("/app", host), "/app.html", host);
  }
});

test("every path the web app is served at sends its own Content Security Policy and no other, refuses to be framed, keeps the connect tabs it opens, and is never sniffed", () => {
  const app = WEB_ROUTES.filter((route) => route.dest === "/app.html");
  assert.ok(app.length > 0);
  for (const path of ["/app", "/app/", "/acme/plan/p1", "/acme/inbox", "/acme/settings/agents"]) {
    const answer = answeredHeaders(path);
    const { headers } = answer;
    assert.deepEqual([...policiesSent(answer)], [headers.get("content-security-policy")], path);
    const directives = directivesOf(headers.get("content-security-policy") ?? "");
    assert.deepEqual(directives.get("default-src"), ["'self'"], path);
    assert.deepEqual(directives.get("script-src"), ["'self'", "'wasm-unsafe-eval'"], path);
    assert.deepEqual(directives.get("object-src"), ["'none'"], path);
    assert.deepEqual(directives.get("base-uri"), ["'self'"], path);
    assert.deepEqual(directives.get("form-action"), ["'self'"], path);
    assert.deepEqual(directives.get("frame-ancestors"), ["'none'"], path);
    assert.deepEqual(directives.get("frame-src"), ["'self'", PAGE_SANDBOX_ORIGIN], path);
    assert.deepEqual(directives.get("manifest-src"), ["'self'"], path);
    assert.ok(directives.get("img-src")?.includes("'self'"), path);
    assert.deepEqual(
      directives.get("connect-src"),
      ["'self'", "https://*.ingest.us.sentry.io"],
      path,
    );
    assert.equal(headers.get("x-frame-options"), "DENY", path);
    assert.equal(headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin", path);
    assert.equal(headers.get("cross-origin-opener-policy"), "same-origin-allow-popups", path);
    assert.ok(
      headers.get("permissions-policy")?.split(/,\s*/u).includes("microphone=(self)"),
      path,
    );
  }
  for (const path of [
    "/api/plans/x/description/revisions",
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

const FRAMED_BY_THE_APP: ReadonlySet<string> = new Set(["page-in-mac-app.html"]);

const ADMIN_PAGE = "admin.html";

const ENTRY_PAGES = readdirSync(WEB).filter((name) => name.endsWith(".html"));

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

function addressesServing(file: string, candidates: readonly string[]): readonly string[] {
  return [...new Set(candidates)].filter((address) => {
    const served = servedBy(address);
    if (!("file" in served)) return false;
    if (served.file !== undefined) return served.file === `/${file}`;
    return address === `/${file}` || (file === "index.html" && address === "/");
  });
}

function pageAnswers(): readonly { file: string; address: string; answer: AnswerHeaders }[] {
  return [...emittedPages()].flatMap(([file, candidates]) => {
    const addresses = addressesServing(file, candidates);
    assert.ok(addresses.length > 0, `${file} is served at an address`);
    return addresses.map((address) => ({ file, address, answer: answeredHeaders(address) }));
  });
}

function sourcesOf(directives: ReadonlyMap<string, readonly string[]>, name: string) {
  return directives.get(name) ?? directives.get("default-src") ?? [];
}

test("every HTML page the build emits is served at every address under one Content Security Policy that runs no inline script, framed by no other site, and never sniffed", () => {
  const answers = pageAnswers();
  assert.ok(answers.some(({ file }) => file.startsWith("changelog/page/")));
  for (const { file, address, answer } of answers) {
    const { headers } = answer;
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
    assert.deepEqual(directives.get("script-src"), ["'self'"], address);
    assert.deepEqual(directives.get("style-src"), ["'self'"], address);
    assert.deepEqual(directives.get("connect-src"), ["'self'"], address);
    assert.deepEqual(directives.get("img-src"), ["'self'", "data:"], address);
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
    assert.deepEqual(directives.get("style-src"), ["'self'", "'unsafe-inline'"], address);
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
