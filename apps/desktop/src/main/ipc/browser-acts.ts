import { ActRefused, type ActRows, type ActSender } from "@luke/host/act-router";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { WebContents } from "electron";
import type { BrowserViews } from "../window/browser-views";

/**
 * browser-acts.ts -- the Browser tab's acts as main carries them: each handed to the panel's views, from a panel alone and only while the experiment is on.
 *
 * A Browser tab is drawn in a panel and behind Settings › Experimental, so
 * an act from any other window, or from a panel while the account has the
 * experiment off, is refused in its kind's own words before it reaches a
 * view, and so is one naming a view the asking panel never opened: the ids
 * are each panel's own, so one panel's tab can reach no other's page.
 */

type BrowserActKind =
  | typeof ACT_KIND.BROWSER_OPEN
  | typeof ACT_KIND.BROWSER_NAVIGATE
  | typeof ACT_KIND.BROWSER_STEP
  | typeof ACT_KIND.BROWSER_PLACE
  | typeof ACT_KIND.BROWSER_CAPTURE
  | typeof ACT_KIND.BROWSER_CLOSE;

export interface BrowserActsDependencies {
  views: BrowserViews;
  /** Whether the account has the Browser tab experiment on now. */
  experimentOn: () => boolean;
}

export function browserActRows(
  dependencies: BrowserActsDependencies,
): Pick<ActRows<WebContents>, BrowserActKind> {
  const { views, experimentOn } = dependencies;
  /** The asking panel's contents, or the kind's own refusal where it is no panel or the experiment is off. */
  const panelOf = (kind: BrowserActKind, sender: ActSender<WebContents>) => {
    if (!sender.panel || !experimentOn()) throw new ActRefused({ message: ACT[kind].refusal });
    return sender.sender;
  };
  /** The kind's own refusal where the panel holds no view by that id. */
  const held = (kind: BrowserActKind, found: boolean) => {
    if (!found) throw new ActRefused({ message: ACT[kind].refusal });
  };
  return {
    [ACT_KIND.BROWSER_OPEN]: ({ browserId, address }, sender) => {
      const page = views.open(panelOf(ACT_KIND.BROWSER_OPEN, sender), browserId, address);
      if (page === undefined) throw new ActRefused({ message: ACT[ACT_KIND.BROWSER_OPEN].refusal });
      return page;
    },
    [ACT_KIND.BROWSER_NAVIGATE]: ({ browserId, address }, sender) => {
      const contents = panelOf(ACT_KIND.BROWSER_NAVIGATE, sender);
      held(ACT_KIND.BROWSER_NAVIGATE, views.navigate(contents, browserId, address));
    },
    [ACT_KIND.BROWSER_STEP]: ({ browserId, step }, sender) => {
      const contents = panelOf(ACT_KIND.BROWSER_STEP, sender);
      held(ACT_KIND.BROWSER_STEP, views.step(contents, browserId, step));
    },
    [ACT_KIND.BROWSER_PLACE]: ({ browserId, bounds }, sender) => {
      const contents = panelOf(ACT_KIND.BROWSER_PLACE, sender);
      held(ACT_KIND.BROWSER_PLACE, views.place(contents, browserId, bounds));
    },
    [ACT_KIND.BROWSER_CAPTURE]: ({ browserId }, sender) =>
      views.capture(panelOf(ACT_KIND.BROWSER_CAPTURE, sender), browserId),
    // Note that a close is answered even with the experiment off, because a
    // tab closed as it was turned off must not leave its page standing.
    [ACT_KIND.BROWSER_CLOSE]: ({ browserId }, sender) => {
      if (!sender.panel) throw new ActRefused({ message: ACT[ACT_KIND.BROWSER_CLOSE].refusal });
      views.close(sender.sender, browserId);
    },
  };
}
