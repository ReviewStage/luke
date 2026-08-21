import { PROVIDER_ID, SESSION_APPLICATION_ID } from "@sidecar/session";
import { ProviderMark } from "./provider-marks";

/**
 * The landing page's answer to "does it work with mine?": the agents Luke
 * observes and the apps that hold their sessions, each under its own mark.
 *
 * The rosters are `docs/PROVIDERS.md`'s two tables, in that document's order
 * and split the way the product splits them — an agent is a session provider,
 * an app holds agent sessions without becoming their provider. The ids are the
 * product's own constants so a rename or removal breaks this page's build
 * rather than leaving it advertising a provider the app no longer knows; the
 * names are display copy, freeform because each is the brand's own casing.
 */
interface RosterEntry {
  readonly id: string;
  readonly name: string;
}

const AGENTS: readonly RosterEntry[] = [
  { id: PROVIDER_ID.CLAUDE_CODE, name: "Claude Code" },
  { id: PROVIDER_ID.CODEX, name: "Codex" },
  { id: PROVIDER_ID.CONDUCTOR, name: "Conductor" },
  { id: PROVIDER_ID.CURSOR, name: "Cursor" },
  { id: PROVIDER_ID.DEVIN, name: "Devin" },
  { id: PROVIDER_ID.GEMINI_CLI, name: "Gemini CLI" },
  { id: PROVIDER_ID.COPILOT, name: "GitHub Copilot" },
  { id: PROVIDER_ID.JULES, name: "Jules" },
  { id: PROVIDER_ID.OPENCODE, name: "OpenCode" },
];

const APPS: readonly RosterEntry[] = [
  { id: SESSION_APPLICATION_ID.CHATGPT, name: "ChatGPT" },
  { id: SESSION_APPLICATION_ID.CMUX, name: "cmux" },
  { id: SESSION_APPLICATION_ID.CONDUCTOR, name: "Conductor" },
  { id: SESSION_APPLICATION_ID.CURSOR, name: "Cursor" },
  { id: SESSION_APPLICATION_ID.ORCA, name: "Orca" },
  { id: SESSION_APPLICATION_ID.SUPERSET, name: "Superset" },
];

function Roster({
  label,
  entries,
}: {
  label: string;
  entries: readonly RosterEntry[];
}): React.JSX.Element {
  return (
    <div className="mt-8">
      {/* The group label is a technical token rather than a sentence, so it
          takes the mono the page reserves for those. */}
      <h3 className="m-0 font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </h3>
      <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-7 gap-y-4 p-0">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2.5">
            <span className="mark-tile">
              <ProviderMark providerId={entry.id} />
            </span>
            <span className="text-sm font-medium">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorksWith(): React.JSX.Element {
  return (
    <section className="hairline pt-12 pb-16">
      <h2 className="m-0 text-2xl leading-[1.15] font-semibold tracking-[-0.02em] text-pretty">
        Works with the agents you already run.
      </h2>
      <p className="mt-4 mb-0 max-w-[34rem] text-base text-pretty text-muted-foreground">
        Luke reads what each agent writes about its own sessions — on this machine or in its cloud —
        and tells the agents apart from the apps that hold them, so a Codex chat inside Conductor
        stays one row.
      </p>

      <Roster label="Agents" entries={AGENTS} />
      <Roster label="Apps" entries={APPS} />
    </section>
  );
}
