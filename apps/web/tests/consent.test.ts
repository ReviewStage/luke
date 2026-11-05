// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

/**
 * consent.test.ts -- an authorization from a client that is not trusted stops
 * on the consent page, which names the client, the account, a line for each
 * scope, and where the answer goes, and sends nothing until the member
 * answers: Allow accepts, and Deny refuses and follows the server to the
 * client's redirect. And a sign-in page whose `state` names no provider offers
 * both, each sign-in carrying the signed authorization so it resumes. The
 * pages run as they do in the browser, each mounted on its own `#root`; the
 * network, the HTTP boundary to Better Auth, is a fake, and the page leaving
 * is read off jsdom's report that it cannot navigate, which names no address,
 * so the address left for is the fake server's `access_denied` redirect.
 */

declare global {
  /** The page's own jsdom, which vitest's jsdom environment sets on the global. */
  var jsdom: {
    readonly virtualConsole: { on(event: string, listen: (error: Error) => void): void };
  };
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** Every root the pages mount themselves on, to unmount once each test ends. */
const mounted = vi.hoisted(() => ({ roots: [] as Array<{ unmount(): void }> }));

// Note that a page mounts its own root as its module loads, so React's
// `createRoot` is wrapped to keep each one, and nothing else about it
// changes: a pressed button stays busy after the test ends, and its settle
// would otherwise draw a moment later, after jsdom has gone.
vi.mock("react-dom/client", async (importOriginal) => {
  const client = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...client,
    createRoot: (...args: Parameters<typeof client.createRoot>) => {
      const root = client.createRoot(...args);
      mounted.roots.push(root);
      return root;
    },
  };
});

const PATH = {
  SESSION: "/api/auth/get-session",
  PUBLIC_CLIENT: "/api/auth/oauth2/public-client",
  CONSENT: "/api/auth/oauth2/consent",
  SOCIAL: "/api/auth/sign-in/social",
} as const;

const ACCOUNT = { id: "account-1", name: "Ada", email: "ada@example.com" };
/** Where the server sends each answer: the client's redirect, with a code or with `access_denied`. */
const ANSWERED = {
  ALLOWED: "http://127.0.0.1:4810/callback?code=code-for-the-client&state=client-state",
  DENIED:
    "http://127.0.0.1:4810/callback?error=access_denied&error_description=User+denied+access&state=client-state",
} as const;

/** An authorization as the server signs it onto the consent and sign-in pages, for a client whose `state` names no provider. */
function signedAuthorization(): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "acme-notes",
    redirect_uri: "http://127.0.0.1:4810/callback",
    scope: "openid email offline_access acme:notes",
    state: "client-state",
    exp: "4102444800",
  });
  for (const name of [...query.keys(), "ba_param"].sort()) query.append("ba_param", name);
  query.set("sig", "signature-from-the-server");
  return query.toString();
}

/** One request the page sent: its path and its JSON body. */
interface Sent {
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

let sent: Sent[] = [];
/** How many times the page tried to leave. */
let leaves = 0;

/** Better Auth's answers, by path and body; every other request hangs. */
function answer(path: string, body: Record<string, unknown> | undefined): Response | undefined {
  if (path === PATH.SESSION) {
    return Response.json({ session: { id: "session-1", userId: ACCOUNT.id }, user: ACCOUNT });
  }
  if (path === PATH.PUBLIC_CLIENT) {
    return Response.json({ client_id: "acme-notes", client_name: "Acme Notes" });
  }
  if (path === PATH.CONSENT) {
    const url = body?.accept === true ? ANSWERED.ALLOWED : ANSWERED.DENIED;
    return Response.json({ redirect: true, url });
  }
  return undefined;
}

/** `page` as the browser opens it at `address`, against the fake. */
async function openPage(page: "consent" | "sign-in", address: string): Promise<HTMLElement> {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), window.location.href);
    const text = request === undefined ? init?.body : await request.text();
    const body = typeof text === "string" ? JSON.parse(text) : undefined;
    sent.push({ path: url.pathname, body });
    return answer(url.pathname, body) ?? new Promise<Response>(() => undefined);
  });
  window.history.replaceState(null, "", address);
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  vi.resetModules();
  await act(async () => {
    await import(page === "consent" ? "../src/consent" : "../src/sign-in");
  });
  return root;
}

function buttonNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(page.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === name,
  );
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}

/** The page's title, once it says `title`. */
async function titled(page: HTMLElement, title: string): Promise<void> {
  await vi.waitFor(() => expect(page.querySelector("h1")?.textContent).toBe(title));
}

function postedTo(path: string): Sent[] {
  return sent.filter((each) => each.path === path);
}

beforeAll(() => {
  // Note that jsdom does not navigate: it reports each attempt on its own
  // console, which the environment exposes as `jsdom`.
  globalThis.jsdom.virtualConsole.on("jsdomError", (error) => {
    if (error.message.includes("navigation")) leaves += 1;
  });
});

afterEach(() => {
  act(() => {
    for (const root of mounted.roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
  sent = [];
  leaves = 0;
});

test("a client that is not trusted is named with its account, scopes, and redirect, and Allow alone accepts", async () => {
  const page = await openPage("consent", `/consent.html?${signedAuthorization()}`);

  await titled(page, "Acme Notes wants to use your Vespin account");
  expect(page.textContent).toContain("You'll allow it as ada@example.com.");
  expect(Array.from(page.querySelectorAll("li"), (item) => item.textContent)).toEqual([
    "Know which Vespin account is yours",
    "See your email address",
    "Keep this access after you close the window",
    "acme:notes",
  ]);
  expect(page.textContent).toContain("Your answer goes to an app on this computer.");
  expect(page.querySelector("img")).toBeNull();
  expect(postedTo(PATH.CONSENT)).toEqual([]);

  await act(async () => buttonNamed(page, "Allow").click());

  await vi.waitFor(() => expect(postedTo(PATH.CONSENT)).toHaveLength(1));
  expect(postedTo(PATH.CONSENT)[0]?.body).toMatchObject({
    accept: true,
    oauth_query: expect.stringContaining("client_id=acme-notes"),
  });
});

test("Deny refuses the client and follows the server to its redirect with access_denied", async () => {
  const page = await openPage("consent", `/consent.html?${signedAuthorization()}`);
  await titled(page, "Acme Notes wants to use your Vespin account");
  expect(leaves).toBe(0);

  await act(async () => buttonNamed(page, "Deny").click());

  await vi.waitFor(() => expect(leaves).toBe(1));
  expect(postedTo(PATH.CONSENT).map((each) => each.body?.accept)).toEqual([false]);
});

test("a sign-in whose state names no provider offers both, and each carries the authorization to resume", async () => {
  const page = await openPage("sign-in", `/sign-in.html?${signedAuthorization()}`);
  await titled(page, "Sign in to Vespin");
  expect(Array.from(page.querySelectorAll("button"), (button) => button.textContent)).toEqual([
    "Continue with Google",
    "Continue with GitHub",
  ]);
  expect(postedTo(PATH.SOCIAL)).toEqual([]);

  await act(async () => buttonNamed(page, "Continue with GitHub").click());

  await vi.waitFor(() => expect(postedTo(PATH.SOCIAL)).toHaveLength(1));
  expect(postedTo(PATH.SOCIAL)[0]?.body).toMatchObject({
    provider: "github",
    oauth_query: expect.stringContaining("client_id=acme-notes"),
  });
});
