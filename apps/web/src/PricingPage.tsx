import { DMG_URL, GitHubMark, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

const SECTION_HEADING =
  "m-0 mt-12 mb-4 text-[1.125rem] font-semibold tracking-[-0.01em] first:mt-0";
const BODY = "m-0 mb-4 text-pretty text-muted-foreground";

/**
 * What Luke costs, linked from the header and footer. The page stays
 * qualitative on purpose: the allowance's exact ceilings are product knobs in
 * `server/hosted/quota.ts`, and a number pasted here would drift from them.
 */
export function PricingPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell max-w-[640px] pt-12 pb-16">
        <h1 className="m-0 mb-6 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
          Pricing
        </h1>
        <p className={BODY}>
          Luke is free and open source, licensed Apache-2.0. Download it, read it, change it.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground no-underline transition-[filter,transform] duration-150 hover:brightness-95 active:translate-y-px motion-reduce:transition-none"
            href={DMG_URL}
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

        <h2 className={SECTION_HEADING}>Included daily allowance</h2>
        <p className={BODY}>
          Luke's voice runs on an included daily allowance. Talking to Luke and his session checks
          each draw from it, and it resets every day. No card and no API key to start.
        </p>

        <h2 className={SECTION_HEADING}>Your own OpenAI key</h2>
        <p className={BODY}>
          If you outgrow the allowance, add your own OpenAI API key in Settings. Usage is then
          billed directly to your OpenAI account, at OpenAI's prices — Luke takes nothing on top.
        </p>

        <h2 className={SECTION_HEADING}>Watching local agents</h2>
        <p className={BODY}>
          Local agents are detected automatically and watching them costs nothing: no allowance, no
          key. The allowance only covers the voice that talks back.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
