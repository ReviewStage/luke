import { SIGN_IN } from "@repo/features/integration-sign-in";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { type NamedServer, namedServers } from "@repo/ui/agent-servers-model";
import { useEffect, useRef } from "react";
import { GRANT_OUTCOME, useIntegrationGrant } from "./integration-grant.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "./integration-statuses.js";
import { useToast, useWithdrawToast } from "./toast.js";

const STANDS = {
  EXPIRED: "expired",
  RECONNECTING: "reconnecting",
  CLEAR: "clear",
} as const;

type Stands = (typeof STANDS)[keyof typeof STANDS];

const SAYS = {
  EXPIRED: "expired",
  BEGINNING: "beginning",
  RECONNECTING: "reconnecting",
  FAILED: "failed",
} as const;

type Says = (typeof SAYS)[keyof typeof SAYS];

const ACTION = {
  RECONNECT: "Reconnect",
  RETRY: "Retry",
} as const;

interface Said {
  readonly server: NamedServer;
  readonly subject: string;
  says: Says;
}

function standsOf(statuses: IntegrationStatuses, connection: string): Stands {
  const status = statuses.statusOf(connection);
  if (statuses.signInOf(connection)?.kind === SIGN_IN.WAITING) return STANDS.RECONNECTING;
  if (status === INTEGRATION_STATUS.PENDING) return STANDS.RECONNECTING;
  return status === INTEGRATION_STATUS.EXPIRED ? STANDS.EXPIRED : STANDS.CLEAR;
}

export function useExpiredServerToasts(): void {
  const statuses = useIntegrationStatuses();
  const grant = useIntegrationGrant(statuses);
  const toast = useToast();
  const withdraw = useWithdrawToast();
  const said = useRef(new Map<string, Said>());
  const dismissed = useRef(new Set<string>());
  const latest = useRef({ grant, toast, withdraw });
  latest.current = { grant, toast, withdraw };

  useEffect(() => {
    const say = (server: NamedServer, says: Says, show: (subject: string) => void) => {
      const was = said.current.get(server.connection);
      if (was !== undefined) latest.current.withdraw(was.subject);
      const subject = crypto.randomUUID();
      said.current.set(server.connection, { server, subject, says });
      show(subject);
    };

    const reconnect = (server: NamedServer) => {
      dismissed.current.delete(server.connection);
      const entry = said.current.get(server.connection);
      if (entry !== undefined) entry.says = SAYS.BEGINNING;
      void latest.current.grant.begin(server.connection).then((outcome) => {
        if (outcome === GRANT_OUTCOME.BEGUN) return;
        say(server, SAYS.FAILED, (subject) =>
          latest.current.toast({
            words:
              outcome === GRANT_OUTCOME.NOT_OPENED
                ? `Your browser could not be opened to reconnect ${server.name}.`
                : `${server.name} could not be reconnected.`,
            tone: STATUS_TONE.DANGER,
            mark: server.provider,
            subject,
            persists: true,
            action: { label: ACTION.RETRY, onPress: () => reconnect(server), replayUnmasked: true },
            onDismiss: () => dismissed.current.add(server.connection),
            failure: {
              surface: FAILURE_SURFACE.INTEGRATION_RECONNECT,
              cause: outcome,
              refused: true,
            },
          }),
        );
      });
    };

    const sayExpired = (server: NamedServer) => {
      if (dismissed.current.has(server.connection)) {
        const was = said.current.get(server.connection);
        if (was !== undefined) latest.current.withdraw(was.subject);
        said.current.set(server.connection, {
          server,
          subject: crypto.randomUUID(),
          says: SAYS.EXPIRED,
        });
        return;
      }
      say(server, SAYS.EXPIRED, (subject) =>
        latest.current.toast({
          words: `${server.name}'s sign-in expired`,
          tone: STATUS_TONE.ATTENTION,
          mark: server.provider,
          subject,
          persists: true,
          action: {
            label: ACTION.RECONNECT,
            onPress: () => reconnect(server),
            replayUnmasked: true,
          },
          onDismiss: () => dismissed.current.add(server.connection),
        }),
      );
    };

    const expired = namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.EXPIRED,
    });
    for (const server of expired) {
      if (said.current.has(server.connection)) continue;
      if (standsOf(statuses, server.connection) === STANDS.EXPIRED) sayExpired(server);
    }
    for (const [connection, entry] of said.current) {
      const stands = standsOf(statuses, connection);
      if (stands === STANDS.CLEAR) {
        latest.current.withdraw(entry.subject);
        said.current.delete(connection);
        dismissed.current.delete(connection);
      } else if (stands === STANDS.RECONNECTING && entry.says !== SAYS.RECONNECTING) {
        say(entry.server, SAYS.RECONNECTING, (subject) =>
          latest.current.toast({
            words: `Reconnecting ${entry.server.name}…`,
            tone: STATUS_TONE.WORKING,
            subject,
          }),
        );
      } else if (stands === STANDS.EXPIRED && entry.says === SAYS.RECONNECTING) {
        sayExpired(entry.server);
      }
    }
  });

  useEffect(
    () => () => {
      for (const entry of said.current.values()) latest.current.withdraw(entry.subject);
      said.current.clear();
    },
    [],
  );
}
