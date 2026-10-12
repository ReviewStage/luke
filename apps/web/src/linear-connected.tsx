import {
  LINEAR_LANDING,
  LINEAR_LANDING_STATUS,
  type LinearLandingStatus,
  linearLandingStatusFromWire,
} from "@sidecar/hosted/linear-wire";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { AUTH_CARD, AUTH_PILL, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
import "./styles.css";

/**
 * Where a developer lands once a Linear sign-in started from Luke's
 * account settings settles, by way of the service's callback route, which
 * settled it with Vercel Connect and put one word of status on this page's
 * address. Every string below is fixed by the build: the status chooses a
 * card, and nothing the address carried is drawn.
 */

interface LandingCard {
  readonly badge: string;
  readonly settled: boolean;
  readonly title: string;
  readonly body: string;
}

const LANDING_CARD = {
  [LINEAR_LANDING_STATUS.CONNECTED]: {
    badge: "Connected",
    settled: true,
    title: "Luke can use your Linear",
    body: "Your planning assistant and coding agents can now read and update Linear for you. You can close this tab.",
  },
  [LINEAR_LANDING_STATUS.NOT_COMPLETED]: {
    badge: "Not connected",
    settled: false,
    title: "Linear was not connected",
    body: "The sign-in did not finish. Return to Luke's account settings to try again.",
  },
  [LINEAR_LANDING_STATUS.EXPIRED]: {
    badge: "Not connected",
    settled: false,
    title: "This sign-in link has expired",
    body: "Return to Luke's account settings and press Connect again.",
  },
  [LINEAR_LANDING_STATUS.UNAVAILABLE]: {
    badge: "Not connected",
    settled: false,
    title: "Luke could not finish connecting Linear",
    body: "Return to Luke and try again in a moment.",
  },
} as const satisfies Readonly<Record<LinearLandingStatus, LandingCard>>;

function statusFromAddress(): LinearLandingStatus {
  return (
    linearLandingStatusFromWire(
      new URLSearchParams(window.location.search).get(LINEAR_LANDING.STATUS_PARAM),
    ) ?? LINEAR_LANDING_STATUS.EXPIRED
  );
}

function LinearConnected(): React.JSX.Element {
  const [status] = useState(statusFromAddress);
  const card = LANDING_CARD[status];
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="landing-title">
        <div
          className="mx-auto mb-5 flex items-center justify-center text-foreground"
          aria-hidden="true"
        >
          <LukeMark className="h-auto w-12 shrink-0" />
        </div>
        <div>
          <span className={AUTH_PILL} data-tone={card.settled ? "settled" : "attention"}>
            {card.badge}
          </span>
        </div>
        <h1 id="landing-title" className={AUTH_TITLE}>
          {card.title}
        </h1>
        <p className="m-0 text-muted-foreground">{card.body}</p>
      </section>
    </main>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <LinearConnected />
  </StrictMode>,
);
