import {
  INTEGRATION_LANDING,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingStatusFromWire,
  integrationProviderFromWire,
} from "@luke/features/integration-wire";
import { AuthPage, PROVIDER_MARK_SIZE, ProviderMark } from "@luke/ui";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { ConnectionGraphic } from "./connection-graphic";
import { LukeMark } from "./SiteChrome";
import "./styles.css";

/**
 * Where a developer lands once a sign-in to an integration, started from
 * Luke's settings, settles, by way of the service's callback route, which
 * settled it with Vercel Connect and put the provider and one word of status
 * on this page's address. It dresses like the page a GitHub sign-in leaves
 * the browser on: one card, the provider's mark beside Luke's, one short line
 * and one shorter one under it. Every string is fixed by the build: the
 * address chooses among them, and nothing it carried is drawn.
 */

interface Landing {
  readonly provider: IntegrationProvider | undefined;
  readonly status: IntegrationLandingStatus;
}

const BACK_TO_LUKE = {
  SETTLED: "Return to Luke. You can close this tab.",
  RETRY: "Return to Luke to try again.",
} as const;

/** The card's one line: the provider's name where the address named one. */
function titleOf({ provider, status }: Landing): string {
  const name = provider === undefined ? undefined : INTEGRATION_NAME[provider];
  switch (status) {
    case INTEGRATION_LANDING_STATUS.CONNECTED:
      return name === undefined ? "Connected" : `${name} connected`;
    case INTEGRATION_LANDING_STATUS.NOT_COMPLETED:
      return name === undefined ? "Not connected" : `${name} not connected`;
    case INTEGRATION_LANDING_STATUS.EXPIRED:
      return "This link has expired";
    case INTEGRATION_LANDING_STATUS.UNAVAILABLE:
      return name === undefined ? "Could not connect" : `Could not connect ${name}`;
  }
}

function landingFromAddress(): Landing {
  const query = new URLSearchParams(window.location.search);
  return {
    provider: integrationProviderFromWire(query.get(INTEGRATION_LANDING.PROVIDER_PARAM)),
    status:
      integrationLandingStatusFromWire(query.get(INTEGRATION_LANDING.STATUS_PARAM)) ??
      INTEGRATION_LANDING_STATUS.EXPIRED,
  };
}

/**
 * The page is one AuthPage card that opens on the provider's mark joined to
 * Luke's, or Luke's full mark alone when the address named no provider: the
 * title says how the connection settled, and the description how to go on.
 */
function IntegrationConnected(): React.JSX.Element {
  const [landing] = useState(landingFromAddress);
  return (
    <AuthPage
      mark={
        landing.provider === undefined ? (
          <span className="inline-flex w-13">
            <LukeMark className="h-auto w-full" />
          </span>
        ) : (
          <ConnectionGraphic
            mark={<ProviderMark provider={landing.provider} size={PROVIDER_MARK_SIZE.TILE} />}
          />
        )
      }
      title={titleOf(landing)}
      description={
        landing.status === INTEGRATION_LANDING_STATUS.CONNECTED
          ? BACK_TO_LUKE.SETTLED
          : BACK_TO_LUKE.RETRY
      }
    />
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <IntegrationConnected />
  </StrictMode>,
);
