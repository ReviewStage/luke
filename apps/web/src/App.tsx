import {
  SESSION_URGENCY,
  type SessionUrgency,
  URGENCY_PRIORITY,
  urgencyLabel,
} from "@sidecar/surface";
import { AGENT_COUNT, AgentWall } from "./AgentWall";
import { captureSiteEvent, SITE_EVENT } from "./analytics";
import { NotchMock } from "./NotchMock";
import {
  DMG_URL,
  GitHubMark,
  LukeMark,
  REPOSITORY_URL,
  SiteFooter,
  SiteHeader,
} from "./SiteChrome";

/**
 * The landing page. It answers three questions in order — what Luke is, what
 * he does with the agents already running, and what he will never do to them —
 * and every fact on it is either the product's own catalog, read at build
 * time, or a sentence the trust constraints in CLAUDE.md already fix. Nothing
 * here may promise a capability the app does not ship.
 */

const PRIMARY_BUTTON =
  "inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground no-underline transition-[filter,transform] duration-150 hover:brightness-95 active:translate-y-px motion-reduce:transition-none";

const GHOST_BUTTON =
  "inline-flex items-center gap-2 rounded-md border border-border px-[23px] py-[11px] text-sm font-semibold text-muted-foreground no-underline transition-colors duration-150 hover:border-muted-foreground hover:text-foreground motion-reduce:transition-none";

/** Mono, uppercase, letterspaced: the page's label voice, above every section. */
const KICKER = "m-0 font-mono text-xs uppercase tracking-[0.18em] text-accent-ink";

const SECTION_TITLE =
  "mt-4 mb-0 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-pretty max-[576px]:text-[1.625rem]";

/** A keycap rather than a code span: the app's own shortcuts are keys. */
function Key({ children }: { readonly children: string }): React.JSX.Element {
  return (
    <kbd className="inline-block rounded-[5px] border border-border border-b-2 bg-card px-[0.4em] py-[0.1em] align-[0.1em] font-mono text-[0.8em] leading-none text-foreground">
      {children}
    </kbd>
  );
}

function DownloadButton({
  className = PRIMARY_BUTTON,
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <a
      className={className}
      href={DMG_URL}
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download for macOS
    </a>
  );
}

/**
 * The colour each state is drawn in, keyed by the product's own urgency
 * vocabulary so a state added to the surface cannot quietly go unlabelled
 * here. Working takes the accent because that is the colour the panel gives
 * it; idle is the muted ink, which is what a row nobody is waiting on gets.
 */
const URGENCY_DOT = {
  [SESSION_URGENCY.WORKING]: "bg-primary",
  [SESSION_URGENCY.ATTENTION]: "bg-attention",
  [SESSION_URGENCY.COMPLETE]: "bg-complete",
  [SESSION_URGENCY.UNKNOWN]: "bg-muted-foreground",
} as const satisfies Readonly<Record<SessionUrgency, string>>;

/** The four facts worth stating as values rather than as sentences. */
const SPECS = [
  { value: `${AGENT_COUNT}`, label: "agents watched, local and cloud" },
  { value: "0", label: "config files for you to edit" },
  { value: "⌥Space", label: "to talk to Luke from any app" },
  { value: "Apache-2.0", label: "open source, on GitHub" },
] as const;

/**
 * What the product does, in the order it happens: it finds the work, it tells
 * you about it, and only then does it take an instruction.
 */
const STEPS = [
  {
    index: "01",
    title: "Finds the agents already running",
    body: (
      <>
        Luke reads the sessions your agents keep on this machine — Claude Code, Codex, Cursor,
        Gemini CLI, OpenCode, Antigravity and the rest — the moment they start. Nothing to wrap, no
        MCP server to stand up, no flag to remember. Cloud agents join the same list once you hand
        over a key.
      </>
    ),
    footnote: "Read-only, and keyless for everything on this Mac.",
  },
  {
    index: "02",
    title: "Tells you which one needs you",
    body: (
      <>
        The capsule under the notch carries the count: how many are working, how many are stopped
        waiting on you. Luke says it out loud when a session starts waiting, hits an error, or
        finishes, and a notice under the housing names the session while he speaks. Connect a
        calendar and he holds it until your meeting is over.
      </>
    ),
    footnote: "Every row shows its title, branch, model, current tool, and last recap.",
  },
  {
    index: "03",
    title: "Answers back, and acts when you ask",
    body: (
      <>
        Hold <Key>⌥</Key>
        <Key>Space</Key> from any app to talk to Luke, or press <Key>⌥</Key>
        <Key>L</Key> to type instead. Ask what is running. Have him read a session's transcript back
        to you, send a message to an agent that is waiting, or start a fresh one in a new workspace.
      </>
    ),
    footnote: "He only ever acts inside a turn you opened yourself.",
  },
] as const;

