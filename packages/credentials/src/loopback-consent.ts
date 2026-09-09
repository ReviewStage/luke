import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  accountLoopbackPage,
  LOOPBACK_PAGE_TONE,
  type LoopbackConnectionSource,
  type LoopbackPageTone,
} from "./loopback-page.js";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

/**
 * One consent trip, from a press to a grant: an authorization page opened in
 * the user's own browser, a code handed back on a loopback redirect that never
 * leaves this machine, and a PKCE-verified exchange with whoever issued the
 * page. Every provider Luke asks consent of runs this same trip — the Luke
 * account, Google Calendar, Linear — and differs only in the four things the
 * options below name: which ports the redirect may land on, what the
 * authorization page's URL is, what the exchange does with the code, and how
 * the landing card is worded.
 *
 * A trip begins at a press and nowhere else. The verifier is minted here, per
 * trip, so no flow can reach the authorization page with a challenge the
 * exchange will not answer for; nothing a provider sent back reaches the
 * landing page, whose every string is fixed by the build.
 */

const LOOPBACK_HOST = "127.0.0.1";

/** Long enough to find the right account; not an open door all afternoon. */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * The reasons every flow shares, worded once. A flow words only the two that
 * name its own provider — a refusal and a timeout — because those are the two
 * a row shows beside the provider's name.
 */
const SHARED_REASON = {
  UNAVAILABLE: "Luke could not open a sign-in callback on this machine.",
  ALREADY_WAITING: "A sign-in is already waiting in your browser.",
  BROWSER: "Luke could not open the sign-in page in your browser.",
} as const;

/**
 * What a withdrawn trip settles as. A caller that must tell a cancellation —
 * an ordinary outcome — from a failure worth reporting compares against this.
 */
export const LOOPBACK_CONSENT_CANCELLED = "Sign-in was cancelled.";

/**
 * The card a second callback is answered with, in no flow's particular words
 * because it says nothing about the provider: the trip it belongs to is spent.
 */
const ALREADY_USED_CARD = {
  badge: "Already used",
  title: "This sign-in has already been used",
  body: "You can close this tab and return to Luke.",
} as const;

const RESPONSE_STATUS = {
  ANSWERED: 200,
  NOT_FOUND: 404,
  ALREADY_USED: 409,
} as const;

/** What one finished consent trip settled on. `reason` is a sentence for a row. */
export type LoopbackConsentOutcome<Grant> = Grant | { reason: string };

/** One landing card's words. The tone and the mark are the flow's own. */
export interface LoopbackConsentCard {
  /** The pill's one word or two: "Signed in", "Not connected". */
  badge: string;
  title: string;
  body: string;
}

/** The two cards a trip can end on, worded by the flow that owns it. */
export interface LoopbackConsentPages {
  granted: LoopbackConsentCard;
  notGranted: LoopbackConsentCard;
}

/** The two sentences a row shows that name the flow's own provider. */
export interface LoopbackConsentReasons {
  /** The provider's redirect carried a refusal, or carried no code. */
  refused: string;
  /** Nothing came back before the wait expired. */
  timedOut: string;
}

export interface LoopbackAuthorization {
  /** This trip's own state, which the callback is matched against. */
  state: string;
  /** The bound loopback address the provider must send the code back to. */
  redirectUri: string;
  /** The S256 challenge for the verifier the exchange will be handed. */
  codeChallenge: string;
}

export interface LoopbackExchange {
  code: string;
  redirectUri: string;
  /** The verifier whose challenge the authorization page was shown. */
  codeVerifier: string;
}

