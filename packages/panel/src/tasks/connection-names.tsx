import { integrationConnectionOf } from "@luke/features/integration-wire";
import { serverName } from "@luke/ui/agent-servers-model";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import { useIntegrationStatuses } from "../integration-statuses.js";
import type { ToolCallView } from "./tool-call-model.js";

/**
 * connection-names.tsx -- the name a call of an MCP server's tool says it ran on, as the server's card names it.
 *
 * A call's own words name a connection by its id (`notion-2`), which says
 * its place among a provider's accounts and nothing of the label the
 * developer gave it. Where the provider holds more than one account the card
 * says "Notion · Work", so a row says it too, from the accounts the window
 * has read (`serverName`). The reading is made once for a transcript that
 * holds such a call, and a call it does not know a name for keeps the one
 * its id gives.
 */

type ConnectionNameOf = (connection: string) => string | undefined;

const ConnectionNamesContext = createContext<ConnectionNameOf | undefined>(undefined);

function ConnectionNamesReading({ children }: { children: ReactNode }): ReactNode {
  const statuses = useIntegrationStatuses();
  const { accountsOf } = statuses;
  const nameOf = useCallback<ConnectionNameOf>(
    (connection) => {
      const provider = integrationConnectionOf(connection)?.provider;
      if (provider === undefined) return undefined;
      const accounts = accountsOf(provider);
      // Note that an account the window does not hold keeps the name its id gives, since a provider's name alone would lose its place.
      return accounts.some((account) => account.connection === connection)
        ? serverName(provider, connection, accounts)
        : undefined;
    },
    [accountsOf],
  );
  return (
    <ConnectionNamesContext.Provider value={nameOf}>{children}</ConnectionNamesContext.Provider>
  );
}

/** Hands every call's row under it the names of the accounts it ran on, read only where `needed`: a transcript with no call of a server's tool reads none. */
export function ConnectionNames({
  needed,
  children,
}: {
  needed: boolean;
  children: ReactNode;
}): ReactNode {
  return needed ? <ConnectionNamesReading>{children}</ConnectionNamesReading> : children;
}

/** The server a call's row says it ran on: its account's name where the window knows it, else the name its id gives; none for a call of no server's tool. */
export function useServerName(
  view: Pick<ToolCallView, "server" | "connection">,
): string | undefined {
  const nameOf = useContext(ConnectionNamesContext);
  return (view.connection === undefined ? undefined : nameOf?.(view.connection)) ?? view.server;
}
