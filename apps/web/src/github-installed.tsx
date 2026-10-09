import {
  GITHUB_INSTALL_LANDING,
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallStatusFromWire,
} from "@sidecar/hosted";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubMark } from "./account-marks";
import { startSiteAnalytics } from "./analytics";
import { AUTH_CARD, AUTH_PILL, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
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
    body: "Return to Luke and choose a repository for your plan. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.UPDATED]: {
    badge: "Updated",
    settled: true,
    title: "Luke's repositories were updated",
    body: "Return to Luke to see the change. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.REQUESTED]: {
    badge: "Requested",
    settled: true,
    title: "Your request went to the organization's owner",
    body: "Once an owner installs Luke, its repositories appear in Luke. You can close this tab.",
  },
  [GITHUB_INSTALL_STATUS.NOT_FOUND]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not confirm the installation",
    body: "Return to Luke and start the install again from a plan.",
  },
  [GITHUB_INSTALL_STATUS.UNAVAILABLE]: {
    badge: "Not completed",
    settled: false,
    title: "Luke could not reach GitHub",
    body: "Return to Luke and try again in a moment.",
  },
} as const satisfies Readonly<Record<GitHubInstallStatus, LandingCard>>;

function statusFromAddress(): GitHubInstallStatus {
  return (
    githubInstallStatusFromWire(
      new URLSearchParams(window.location.search).get(GITHUB_INSTALL_LANDING.STATUS_PARAM),
    ) ?? GITHUB_INSTALL_STATUS.NOT_FOUND
  );
}

function ArrowMark(): React.JSX.Element {
  return (
    <svg
      className="size-6 shrink-0 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
        <div
          className="mx-auto mb-5 flex items-center justify-center gap-4 text-foreground"
          aria-hidden="true"
        >
          <GitHubMark className="size-10 shrink-0" />
          <ArrowMark />
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
    <GitHubInstalled />
  </StrictMode>,
);
