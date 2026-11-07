/**
 * tasks-procedures.ts -- the addresses the Tasks tab opens in the browser, and its code colored.
 *
 * The one check these procedures make is who asked. Only a panel draws the
 * Tasks tab, and the takeover and any other window draw no task, so
 * every one refuses them, in its own sentence. The Tasks tab's plain asks
 * and live follows are declared (`contract/tasks.ts`) and answered by the
 * tasks composer; Connect GitHub is declared too, but opens here the page
 * the host names.
 */

import { ADMIN_PAGE_PATH } from "@repo/features/admin-wire";
import type { CodeLines } from "@repo/features/tasks-view";
import { Effect } from "effect";
import { isWebAddress } from "../acts.js";
import { TASKS_ACT_KIND, TASKS_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import { type ActSender, actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";

/** What the task procedures are handed: the doors of the window's process they open or read. */
export interface TasksProceduresDependencies {
  /** The host's handler of Connect GitHub, which names the page this procedure opens. */
  acts: Pick<HostActTable<typeof TASKS_ACTS>, "GITHUB_CONNECT">;
  /** A transcript's fenced block colored as its fence's language, by the highlighter the File tab's lines are colored with. */
  colorCode: (language: string, code: string) => Effect.Effect<CodeLines>;
  /** Opens an address in the browser; `github.open`'s schema admits GitHub's addresses alone, `web.open`'s any http or https one. */
  openExternal: (url: string) => Promise<void>;
  /** The hosted service's origin, without a trailing slash, the only origin a page the host names may open on. */
  serviceBaseUrl: string;
}

/** The refusal a window that draws no Tasks tab hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

/** Whether an address the host answered parses and stands on the service's own origin. */
function isServicePage(url: string, serviceBaseUrl: string): boolean {
  return URL.canParse(url) && new URL(url).origin === new URL(serviceBaseUrl).origin;
}

/**
 * The admin dashboard's page on the service's own origin, or nothing where
 * that origin is no http or https one, which the browser alone would open.
 */
function adminPage(serviceBaseUrl: string): string | undefined {
  if (!URL.canParse(ADMIN_PAGE_PATH, serviceBaseUrl)) return undefined;
  const page = new URL(ADMIN_PAGE_PATH, serviceBaseUrl).href;
  return isWebAddress(page) && isServicePage(page, serviceBaseUrl) ? page : undefined;
}

export function tasksProcedures(dependencies: TasksProceduresDependencies) {
  const { acts, openExternal } = dependencies;
  return {
    // The address is GitHub's by the act's own schema, so what opens is a
    // repository's page or the App's installation page and nothing else.
    [TASKS_ACT_KIND.GITHUB_OPEN]: actPort[TASKS_ACT_KIND.GITHUB_OPEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* Effect.tryPromise({
        try: () => openExternal(input.url),
        catch: () => errors.REFUSED(),
      });
    }),
    // The address is an http or https one by the act's own schema, so it
    // opens in the browser and never in a file's or another app's handler.
    [TASKS_ACT_KIND.WEB_OPEN]: actPort[TASKS_ACT_KIND.WEB_OPEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* Effect.tryPromise({
        try: () => openExternal(input.url),
        catch: () => errors.REFUSED(),
      });
    }),
    // The address of the page is the service's own, named by the host and
    // never one a window handed in, so the act carries none. Note that a
    // page off the service's own origin is refused, because the answer is
    // any string and the opener would hand a `file:` or custom-scheme
    // address to whatever handles it.
    [TASKS_ACT_KIND.GITHUB_CONNECT]: actPort[TASKS_ACT_KIND.GITHUB_CONNECT].effect(function* ({
      errors,
    }) {
      // Note that the contract marks the act the panel's alone (`contract/tasks.ts`), so any other window was refused before this body runs.
      const page = yield* declaredAnswer(TASKS_ACTS.GITHUB_CONNECT, acts.GITHUB_CONNECT, undefined);
      if (!("url" in page) || !isServicePage(page.url, dependencies.serviceBaseUrl)) {
        return yield* Effect.fail(errors.REFUSED());
      }
      const { url } = page;
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    // The admin dashboard opens where the browser's own session is, rather
    // than in a Browser tab, whose cookies are its own. The act carries no
    // address: the host names the page on the service's origin.
    [TASKS_ACT_KIND.ADMIN_OPEN]: actPort[TASKS_ACT_KIND.ADMIN_OPEN].effect(function* ({
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      const url = adminPage(dependencies.serviceBaseUrl);
      if (url === undefined) return yield* Effect.fail(errors.REFUSED());
      yield* Effect.tryPromise({ try: () => openExternal(url), catch: () => errors.REFUSED() });
    }),
    [TASKS_ACT_KIND.TASKS_COLOR_CODE]: actPort[TASKS_ACT_KIND.TASKS_COLOR_CODE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* dependencies.colorCode(input.language, input.code);
    }),
  };
}
