import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@sidecar/hosted/integration-view";
import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";

/**
 * integration-tools.ts -- what each connected integration's server answered when asked for its tools, read for as long as a surface that draws it is drawn.
 *
 * A provider's tools are read as soon as it stands connected, and again
 * whenever the window is focused, which is how the developer comes back
 * from mending a connection in the browser; never polled otherwise. The
 * service holds a list it read for a few minutes, so a read again costs a
 * working server nothing, and holds no refusal, so a mended one reads as
 * mended. Each read stands until the next one answers, so a surface does
 * not blink back to checking. What a read means for the row is
 * `integration-health.ts`'s to say.
 */

/** What each provider's tools read answered so far; a provider absent here has not answered yet. */
export type IntegrationToolsReads = Partial<Record<IntegrationProvider, IntegrationToolsView>>;

const UNANSWERED: IntegrationToolsView = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

/** The tools read of every provider in `connected`, asked once per focus of the window while the caller is drawn. */
export function useIntegrationTools(
  connected: readonly IntegrationProvider[],
): IntegrationToolsReads {
  const { act } = useAct();
  const [reads, setReads] = useState<IntegrationToolsReads>({});
  const [focus, setFocus] = useState(0);
  // The focus each provider was last asked under, so each is asked once per focus.
  const asked = useRef(new Map<IntegrationProvider, number>());

  useEffect(() => {
    const focused = () => setFocus((count) => count + 1);
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, []);

  useEffect(() => {
    for (const provider of connected) {
      if (asked.current.get(provider) === focus) continue;
      asked.current.set(provider, focus);
      act(ACT_KIND.INTEGRATIONS_TOOLS, { provider }).then(
        (answer: IntegrationToolsView) => setReads((read) => ({ ...read, [provider]: answer })),
        () => setReads((read) => ({ ...read, [provider]: UNANSWERED })),
      );
    }
  });

  return reads;
}
