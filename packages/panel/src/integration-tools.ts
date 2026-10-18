import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@luke/features/integration-view";
import { integrationConnectionOf } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useRef, useState } from "react";
import { useAct } from "./act.js";

/**
 * integration-tools.ts -- what each connected integration's server answered when asked for its tools, read for as long as a surface that draws it is drawn.
 *
 * A provider's tools are read as soon as it stands connected, and again
 * whenever the window is focused, which is how the developer comes back
 * from mending a connection in the browser; never polled otherwise. The
 * service holds a list it read for a few minutes, so a read again costs a
 * working server nothing, and holds no refusal, so a mended one reads as
 * mended. Each read stands until the next one answers, so a surface does
 * not blink back to checking, and an answer to an older ask never lands over
 * a newer one; a provider that stops standing connected forgets its read.
 * What a read means for the row is
 * `integration-health.ts`'s to say.
 */

/** What each server's tools read answered so far, by its name; a server absent here has not answered yet. */
export type IntegrationToolsReads = Readonly<Record<string, IntegrationToolsView>>;

const UNANSWERED: IntegrationToolsView = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

/** The tools read of every server in `connected` (an account by its connection name, or a provider), asked once per focus of the window while the caller is drawn. */
export function useIntegrationTools(connected: readonly string[]): IntegrationToolsReads {
  const { act } = useAct();
  const [reads, setReads] = useState<IntegrationToolsReads>({});
  const [focus, setFocus] = useState(0);
  // The focus each server was last asked under, so each is asked once per focus.
  const asked = useRef(new Map<string, number>());
  // Each server's newest ask, so an answer to an older one never lands over it.
  const newest = useRef(new Map<string, number>());
  const asks = useRef(0);

  useEffect(() => {
    const focused = () => setFocus((count) => count + 1);
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, []);

  useEffect(() => {
    // A provider no longer connected forgets its read, so a grant made later is never drawn with the old one's answer.
    for (const server of asked.current.keys()) {
      if (connected.includes(server)) continue;
      asked.current.delete(server);
      newest.current.delete(server);
      setReads((read) => {
        const kept = { ...read };
        delete kept[server];
        return kept;
      });
    }
    for (const server of connected) {
      const provider = integrationConnectionOf(server)?.provider;
      if (provider === undefined || asked.current.get(server) === focus) continue;
      asked.current.set(server, focus);
      asks.current += 1;
      const ask = asks.current;
      newest.current.set(server, ask);
      const land = (answer: IntegrationToolsView) => {
        if (newest.current.get(server) !== ask) return;
        setReads((read) => ({ ...read, [server]: answer }));
      };
      act(ACT_KIND.INTEGRATIONS_TOOLS, {
        provider,
        ...(server === provider ? undefined : { connection: server }),
      }).then(land, () => land(UNANSWERED));
    }
  });

  return reads;
}
