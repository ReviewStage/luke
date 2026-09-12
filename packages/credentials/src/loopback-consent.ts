import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type * as HttpApp from "@effect/platform/HttpApp";
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServer from "@effect/platform/HttpServer";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Deferred, Duration, Effect, Either, Exit, type Scope } from "effect";
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
 * account and Google Calendar — and differs only in the four things the
 * options below name: which ports the redirect may land on, what the
 * authorization page's URL is, what the exchange does with the code, and how
 * the landing card is worded.
 *
 * A trip begins at a press and nowhere else. The verifier is minted here, per
 * trip, so no flow can reach the authorization page with a challenge the
 * exchange will not answer for; nothing a provider sent back reaches the
 * landing page, whose every string is fixed by the build.
 *
 * The listener is one `Scope`'s worth of server: the trip's scope is what
 * binds it and what closes it, on a grant, on the deadline, and on an
 * interruption alike, so no path out of the trip can leave a port bound.
 */

const LOOPBACK_HOST = "127.0.0.1";

/**
 * What a flow naming no registered port binds: whatever the machine has free,
 * which is what a provider documenting loopback redirects as exempt from exact
 * matching allows.
 */
const EPHEMERAL_PORT = 0;

/** Long enough to find the right account; not an open door all afternoon. */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * How long the deadline gives way for a request that was already on the
 * loopback when it came. Long enough for a redirect to be read and claimed,
 * short enough that a stray request buys nothing worth having.
 */
const ARRIVAL_GRACE_MS = 1_000;

/**
 * The reasons every flow shares, worded once. A flow words only the two that
 * name its own provider — a refusal and a timeout — because those are the two
 * a row shows beside the provider's name.
 */
