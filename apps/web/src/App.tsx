import { PROVIDER_ID } from "@sidecar/core";
import { NotchMock } from "./NotchMock";
import { ProviderMark } from "./provider-marks";
import { DMG_URL, GitHubMark, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

const OBSERVED_PROVIDERS = [
  { id: PROVIDER_ID.CLAUDE_CODE, label: "Claude Code" },
  { id: PROVIDER_ID.CODEX, label: "Codex" },
  { id: PROVIDER_ID.CONDUCTOR, label: "Conductor" },
  { id: PROVIDER_ID.CURSOR, label: "Cursor" },
  { id: PROVIDER_ID.DEVIN, label: "Devin" },
] as const;

export function App(): React.JSX.Element {
  return (
    <div className="landing-page">
      <div className="rules" aria-hidden="true">
        <div className="rules-column" />
      </div>
      <SiteHeader />

      <main className="shell">
        <section className="hero">
          <h1>Your AI Engineering Manager.</h1>
          <p className="hero-subhead">
            Luke watches your coding agent sessions and notifies you when they need your attention.
          </p>
          <div className="cta-row">
            <a className="cta-primary" href={DMG_URL}>
              Download for macOS
            </a>
            <a className="cta-secondary" href={REPOSITORY_URL}>
              <GitHubMark />
              View on GitHub
            </a>
          </div>
          <p className="cta-caption">macOS 14+ · Apple silicon</p>

          <NotchMock />

          <section className="providers hairline" aria-labelledby="providers-title">
            <h2 id="providers-title">Your agents, one place.</h2>
            <p>Luke observes the tools you already use.</p>
            <ul className="provider-list">
              {OBSERVED_PROVIDERS.map((provider) => (
                <li key={provider.id}>
                  <ProviderMark providerId={provider.id} />
                  <span>{provider.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
