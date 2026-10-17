import {
  INTEGRATION_LANDING,
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_NAME,
  type IntegrationLandingStatus,
  type IntegrationProvider,
  integrationLandingStatusFromWire,
  integrationProviderFromWire,
} from "@luke/features/integration-wire";
import { ProviderMark } from "@luke/ui";
import { AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "@luke/ui/auth-surface";
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

function IntegrationConnected(): React.JSX.Element {
  const [landing] = useState(landingFromAddress);
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="landing-title">
        {landing.provider === undefined ? (
          <div className="inline-flex w-13" aria-hidden="true">
            <LukeMark className="h-auto w-full" />
          </div>
        ) : (
          <div className="mb-5">
            <ConnectionGraphic
              mark={<ProviderMark provider={landing.provider} className="size-10 shrink-0" />}
            />
          </div>
        )}
        <h1 id="landing-title" className={AUTH_TITLE}>
          {titleOf(landing)}
        </h1>
        <p className="m-0 text-muted-foreground">
          {landing.status === INTEGRATION_LANDING_STATUS.CONNECTED
            ? BACK_TO_LUKE.SETTLED
            : BACK_TO_LUKE.RETRY}
        </p>
      </section>
    </main>
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
