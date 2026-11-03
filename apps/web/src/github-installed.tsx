import {
  GITHUB_INSTALL_LANDING,
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallStatusFromWire,
} from "@repo/features";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { GITHUB_INSTALL_OUTCOME, LANDING_TONE, landingWords } from "@repo/features/landing-outcome";
import { AuthMark, AuthPage, MARK_PROVIDER } from "@repo/ui";
import { useState } from "react";
import { startSiteAnalytics } from "./analytics";
import { landingDescription, useConnectReturn } from "./connect-return";
import "./styles.css";
import { mountPrerenderedPage } from "./mount-page";

/**
 * Where GitHub leaves a developer once our GitHub App is installed, by
 * way of the service's Setup URL route, which confirmed the installation and
 * put one word of status on this page's address. Every string is fixed by
 * the build, worded once for every landing (`@repo/features/landing-outcome`):
 * the status chooses an outcome, and nothing the address carried is drawn.
 * The way back is the Open link (`connect-return.ts`).
 */

function statusFromAddress(): GitHubInstallStatus {
  return (
    githubInstallStatusFromWire(
      new URLSearchParams(window.location.search).get(GITHUB_INSTALL_LANDING.STATUS_PARAM),
    ) ?? GITHUB_INSTALL_STATUS.NOT_FOUND
  );
}

/**
 * The page opens on GitHub's mark, badged with how the installation ended:
 * the title says what happened, the description what to do next, and the
 * Open link goes back.
 */
function GitHubInstalled(): React.JSX.Element {
  const [status] = useState(statusFromAddress);
  const words = landingWords(
    GITHUB_INSTALL_OUTCOME[status],
    INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB],
  );
  const { back, open } = useConnectReturn({
    landed: true,
    settled: words.tone === LANDING_TONE.COMPLETE,
  });
  return (
    <AuthPage
      mark={<AuthMark provider={MARK_PROVIDER.GITHUB} tone={words.tone} />}
      title={words.title}
      description={landingDescription(words, back)}
      action={open}
    />
  );
}

startSiteAnalytics();

mountPrerenderedPage(<GitHubInstalled />);