export interface LoopbackConsentOptions<Grant> {
  /**
   * The registered ports to try in order, first that binds. Omitted means one
   * ephemeral port, which is what a provider documenting loopback redirects as
   * exempt from exact matching allows — and the safe default, because a fixed
   * port a provider was never told about fails at the redirect instead.
   */
  ports?: readonly number[];
  /** The path the redirect must land on; anything else is refused. */
  callbackPath: string;
  /**
   * Prefixed onto this trip's random state, for a route that reads the prefix
   * back off the state it issued. The entropy after it is unreduced.
   */
  statePrefix?: string;
  /** Whose mark the landing card carries; omitted draws Luke's alone. */
  source?: LoopbackConnectionSource;
  pages: LoopbackConsentPages;
  reasons: LoopbackConsentReasons;
  /** The consent page's URL, built from the state and the bound redirect. */
  authorizationUrl(input: LoopbackAuthorization): string;
  /** Trades the code for a grant, or names why not. Never throws. */
  exchange(input: LoopbackExchange): Promise<LoopbackConsentOutcome<Grant>>;
  /**
   * Opens the consent page in the user's own browser. Injected so the caller
   * hands in the shell and tests hand in a recorder — this module never
   * reaches for Electron itself.
   */
  openExternal(url: string): void | Promise<void>;
  timeoutMs?: number;
}

export interface LoopbackConsent<Grant> {
  /** One trip, press to grant. A second call while one waits answers with why. */
  signIn(): Promise<LoopbackConsentOutcome<Grant>>;
  /**
   * Ends the trip now waiting, if any. The browser tab is left where it is —
   * closing another app's window is not Luke's to do — but the loopback stops
   * listening, so a grant given after this lands nowhere. A callback already
   * claimed is left to finish: that is a code in hand, not an open door.
   */
  cancel(): void;
  /**
   * Opens the waiting trip's consent page again — the very URL, state and
   * challenge included, the trip is already listening for — for a tab lost
   * behind other windows or closed by mistake. With nothing waiting there is
   * no page to reopen, and nothing happens.
   */
  reopen(): void;
}

function loopbackState(prefix: string | undefined): string {
  const random = randomBytes(32).toString("base64url");
  return prefix ? `${prefix}.${random}` : random;
}

/**
 * Binds the first port that is free, or the one ephemeral port when the flow
 * named none. A registered port already held is the ordinary case — another
 * copy of Luke, or another app — and not a failure until every address the
 * provider knows has been tried, because a port it was never told about would
 * fail at the redirect instead.
 */
async function bind(server: Server, ports: readonly number[]): Promise<number | undefined> {
  for (const port of ports) {
    const bound = await new Promise<boolean>((resolve) => {
      const failed = (): void => {
        server.removeListener("error", failed);
        // A server that failed to bind is closed before the next address is
        // tried, so no attempt inherits the last one's half-open state.
        server.close(() => resolve(false));
      };
      server.once("error", failed);
      // The loopback answers this machine alone: the provider's redirect lands
      // in the user's own browser, which hands the code back across localhost.
      server.listen(port, LOOPBACK_HOST, () => {
        server.removeListener("error", failed);
        resolve(true);
      });
    });
    if (!bound) continue;
    // SAFETY: A TCP server that is listening has an AddressInfo address; a Unix
    // socket path never arises on this host binding.
    return (server.address() as AddressInfo).port;
  }
  return undefined;
}

/**
 * `Grant` is an object so a refusal can be told from a grant by the one field
 * a refusal has and no grant may: a flow whose grant carried `reason` would
 * make the two indistinguishable at the moment the landing card is chosen.
 */
