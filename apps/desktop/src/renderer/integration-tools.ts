import type { IntegrationToolsView } from "@sidecar/hosted/integration-view";
import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";

/**
 * integration-tools.ts -- the tools each connected integration's server offers, read for as long as a surface that lists them is drawn.
 *
 * A provider's tools are read once each time the surface is drawn, as soon
 * as it stands connected, and never polled: the service holds what it read
 * for a few minutes, so a popover opened again costs the server nothing. A
 * read that answered no list leaves that provider with none, which is drawn
 * as no count at all rather than an error.
 */

/** One tool as a list draws it. */
export interface IntegrationTool {
  readonly name: string;
  readonly description: string;
}

/** The tools of each provider read so far; a provider absent here has not answered yet, or answered none. */
export type IntegrationToolsByProvider = Partial<
  Record<IntegrationProvider, readonly IntegrationTool[]>
>;

/** The tools of every provider in `connected`, read once each while the caller is drawn. */
export function useIntegrationTools(
  connected: readonly IntegrationProvider[],
): IntegrationToolsByProvider {
  const { act } = useAct();
  const [tools, setTools] = useState<IntegrationToolsByProvider>({});
  const asked = useRef(new Set<IntegrationProvider>());

  // Each provider is asked the first render it stands connected, and only then.
  useEffect(() => {
    for (const provider of connected) {
      if (asked.current.has(provider)) continue;
      asked.current.add(provider);
      act(ACT_KIND.INTEGRATIONS_TOOLS, { provider }).then(
        (answer: IntegrationToolsView) => {
          if ("failure" in answer) return;
          setTools((read) => ({ ...read, [provider]: answer.tools }));
        },
        () => undefined,
      );
    }
  });

  return tools;
}
