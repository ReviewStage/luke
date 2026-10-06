import { captureSiteEvent, SITE_EVENT } from "./analytics";
import { DemoVideo } from "./DemoVideo";
import { DMG_URL, GitHubMark, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="shell">
        {/* The copy runs left, the way a page of prose does. The demo is wider
            than the column and centers itself on the page. */}
        {/* The footer's hairline draws itself a space-5 above the footer's own
            box, inside this section's bottom padding, so the padding must keep
            at least that much clearance or the rule lands across the demo. */}
        <section className="pt-12 pb-16 max-[520px]:pt-8 max-[520px]:pb-10">
          {/* Fixed rather than fluid, with one step down: at 2.25rem the line
              needs about 490px, so it steps before the column can squeeze it
              rather than at the column's own padding breakpoint. */}
          <h1 className="m-0 text-[2.25rem] leading-[1.1] font-semibold tracking-[-0.02em] text-pretty max-[576px]:text-[1.75rem]">
            A better way to plan with agents.
          </h1>
          <p className="mt-6 mb-0 max-w-[34rem] text-lg text-pretty text-muted-foreground">
            Talk through a feature with Luke. He reads the code while you talk and writes a plan you
            can paste into Claude Code or Codex.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground no-underline transition-[filter,transform] duration-150 hover:brightness-95 active:translate-y-px motion-reduce:transition-none"
              href={DMG_URL}
              onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
            >
              Download for macOS
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-md border border-border px-[23px] py-[11px] text-sm font-semibold text-muted-foreground no-underline transition-colors duration-150 hover:border-muted-foreground hover:text-foreground motion-reduce:transition-none"
              href={REPOSITORY_URL}
            >
              <GitHubMark />
              View on GitHub
            </a>
          </div>

          {/* A requirement, not a sentence: mono is what the page reserves for
              technical tokens. */}
          <p className="mt-3 mb-0 font-mono text-xs text-muted-foreground">
            macOS 14+ · Apple silicon
          </p>

          <DemoVideo />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
