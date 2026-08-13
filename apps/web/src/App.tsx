import { NotchMock } from "./NotchMock";

const REPOSITORY_URL = "https://github.com/ReviewStage/luke";

export function App(): React.JSX.Element {
  return (
    <>
      <header className="shell">
        <nav className="site-nav">
          <span className="wordmark">Luke</span>
          <a className="nav-link" href={REPOSITORY_URL}>
            GitHub
          </a>
        </nav>
      </header>

      <main className="shell">
        <section className="hero">
          <h1>Your AI Engineering Manager.</h1>
          <p className="hero-subhead">
            Luke watches your Claude Code, Codex, and Conductor sessions and notifies you when they
            need your attention.
          </p>
          <div className="cta-row">
            <a className="cta-primary" href={REPOSITORY_URL}>
              View on GitHub
            </a>
          </div>

          <NotchMock />
        </section>
      </main>

      <footer className="site-footer shell">
        <div className="footer-meta">
          <span>
            <a href={REPOSITORY_URL}>GitHub</a>
          </span>
          <span>Apache-2.0</span>
          <span>macOS 14+</span>
        </div>
        <p className="footnote">
          Product names belong to their owners. Luke is independent and unaffiliated.
        </p>
      </footer>
    </>
  );
}
