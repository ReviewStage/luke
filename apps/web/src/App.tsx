import { NotchMock } from "./NotchMock";
import { GitHubMark, LATEST_DMG_URL, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

export function App(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell">
        <section className="hero">
          <h1>Your AI Engineering Manager.</h1>
          <p className="hero-subhead">
            Luke watches your coding agent sessions and notifies you when they need your attention.
          </p>
          <div className="cta-row">
            <a className="cta-primary" href={LATEST_DMG_URL}>
              Download for macOS
            </a>
            <a className="cta-secondary" href={REPOSITORY_URL}>
              <GitHubMark />
              View on GitHub
            </a>
          </div>
          <p className="cta-fineprint">For Apple Silicon Macs running macOS 14 or later.</p>

          <NotchMock />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
