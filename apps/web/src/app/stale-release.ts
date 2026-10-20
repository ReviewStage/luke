/**
 * stale-release.ts -- a tab kept open across a release, reloaded onto the new one as it comes back to the front, or offered the reload while a page holds unsaved work.
 *
 * A tab, and above all the installed app on a phone, keeps the code and the
 * page's policy it loaded with until it is loaded again, which a standalone
 * web app on iOS is only when it is closed for good; so a fix shipped after
 * it loaded never reaches it. Each time the page comes back to the front,
 * shown again or restored from the back-forward cache, and at most once a
 * minute, the release the deployment serves is read from the app's own page
 * (`app.html`'s `luke-release`, written by `scripts/release-meta.ts`) and compared
 * with the release this build carries. A release moved on reloads the tab,
 * unless a page holds unsaved work, when the reload is offered instead, on
 * each such return, in place of the offer before: a press whose leave was
 * cancelled took its toast away, so the next return offers it again. The
 * read is a plain same-origin fetch of a public page and sends nothing of
 * the tab's; a build naming no release, as a development server's, never
 * reads it.
 */

import { Duration, Effect, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RELEASE_META } from "../../scripts/release-meta-name";

/** The app's page, whose served copy names the release the deployment runs. */
const APP_PATH = "/app";

/** How often, at most, the served release is read. */
const CHECK_EVERY = Duration.minutes(1);

/** What the check reaches of the tab. */
export interface StaleReleaseDoor {
  /** The release this build carries; empty for a build that names none. */
  readonly release: string;
  /** The origin that served the page, whose app page is read. */
  readonly origin: string;
  /** Each time the page came back to the front. */
  readonly returns: Stream.Stream<void>;
  /** Whether a page holds unsaved work now. */
  readonly unsavedWork: () => boolean;
  /** Loads the tab again. */
  readonly reload: () => void;
  /** Offers the reload without taking it, for a page holding unsaved work. */
  readonly offerReload: () => void;
}

/** The release a served app page names, or nothing where it names none. */
function releaseOfPage(html: string): string | undefined {
  const page = new DOMParser().parseFromString(html, "text/html");
  const named = page.querySelector(`meta[name="${RELEASE_META}"]`)?.getAttribute("content");
  return named || undefined;
}

/** The release the deployment serves now, read past the browser's cache; nothing where it could not be read. */
const servedRelease = (origin: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(HttpClientRequest.get(new URL(APP_PATH, origin)));
    if (response.status !== 200) return undefined;
    return releaseOfPage(yield* response.text);
  }).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { cache: "no-store" }),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/**
 * Each time the page is shown again after it was hidden, or restored from
 * the back-forward cache, where it was never hidden in between.
 */
export function pageShownAgain(): Stream.Stream<void> {
  const shown = Stream.filter(
    Stream.fromEventListener(document, "visibilitychange"),
    () => document.visibilityState === "visible",
  );
  const restored = Stream.filter(
    Stream.fromEventListener<PageTransitionEvent>(window, "pageshow"),
    (event) => event.persisted,
  );
  return Stream.as(Stream.merge(shown, restored), undefined);
}

/** Each time the browser says it is back online. */
export function backOnline(): Stream.Stream<void> {
  return Stream.as(Stream.fromEventListener(window, "online"), undefined);
}

/**
 * Reloads the tab onto a newer release as it comes back to the front, or
 * offers it while a page holds unsaved work, until interrupted.
 */
export const followRelease = (
  door: StaleReleaseDoor,
): Effect.Effect<void, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (door.release === "") return;
    const checks = Stream.throttle(door.returns, {
      cost: () => 1,
      units: 1,
      duration: CHECK_EVERY,
      strategy: "enforce",
    });
    yield* Stream.runForEach(checks, () =>
      Effect.gen(function* () {
        const served = yield* servedRelease(door.origin);
        if (served === undefined || served === door.release) return;
        if (!door.unsavedWork()) return door.reload();
        door.offerReload();
      }),
    );
  });
