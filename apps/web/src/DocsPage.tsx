import { DMG_URL, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

/** A keyboard shortcut is a technical token, and mono is what the page reserves for those. */
function Key({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
      {children}
    </kbd>
  );
}

const SECTION_HEADING =
  "m-0 mt-12 mb-4 text-[1.125rem] font-semibold tracking-[-0.01em] first:mt-0";
const BODY = "m-0 mb-4 text-pretty text-muted-foreground";
const LIST = "m-0 mb-4 list-disc pl-5 text-muted-foreground [&>li]:mb-2 [&>li:last-child]:mb-0";

/**
 * The agents and platforms Luke watches, kept in step with the README's
 * provider table by hand: the README generates its own from the provider
 * registry, and this page states the same list for someone who never opens
 * the repository.
 */
const SUPPORTED_AGENTS: readonly {
  readonly agent: string;
  readonly local: boolean;
  readonly cloud: boolean;
}[] = [
  { agent: "Claude Code", local: true, cloud: false },
  { agent: "Codex", local: true, cloud: true },
  { agent: "Conductor", local: false, cloud: true },
  { agent: "OMP", local: true, cloud: false },
];

/** How to install, set up, and use Luke: a page of its own, linked from the header and footer. */
export function DocsPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell max-w-[640px] pt-12 pb-16">
        <h1 className="m-0 mb-6 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
          Docs
        </h1>
        <p className={BODY}>
          Luke is an open-source macOS app that watches your coding agent sessions, local and cloud,
          and speaks up when one finishes, errors, or is waiting on you. Everything here is in the{" "}
          <a className="text-accent-ink underline underline-offset-2" href={REPOSITORY_URL}>
            repository
          </a>{" "}
          too, because the repository is where it is maintained.
        </p>

        <h2 className={SECTION_HEADING}>Requirements</h2>
        <p className={BODY}>Luke runs on Apple silicon Macs with macOS 14 or newer.</p>

        <h2 className={SECTION_HEADING}>Install</h2>
        <ol className="m-0 mb-4 list-decimal pl-5 text-muted-foreground [&>li]:mb-2 [&>li:last-child]:mb-0">
          <li>
            <a className="text-accent-ink underline underline-offset-2" href={DMG_URL}>
              Download Luke
            </a>
            .
          </li>
          <li>
            Open the DMG and drag <strong className="text-foreground">Luke</strong> into{" "}
            <strong className="text-foreground">Applications</strong>.
          </li>
          <li>Launch Luke and sign in with Google or GitHub.</li>
        </ol>

        <h2 className={SECTION_HEADING}>Talk to Luke</h2>
        <p className={BODY}>
          Hold <Key>⌥</Key>
          <Key>Space</Key> to talk to Luke from any app, or press <Key>⌥</Key>
          <Key>L</Key> to type to him instead. He can tell you about the status of your agents, kick
          fresh ones off for you, or message them on your behalf.
        </p>
        <p className={BODY}>
          The <strong className="text-foreground">History</strong> tab keeps your conversation on
          your Mac, across launches: the 200 most recent entries and nothing older than a fortnight,
          until you clear it. Only the 20 most recent entries are carried into Luke's next call.
          Luke also keeps a small local memory of useful preferences, personal context, goals, and
          recurring constraints; ask him what he remembers, correct something, or tell him to forget
          it.
        </p>

        <h2 className={SECTION_HEADING}>Announcements</h2>
        <p className={BODY}>
          Luke speaks up when an agent is waiting for you, hits an error, or finishes. He waits five
          seconds for nearby updates and combines them into one announcement. Connect your calendar
          and he stays quiet until your meeting is over.
        </p>

        <h2 className={SECTION_HEADING}>Supported agents and platforms</h2>
        <p className={BODY}>
          Local agents are detected automatically and do not require API keys. Cloud agents are
          connected in Settings with their API keys.
        </p>
        <table className="mb-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-2 pr-4 font-semibold">Agent</th>
              <th className="py-2 pr-4 font-semibold">Local</th>
              <th className="py-2 font-semibold">Cloud</th>
            </tr>
          </thead>
          <tbody>
            {SUPPORTED_AGENTS.map(({ agent, local, cloud }) => (
              <tr key={agent} className="border-b border-border text-muted-foreground">
                <td className="py-2 pr-4 text-foreground">{agent}</td>
                <td className="py-2 pr-4">{local ? "✅" : ""}</td>
                <td className="py-2">{cloud ? "✅" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className={SECTION_HEADING}>Settings</h2>
        <p className={BODY}>
          Open <strong className="text-foreground">Settings</strong> in Luke to:
        </p>
        <ul className={LIST}>
          <li>Connect supported cloud agents with their API keys.</li>
          <li>Connect Apple or Google Calendar.</li>
          <li>Connect Linear.</li>
          <li>Add an OpenAI API key for usage billed directly to your OpenAI account.</li>
          <li>Customize Luke's voice, keyboard shortcuts, appearance, and workspace defaults.</li>
        </ul>

        <h2 className={SECTION_HEADING}>Privacy</h2>
        <p className={BODY}>
          Luke is open source, so every claim about your data is checkable in the repository. The
          policy itself lives on the{" "}
          <a className="text-accent-ink underline underline-offset-2" href="/privacy">
            privacy page
          </a>
          .
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
