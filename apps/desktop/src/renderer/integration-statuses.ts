import {
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";

/**
 * integration-statuses.ts -- where every one of the account's integrations stands, as every surface that draws one reads it.
 *
 * Read once for all of them, when first drawn and again whenever the window
 * is focused, which is how the developer comes back from a sign-in in the
 * browser. Settings › Integrations and the composer's list of servers draw
 * from it alike, so the two never disagree about a provider.
 */

/** Where every provider stands, as the surfaces share it. */
export interface IntegrationStatuses {
  /** Where one provider stands, or nothing until the first read answers. */
  readonly statusOf: (provider: IntegrationProvider) => IntegrationStatus | undefined;
  /** Whether the last read answered nothing a surface can draw. */
  readonly readFailed: boolean;
  readonly read: () => Promise<void>;
  /** One provider's standing as an answer of the host's left it, ahead of the next read. */
  readonly settle: (provider: IntegrationProvider, status: IntegrationStatus) => void;
  /** A sign-in begun: the provider stands pending, unless it stands expired, which it stays until the sign-in settles. */
  readonly signInBegun: (provider: IntegrationProvider) => void;
}

export function useIntegrationStatuses(): IntegrationStatuses {
  const { act } = useAct();
  const [statuses, setStatuses] = useState<
    Partial<Record<IntegrationProvider, IntegrationStatus>> | undefined
  >(undefined);
  const [readFailed, setReadFailed] = useState(false);

  const read = useCallback(() => {
    setReadFailed(false);
    return act(ACT_KIND.INTEGRATIONS_STATUS).then(
      (answer) => {
        if ("failure" in answer) setReadFailed(true);
        else setStatuses(answer.integrations);
      },
      () => setReadFailed(true),
    );
  }, [act]);

  // The focus is the developer back from the browser, where a sign-in settles.
  useEffect(() => {
    void read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  const settle = useCallback((provider: IntegrationProvider, status: IntegrationStatus) => {
    setStatuses((standing) => ({ ...standing, [provider]: status }));
  }, []);

  // Note that the check is made on the standing at the moment of the update, because a focus read may have landed since the press.
  const signInBegun = useCallback((provider: IntegrationProvider) => {
    setStatuses((standing) =>
      standing?.[provider] === INTEGRATION_STATUS.EXPIRED
        ? standing
        : { ...standing, [provider]: INTEGRATION_STATUS.PENDING },
    );
  }, []);

  return { statusOf: (provider) => statuses?.[provider], readFailed, read, settle, signInBegun };
}