/**
 * The constraints, stated as the product's specification rather than as
 * reassurance. Each line is one of the trust constraints Luke is built under,
 * which is why they are worded as things he cannot do rather than things he
 * promises not to.
 */
const GUARANTEES = [
  {
    term: "read-only",
    body: "Luke never writes to a transcript or a session file. Reading them is the entire job.",
  },
  {
    term: "no keystrokes",
    body: "He never types into your terminal, never simulates a keypress, and never asks for Accessibility.",
  },
  {
    term: "your keys",
    body: "Cloud agents use keys you supply, stored encrypted on your Mac. Local agents need none, and every other provider keeps working without them.",
  },
  {
    term: "off the machine",
    body: "What a provider wrote about a session can leave to decide whether to interrupt you and to be said out loud. The transcript behind it never does.",
  },
] as const;

const INSTALL_STEPS = [
  "Download Luke.dmg",
  "Drag Luke into Applications",
  "Launch it and sign in with Google or GitHub",
] as const;

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen">
      <SiteHeader wide />

      <main>
        {/* Hero. The copy runs left, the way a page of prose does. The mock
            does not: a notch belongs at the horizontal center of a display, so
            the art centers itself inside the column the copy is aligned
            against. */}
        <section className="relative border-b border-border">
          <span className="grid-field pointer-events-none absolute inset-0" aria-hidden="true" />
          <span
            className="accent-aura pointer-events-none absolute inset-x-0 top-0 h-[760px]"
            aria-hidden="true"
          />
          {/* The column's own edges, drawn. The copy is set against a margin
              rather than floating in the middle of the viewport, and the two
              rules are what say where that margin is. */}
          <span
            className="pointer-events-none absolute inset-y-0 left-1/2 w-full max-w-[1080px] -translate-x-1/2 border-x border-border"
            aria-hidden="true"
          />

          <div className="shell-wide relative pt-20 pb-16 max-[520px]:pt-12">
            <p className="m-0 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              Watching {AGENT_COUNT} agents, local and cloud
            </p>

            {/* Fluid between two fixed ends: the line has to hold at a phone's
                measure without shrinking the poster on a desktop. */}
            <h1 className="mt-6 mb-0 max-w-[15ch] text-[clamp(2.25rem,6.5vw,4rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
              Your AI engineering manager.
            </h1>
            <p className="mt-6 mb-0 max-w-[38rem] text-lg text-pretty text-muted-foreground">
              Luke sits in your Mac's notch and watches every coding agent you have running. One
              glance says how many are working and which one is stopped, waiting on you. He speaks
              up the moment that changes — and you can talk back.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <DownloadButton />
              <a className={GHOST_BUTTON} href={REPOSITORY_URL}>
                <GitHubMark />
                View on GitHub
              </a>
            </div>

            {/* A requirement, not a sentence: mono is what the page reserves
                for technical tokens. */}
            <p className="mt-3 mb-0 font-mono text-xs text-muted-foreground">
              macOS 14+ · Apple silicon · free and open source
            </p>

            <NotchMock />

            {/* The legend decodes the art above it: the four states a row can
                be in, named and coloured as the product names and colours
                them, in the order the panel sorts them. */}
            <ul className="mt-6 mb-0 flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-2 p-0">
              {URGENCY_PRIORITY.map((urgency) => (
                <li className="flex items-center gap-2 font-mono text-xs" key={urgency}>
                  <span
                    className={`size-1.5 rounded-full ${URGENCY_DOT[urgency]}`}
                    aria-hidden="true"
                  />
                  {urgencyLabel(urgency)}
                </li>
              ))}
            </ul>

            <p className="mt-3 mb-0 text-center font-mono text-xs text-muted-foreground">
              Not a screenshot. Luke's own surface, drawn from the source the app ships.
            </p>
          </div>
        </section>

        <section className="shell-wide py-12">
          <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border max-[900px]:grid-cols-2">
            {SPECS.map((spec) => (
              <div className="bg-background px-5 py-5" key={spec.label}>
                <dt className="font-mono text-xl font-medium tracking-[-0.02em] text-accent-ink">
                  {spec.value}
                </dt>
                <dd className="m-0 mt-1 text-sm text-pretty text-muted-foreground">{spec.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="shell-wide pt-12 pb-20">
          <p className={KICKER}>What it does</p>
          <h2 className={SECTION_TITLE}>Three things, in this order.</h2>

          <div className="mt-10 grid grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            {STEPS.map((step) => (
              <article
                className="flex flex-col rounded-xl border border-border bg-card p-6"
                key={step.index}
              >
                <span className="font-mono text-xs text-accent-ink">{step.index}</span>
                <h3 className="mt-3 mb-0 text-base font-semibold tracking-[-0.01em]">
                  {step.title}
                </h3>
                <p className="mt-3 mb-0 text-sm/6 text-pretty text-muted-foreground">{step.body}</p>
                {/* Pushed to the floor rather than trailing its own paragraph,
                    so three bodies of different lengths still rule off level. */}
                <p className="mt-auto mb-0 border-t border-border pt-4 font-mono text-[0.6875rem] text-pretty text-muted-foreground">
                  {step.footnote}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="shell-wide hairline pt-20 pb-20">
          <p className={KICKER}>Supported agents</p>
          <h2 className={SECTION_TITLE}>Works with what you already run.</h2>
          <p className="mt-4 mb-0 max-w-[38rem] text-pretty text-muted-foreground">
            Local agents are detected automatically. Cloud agents appear beside them once you
            connect the ones you use.
          </p>

          <div className="mt-10">
            <AgentWall />
          </div>
        </section>

        <section className="shell-wide hairline pt-20 pb-20">
          <p className={KICKER}>Constraints</p>
          <h2 className={SECTION_TITLE}>A sidecar, not the driver's seat.</h2>
          <p className="mt-4 mb-0 max-w-[38rem] text-pretty text-muted-foreground">
            Luke observes work he did not start and cannot interfere with. These are not settings to
            switch off — they are how the app is built.
          </p>

          {/* A specification sheet, so each row's rule has to run the full
              measure: the term and its body carry their own halves of it and
              meet, which a column gap between them would break. */}
          <dl className="mt-10 mb-0 grid grid-cols-[minmax(0,12rem)_1fr] max-[640px]:grid-cols-1">
            {GUARANTEES.map((guarantee) => (
              <div className="contents" key={guarantee.term}>
                <dt className="border-t border-border py-5 pr-8 font-mono text-sm text-accent-ink max-[640px]:pb-0">
                  {guarantee.term}
                </dt>
                <dd className="m-0 border-t border-border py-5 text-pretty text-muted-foreground max-[640px]:border-t-0 max-[640px]:pt-2">
                  {guarantee.body}
                </dd>
              </div>
            ))}
          </dl>

          <a
            className="mt-8 inline-flex font-mono text-sm text-accent-ink no-underline hover:underline"
            href="/privacy"
          >
            Read what does leave, and when →
          </a>
        </section>

        <section className="shell-wide hairline pt-20 pb-20">
          <div className="grid grid-cols-2 items-start gap-12 max-[900px]:grid-cols-1 max-[900px]:gap-10">
            <div>
              <p className={KICKER}>Install</p>
              <h2 className={SECTION_TITLE}>Three steps, no terminal.</h2>
              <p className="mt-4 mb-0 max-w-[34rem] text-pretty text-muted-foreground">
                Then, if you want them, Settings connects your cloud agents, Apple or Google
                Calendar, Linear, and your own OpenAI key.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <DownloadButton />
              </div>
              <p className="mt-3 mb-0 font-mono text-xs text-muted-foreground">
                macOS 14+ · Apple silicon
              </p>
            </div>

            <ol className="m-0 list-none rounded-xl border border-border bg-card p-2">
              {INSTALL_STEPS.map((step, index) => (
                <li
                  className="flex items-center gap-4 border-t border-border px-4 py-4 first:border-t-0"
                  key={step}
                >
                  <span className="font-mono text-xs text-muted-foreground">{`0${index + 1}`}</span>
                  <span className="text-sm text-pretty">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="relative border-t border-border">
          <span
            className="accent-aura pointer-events-none absolute inset-x-0 bottom-0 h-[420px]"
            aria-hidden="true"
          />
          <div className="shell-wide relative flex flex-col items-center py-24 text-center">
            <LukeMark className="block h-9 w-10 text-foreground" />
            <h2 className="mt-6 mb-0 max-w-[20ch] text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-balance max-[576px]:text-[1.625rem]">
              Stop tabbing through terminals to find the one that stopped.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <DownloadButton />
              <a className={GHOST_BUTTON} href={REPOSITORY_URL}>
                <GitHubMark />
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter wide />
    </div>
  );
}