const SHARED_REASON = {
  UNAVAILABLE: "Luke could not open a sign-in callback on this machine.",
  ALREADY_WAITING: "A sign-in is already waiting in your browser.",
  BROWSER: "Luke could not open the sign-in page in your browser.",
  UNCONFIGURED: "Sign-in is not configured in this build.",
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

/** The landing card is a whole document, and it says so of itself. */
const CARD_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Anything that is not this trip's own redirect — another path, a stray
 * request, a state this trip never issued — is refused in the build's own
 * words, and without ending the wait: the real redirect may still be on its
 * way.
 */
const NOT_FOUND = HttpServerResponse.text("Not found", {
  status: RESPONSE_STATUS.NOT_FOUND,
});

/** What one finished consent trip settled on. `reason` is a sentence for a row. */
export type LoopbackConsentOutcome<Grant> = Grant | { reason: string };

/** One landing card's words. The tone and the mark are the flow's own. */
interface LoopbackConsentCard {
  /** The pill's one word or two: "Signed in", "Not connected". */
  badge: string;
  title: string;
  body: string;
}

/** The two cards a trip can end on, worded by the flow that owns it. */
interface LoopbackConsentPages {
  granted: LoopbackConsentCard;
  notGranted: LoopbackConsentCard;
}

/** The two sentences a row shows that name the flow's own provider. */
interface LoopbackConsentReasons {
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
  callbackPath: HttpRouter.PathInput;
  /**
   * Prefixed onto this trip's random state, for a route that reads the prefix
   * back off the state it issued. The entropy after it is unreduced.
   */
  statePrefix?: string;
  /** Whose mark the landing card carries; omitted draws Luke's alone. */
  source?: LoopbackConnectionSource | undefined;
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
  timeoutMs?: number | undefined;
}

/**
 * The flow a run that does not hold a provider's registration offers: the
 * press answers with why, and there is nothing to cancel or reopen. A row
 * drawn this way beats one whose button fails after the user has consented.
 */
export function unofferedConsent<Grant>(): LoopbackConsent<Grant> {
  const unconfigured = { reason: SHARED_REASON.UNCONFIGURED };
  return {
    signIn: async () => unconfigured,
    signInEffect: () => Effect.succeed(unconfigured),
    cancel: () => undefined,
    reopen: () => undefined,
  };
}

export interface LoopbackConsent<Grant> {
  /**
   * One trip, press to grant. A second call while one waits answers with why.
   *
   * @deprecated The Promise door over {@link LoopbackConsent.signInEffect},
   * on the `Effect.runPromise` allowlist in `docs/adr/0001-effect.md`: the
   * settings rows that press this still hold a Promise, so the trip's scope
   * is opened and closed here rather than by a caller's own fiber. Deleted in
   * P7-06, once the composers that own these flows are Layers.
   */
  signIn(): Promise<LoopbackConsentOutcome<Grant>>;
  /**
   * The same one trip as an Effect, whose `Scope` is the listener's: closing
   * it stops the loopback, whether the trip settled, timed out, or was
   * interrupted.
   */
  signInEffect(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope>;
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

/** The first occurrence of a redirect parameter, as a browser would send it. */
function parameter(
  parameters: Readonly<Record<string, string | Array<string>>>,
  name: string,
): string | undefined {
  const value = parameters[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Binds the first port that is free, or the one ephemeral port when the flow
 * named none, and answers the trip's own callback on it for as long as the scope
 * this is called in stands. A registered port already held is the ordinary
 * case — another copy of Luke, or another app — and not a failure until every
 * address the provider knows has been tried, because a port it was never told
 * about would fail at the redirect instead. An attempt that never listened
 * releases as a no-op, so a port tried past costs the trip nothing.
 */
function serveConsent(
  app: HttpApp.Default,
  ports: readonly number[],
  onRequest: () => void,
): Effect.Effect<number | undefined, never, Scope.Scope> {
  return Effect.gen(function* () {
    for (const port of ports) {
      const node = yield* Effect.sync(() => createServer());
      // The loopback answers this machine alone: the provider's redirect lands
      // in the user's own browser, which hands the code back across localhost.
      const bound = yield* Effect.either(
        NodeHttpServer.make(() => node, { port, host: LOOPBACK_HOST }),
      );
      if (Either.isLeft(bound)) continue;
      const server = bound.right;
      yield* Effect.provideService(HttpServer.serveEffect(app), HttpServer.HttpServer, server);
      // A request is announced here rather than in the handler because this is
      // where the old synchronous callback cleared its timer: the handler runs
      // in a fiber of its own, which the deadline could reach first.
      yield* Effect.sync(() => node.on("request", onRequest));
      // The browser keeps its connection alive after the redirect, and a
      // socket it holds open would keep this port bound — which, on a
      // registered port rather than an ephemeral one, is the next trip's port.
      // Ending those connections is what makes the flow repeatable, and this
      // finalizer runs ahead of the server's own close because it was added
      // after it.
      yield* Effect.addFinalizer(() => Effect.sync(() => node.closeAllConnections()));
      return server.address._tag === "TcpAddress" ? server.address.port : undefined;
    }
    return undefined;
  });
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

  function card(
    status: number,
    tone: LoopbackPageTone,
    page: LoopbackConsentCard,
  ): HttpServerResponse.HttpServerResponse {
    return HttpServerResponse.text(accountLoopbackPage({ tone, ...page, source: options.source }), {
      status,
      contentType: CARD_CONTENT_TYPE,
    });
  }

  function trip(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope> {
    return Effect.gen(function* () {
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
      const settled = yield* Deferred.make<LoopbackConsentOutcome<Grant>>();
      // Assigned once a port has bound, before the browser is opened — no
      // request can arrive ahead of it.
      let redirectUri = "";
      let claimed = false;
      let arrived = false;

      const callback = Effect.gen(function* () {
        const parameters = yield* HttpServerRequest.ParsedSearchParams;
        if (parameter(parameters, "state") !== state) return NOT_FOUND;
        if (claimed) {
          return card(RESPONSE_STATUS.ALREADY_USED, LOOPBACK_PAGE_TONE.SETTLED, ALREADY_USED_CARD);
        }
        claimed = true;
        // The landing card is the last thing the sign-in shows, so the trip is
        // settled only once the card has been written: this finalizer runs when
        // the request's own scope closes, which is after the last byte, and the
        // trip's scope closing is what stops the server. It is registered
        // before the exchange rather than after it, and the refusal stands
        // until the exchange answers, because a claimed code that answered
        // nothing at all — an exchange that broke its own contract and threw —
        // must still end the trip rather than leave the loopback listening on
        // a deadline its claim disarmed.
        let outcome: LoopbackConsentOutcome<Grant> = { reason: options.reasons.refused };
        yield* Effect.addFinalizer(() => Deferred.succeed(settled, outcome));
        const refused = parameter(parameters, "error");
        const code = parameter(parameters, "code");
        if (!refused && code) {
          outcome = yield* Effect.promise(() =>
            options.exchange({ code, redirectUri, codeVerifier }),
          );
        }
        const granted = !("reason" in outcome);
        return card(
          RESPONSE_STATUS.ANSWERED,
          granted ? LOOPBACK_PAGE_TONE.SETTLED : LOOPBACK_PAGE_TONE.ATTENTION,
          granted ? options.pages.granted : options.pages.notGranted,
        );
      });

      // The router is the path match, and the one refusal it raises for every
      // other path is answered in the build's own words rather than the
      // platform's empty one.
      const app = Effect.catchTag(
        HttpRouter.empty.pipe(HttpRouter.all(options.callbackPath, callback)),
        "RouteNotFound",
        () => Effect.succeed(NOT_FOUND),
      );
      const port = yield* serveConsent(app, options.ports ?? [EPHEMERAL_PORT], () => {
        arrived = true;
      });
      if (port === undefined) return { reason: SHARED_REASON.UNAVAILABLE };
      redirectUri = `http://${LOOPBACK_HOST}:${port}${options.callbackPath}`;

      const authorizationUrl = options.authorizationUrl({
        state,
        redirectUri,
        codeChallenge: challenge,
      });
      if (withdrawn) return { reason: LOOPBACK_CONSENT_CANCELLED };
      // A callback already claimed is a code in hand rather than an open door,
      // so a cancel that arrives after it withdraws nothing.
      abandon = () => {
        if (claimed) return;
        Deferred.unsafeDone(settled, Exit.succeed({ reason: LOOPBACK_CONSENT_CANCELLED }));
      };
      reopenPage = () => {
        void Promise.resolve(options.openExternal(authorizationUrl)).catch(() => undefined);
      };
      const opened = yield* Effect.either(
        Effect.tryPromise(() => Promise.resolve(options.openExternal(authorizationUrl))),
      );
      // A page that never opened is a trip nobody can complete, and saying
      // so beats waiting out the timeout on a tab that does not exist.
      if (Either.isLeft(opened)) return { reason: SHARED_REASON.BROWSER };

      yield* Effect.forkScoped(
        Effect.sleep(Duration.millis(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)).pipe(
          // A request already on the loopback when the deadline comes is not an
          // abandoned trip, and a consent the developer has just given must not
          // lose a race to the clock: the deadline gives way for as long as
          // requests keep arriving unclaimed, and decides a grace period after
          // the last one, so a stray request delays it rather than holding the
          // trip open.
          Effect.zipRight(
            Effect.iterate(undefined, {
              while: () => arrived && !claimed,
              body: () =>
                Effect.zipRight(
                  Effect.sync(() => {
                    arrived = false;
                  }),
                  Effect.sleep(Duration.millis(ARRIVAL_GRACE_MS)),
                ),
            }),
          ),
          Effect.flatMap(() =>
            claimed ? Effect.void : Deferred.succeed(settled, { reason: options.reasons.timedOut }),
          ),
        ),
      );
      return yield* Deferred.await(settled);
    });
  }

  function signInEffect(): Effect.Effect<LoopbackConsentOutcome<Grant>, never, Scope.Scope> {
    return Effect.suspend(() => {
      if (running) {
        return Effect.succeed<LoopbackConsentOutcome<Grant>>({
          reason: SHARED_REASON.ALREADY_WAITING,
        });
      }
      running = true;
      return Effect.ensuring(
        trip(),
        Effect.sync(() => {
          running = false;
          abandon = undefined;
          reopenPage = undefined;
        }),
      );
    });
  }

  return {
    signIn(): Promise<LoopbackConsentOutcome<Grant>> {
      return Effect.runPromise(Effect.scoped(signInEffect()));
    },
    signInEffect,
    cancel(): void {
      abandon?.();
    },
    reopen(): void {
      reopenPage?.();
    },
  };
}
