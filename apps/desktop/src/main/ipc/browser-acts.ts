/**
 * browser-acts.ts -- the Browser tab's acts as main carries them: each handed to the panel's views, from a panel alone and only while the experiment is on.
 *
 * A Browser tab is drawn in a panel and behind Settings › Experimental, so
 * an act from any other window, or from a panel while the account has the
 * experiment off, is refused in its kind's own words before it reaches a
 * view, and so is one naming a view the asking panel never opened: the ids
 * are each panel's own, so one panel's tab can reach no other's page.
 */

import type { ActSender } from "@luke/host/act-port";
import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { BROWSER_ACT_KIND } from "@luke/host/contract";
import { Effect } from "effect";
import type { WebContents } from "electron";
import type { BrowserViews } from "../window/browser-views";

type BrowserActKind = (typeof BROWSER_ACT_KIND)[keyof typeof BROWSER_ACT_KIND];

export interface BrowserActsDependencies {
  views: BrowserViews;
  /** Whether the account has the Browser tab experiment on now. */
  experimentOn: () => boolean;
}

const browserPort = actPortFor<WebContents>();

export function browserProcedures(
  dependencies: BrowserActsDependencies,
): Pick<PlatformActProcedures<WebContents>, BrowserActKind> {
  const { views, experimentOn } = dependencies;
  /** The asking panel's contents, or nothing where it is no panel or the experiment is off. */
  const panelOf = (actor: ActSender<WebContents>): WebContents | undefined =>
    actor.panel && experimentOn() ? actor.sender : undefined;
  return {
    [BROWSER_ACT_KIND.BROWSER_OPEN]: browserPort[BROWSER_ACT_KIND.BROWSER_OPEN].effect(function* ({
      input,
      context,
      errors,
    }) {
      const contents = panelOf(context.actor);
      if (contents === undefined) return yield* Effect.fail(errors.REFUSED());
      const page = views.open(contents, input.browserId, input.address);
      if (page === undefined) return yield* Effect.fail(errors.REFUSED());
      return page;
    }),
    [BROWSER_ACT_KIND.BROWSER_NAVIGATE]: browserPort[BROWSER_ACT_KIND.BROWSER_NAVIGATE].effect(
      function* ({ input, context, errors }) {
        const contents = panelOf(context.actor);
        if (contents === undefined || !views.navigate(contents, input.browserId, input.address)) {
          return yield* Effect.fail(errors.REFUSED());
        }
      },
    ),
    [BROWSER_ACT_KIND.BROWSER_STEP]: browserPort[BROWSER_ACT_KIND.BROWSER_STEP].effect(function* ({
      input,
      context,
      errors,
    }) {
      const contents = panelOf(context.actor);
      if (contents === undefined || !views.step(contents, input.browserId, input.step)) {
        return yield* Effect.fail(errors.REFUSED());
      }
    }),
    [BROWSER_ACT_KIND.BROWSER_PLACE]: browserPort[BROWSER_ACT_KIND.BROWSER_PLACE].effect(
      function* ({ input, context, errors }) {
        const contents = panelOf(context.actor);
        if (contents === undefined || !views.place(contents, input.browserId, input.bounds)) {
          return yield* Effect.fail(errors.REFUSED());
        }
      },
    ),
    [BROWSER_ACT_KIND.BROWSER_CAPTURE]: browserPort[BROWSER_ACT_KIND.BROWSER_CAPTURE].handler(
      async ({ input, context, errors }) => {
        const contents = panelOf(context.actor);
        if (contents === undefined) throw errors.REFUSED();
        return views.capture(contents, input.browserId);
      },
    ),
    // Note that a close is answered even with the experiment off, because a
    // tab closed as it was turned off must not leave its page standing.
    [BROWSER_ACT_KIND.BROWSER_CLOSE]: browserPort[BROWSER_ACT_KIND.BROWSER_CLOSE].effect(
      function* ({ input, context, errors }) {
        if (!context.actor.panel) return yield* Effect.fail(errors.REFUSED());
        views.close(context.actor.sender, input.browserId);
      },
    ),
  };
}
