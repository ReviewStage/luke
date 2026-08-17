import { NotchMock } from "./NotchMock";
import { GitHubMark, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

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
            <a className="cta-primary" href={REPOSITORY_URL}>
              <GitHubMark />
              View on GitHub
            </a>
          </div>

          <NotchMock />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
