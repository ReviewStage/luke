import { INTEGRATION_PROVIDER, integrationConnectionOf } from "@repo/features/integration-wire";
import { serverName } from "@repo/ui/agent-servers-model";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import { useIntegrationStatuses } from "../integration-statuses.js";
import type { ToolCallView } from "./tool-call-model.js";

type ConnectionNameOf = (connection: string) => string | undefined;

const ConnectionNamesContext = createContext<ConnectionNameOf | undefined>(undefined);

function ConnectionNamesReading({ children }: { children: ReactNode }): ReactNode {
  const statuses = useIntegrationStatuses();
  const { accountsOf } = statuses;
  const nameOf = useCallback<ConnectionNameOf>(
    (connection) => {
      const held = integrationConnectionOf(connection);
      if (held === undefined) return undefined;
      const { provider, place } = held;
      if (provider === INTEGRATION_PROVIDER.LINEAR && place === 1) return undefined;
      const accounts = accountsOf(provider);
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

export function ConnectionNames({
  needed,
  children,
}: {
  needed: boolean;
  children: ReactNode;
}): ReactNode {
  return needed ? <ConnectionNamesReading>{children}</ConnectionNamesReading> : children;
}

export function useServerName(
  view: Pick<ToolCallView, "server" | "connection">,
): string | undefined {
  const nameOf = useContext(ConnectionNamesContext);
  return (view.connection === undefined ? undefined : nameOf?.(view.connection)) ?? view.server;
}
