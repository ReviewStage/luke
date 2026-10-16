import {
  GITHUB_INSTALL_LANDING,
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallStatusFromWire,
} from "@luke/features";
import { MARK_PROVIDER, ProviderMark } from "@luke/ui";
import { AUTH_CARD, AUTH_PILL, AUTH_SHELL, AUTH_TITLE } from "@luke/ui/auth-surface";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { startSiteAnalytics } from "./analytics";
import { ConnectionGraphic } from "./connection-graphic";
import "./styles.css";

/**
 * Where GitHub leaves a developer once the Luke GitHub App is installed, by
 * way of the service's Setup URL route, which confirmed the installation and
 * put one word of status on this page's address. Every string below is fixed
 * by the build: the status chooses a card, and nothing the address carried
 * is drawn.
 */

interface LandingCard {
  readonly badge: string;
  readonly settled: boolean;
  readonly title: string;
  readonly body: string;
}

const LANDING_CARD = {
  [GITHUB_INSTALL_STATUS.INSTALLED]: {
    badge: "Installed",
    settled: true,
    title: "Luke can see your repositories",
    body: "Return to Luke. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.UPDATED]: {
    badge: "Updated",
    settled: true,
    title: "Luke's repositories were updated",
    body: "Return to Luke. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.REQUESTED]: {
    badge: "Requested",
    settled: true,
    title: "Your request went to the organization's owner",
    body: "You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.NOT_FOUND]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not confirm the installation",
    body: "Return to Luke and choose Connect GitHub again.",
  },
  [GITHUB_INSTALL_STATUS.UNAVAILABLE]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not reach GitHub",
    body: "Return to Luke and try again in a moment.",
  },
  [GITHUB_INSTALL_STATUS.CONNECTED]: {
    badge: "Connected",
    settled: true,
    title: "GitHub is connected to your workspace",
    body: "Its repositories are available to everyone in the workspace. Return to Luke. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.ALREADY_CONNECTED]: {
    badge: "Not connected",
    settled: false,
    title: "That GitHub account is connected to another workspace",
    body: "One GitHub account or organization connects to one workspace. Disconnect it there first, or choose another.",
  },
  [GITHUB_INSTALL_STATUS.EXPIRED]: {
    badge: "Not connected",
    settled: false,
    title: "This connection link has expired",
    body: "Return to Luke and choose Connect GitHub again.",
  },
} as const satisfies Readonly<Record<GitHubInstallStatus, LandingCard>>;

function statusFromAddress(): GitHubInstallStatus {
  return (
    githubInstallStatusFromWire(
      new URLSearchParams(window.location.search).get(GITHUB_INSTALL_LANDING.STATUS_PARAM),
    ) ?? GITHUB_INSTALL_STATUS.NOT_FOUND
  );
}

function GitHubInstalled(): React.JSX.Element {
  const [status] = useState(statusFromAddress);
  const card = LANDING_CARD[status];
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="landing-title">
        {/* The same pairing the sign-in card draws: the provider's mark, an
            arrow, and Luke's own face. */}
        <ConnectionGraphic
          mark={<ProviderMark provider={MARK_PROVIDER.GITHUB} className="size-10 shrink-0" />}
        />
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
    <GitHubInstalled />
  </StrictMode>,
);
