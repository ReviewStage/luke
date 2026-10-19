/**
 * connect-app-tab.ts -- the web app's tab as a landing page's test meets it: the real connect tabs, one connect handed off to a tab of its own or none, listening on the channel a landing speaks on.
 */

import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import type { AppBridge } from "@luke/host/bridge";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../../src/app/connect-tab";

/** An empty tab the browser opened, which takes any address. */
function emptyTab(): ConnectTab {
  return { closed: false, close: () => undefined, location: { replace: () => undefined } };
}

const BROWSER: ConnectBrowser = {
  openEmptyTab: emptyTab,
  navigate: () => undefined,
  address: () => "/app",
  openLink: () => undefined,
};

/** The app's tab, having handed `connects` connects off to tabs of their own; its close stops it listening. */
export async function appTab(connects: number): Promise<{ readonly close: () => void }> {
  const tabs = connectTabs(BROWSER);
  // SAFETY: the connect wraps the bridge's `act` alone and hands every other door through untouched.
  const host = {
    act: async (_act: Act) => {
      tabs.open("https://provider.example/oauth/authorize");
      return { status: ACT_OUTCOME_STATUS.DONE, value: undefined };
    },
  } as AppBridge;
  const bridge = tabs.bridge(host);
  for (let connect = 0; connect < connects; connect += 1) {
    await bridge.act({ kind: ACT_KIND.GITHUB_CONNECT });
  }
  return { close: tabs.listen() };
}