export function loopbackConsent<Grant extends object>(
  options: LoopbackConsentOptions<Grant>,
): LoopbackConsent<Grant> {
  let running = false;
  let abandon: (() => void) | undefined;
  let reopenPage: (() => void) | undefined;

  function card(tone: LoopbackPageTone, page: LoopbackConsentCard): string {
    return accountLoopbackPage({
      tone,
      ...page,
      ...(options.source ? { source: options.source } : undefined),
    });
  }

  async function run(): Promise<LoopbackConsentOutcome<Grant>> {
    // A press on Cancel while the port is still binding must not be lost: the
    // trip is not yet listening, so there is nothing to withdraw except the
    // intention, which the arming below reads back.
    let withdrawn = false;
    abandon = () => {
      withdrawn = true;
    };
    const codeVerifier = createCodeVerifier();
    const challenge = codeChallenge(codeVerifier);
    const state = loopbackState(options.statePrefix);

    let finish: (outcome: LoopbackConsentOutcome<Grant>) => void = () => undefined;
    const outcome = new Promise<LoopbackConsentOutcome<Grant>>((resolve) => {
      finish = resolve;
    });
    // Assigned once a port has bound, before the browser is opened — no
    // request can arrive ahead of it.
    let redirectUri = "";
    let claimed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
      // Anything that is not this trip's own redirect — another path, a stray
      // request, a state this trip never issued — is refused without ending
      // the wait: the real redirect may still be on its way.
      if (url.pathname !== options.callbackPath || url.searchParams.get("state") !== state) {
        response.writeHead(RESPONSE_STATUS.NOT_FOUND, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }
      if (claimed) {
        response.writeHead(RESPONSE_STATUS.ALREADY_USED, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(card(LOOPBACK_PAGE_TONE.SETTLED, ALREADY_USED_CARD));
        return;
      }
      claimed = true;
      if (timeout) clearTimeout(timeout);
      abandon = undefined;
      const answer = (granted: boolean): void => {
        response.writeHead(RESPONSE_STATUS.ANSWERED, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          granted
            ? card(LOOPBACK_PAGE_TONE.SETTLED, options.pages.granted)
            : card(LOOPBACK_PAGE_TONE.ATTENTION, options.pages.notGranted),
        );
      };
      const refused = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (refused || !code) {
        answer(false);
        finish({ reason: options.reasons.refused });
        return;
      }
      void options.exchange({ code, redirectUri, codeVerifier }).then((exchanged) => {
        answer(!("reason" in exchanged));
        finish(exchanged);
      });
    });

    const port = await bind(server, options.ports ?? [0]);
    if (port === undefined) return { reason: SHARED_REASON.UNAVAILABLE };
    redirectUri = `http://${LOOPBACK_HOST}:${port}${options.callbackPath}`;

    try {
      const authorizationUrl = options.authorizationUrl({
        state,
        redirectUri,
        codeChallenge: challenge,
      });
      timeout = setTimeout(
        () => finish({ reason: options.reasons.timedOut }),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      timeout.unref();
      abandon = () => finish({ reason: LOOPBACK_CONSENT_CANCELLED });
      if (withdrawn) return { reason: LOOPBACK_CONSENT_CANCELLED };
      reopenPage = () => {
        void Promise.resolve(options.openExternal(authorizationUrl)).catch(() => undefined);
      };
      try {
        await options.openExternal(authorizationUrl);
      } catch {
        // A page that never opened is a trip nobody can complete, and saying
        // so beats waiting out the timeout on a tab that does not exist.
        return { reason: SHARED_REASON.BROWSER };
      }
      return await outcome;
    } finally {
      clearTimeout(timeout);
      server.close();
      // The browser keeps its connection alive after the redirect, and a
      // socket it holds open would keep this port bound — which, on a
      // registered port rather than an ephemeral one, is the next trip's port.
      // Ending those connections is what makes the flow repeatable.
      server.closeAllConnections();
      // The server holds the process open only while the trip is live; a
      // browser tab left forever must not be what keeps Luke running.
      server.unref();
    }
  }

  return {
    async signIn(): Promise<LoopbackConsentOutcome<Grant>> {
      if (running) return { reason: SHARED_REASON.ALREADY_WAITING };
      running = true;
      try {
        return await run();
      } finally {
        running = false;
        abandon = undefined;
        reopenPage = undefined;
      }
    },
    cancel(): void {
      abandon?.();
    },
    reopen(): void {
      reopenPage?.();
    },
  };
}
