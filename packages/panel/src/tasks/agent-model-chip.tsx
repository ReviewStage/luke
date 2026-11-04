import { runtimeModelRule, runtimeModels } from "@repo/features/agent-runtime-models";
import { AGENT_PAYER, type AgentPayer, type AgentUsage } from "@repo/features/agent-wire";
import type { CatalogModel, ModelProvider } from "@repo/features/models-wire";
import {
  CHIP_LOOK,
  Chip,
  type ChipLook,
  ChipName,
  type ChipWidth,
  type MenuLastLine,
  POPOVER_ALIGN,
  TEXT_LINK_LOOK,
  TextLink,
  Tooltip,
} from "@repo/ui";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useRef, useState } from "react";
import { HarnessMark } from "../harness-marks.js";
import { agentPayerLine, choiceLabel, planPayerOf, providerOf } from "./agent-model.js";
import { ModelLabel } from "./model-label.js";
import { ModelMenu, settledChoice } from "./model-menu.js";
import type { AgentModelControl } from "./use-agent-model.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * agent-model-chip.tsx -- the chip at the agent box's foot that names what the agent runs on, and the menu that changes it.
 *
 * Drawn along the composer card's foot as the window's toolbar chip
 * (`@repo/ui`'s `Chip`), the task toolbar's repository chip's look, with no
 * border and no fill until the pointer is on it or its menu is open:
 * "Opus 5.5 High" (`model-label.tsx`), with "Fast" after the effort where
 * the fast version is on and the standard context window's size where the
 * agent runs on that rather than its model's whole window ("GPT-5.5 High
 * 272K"), and a chevron saying it opens a menu. A press
 * opens the shared model menu (`model-menu.tsx`) right above the chip,
 * from its trailing edge, since the chip stands at the foot's right
 * (`@repo/ui`'s `SearchableMenu`), the
 * agent's choice checked; what the menu chooses is the agent's model,
 * effort, and context window for its next step, drawn on the chip at once (`use-agent-model.ts`). The chip reads the
 * same whatever the agent is doing, since a change mid-turn applies from
 * the next step and an idle agent's next turn takes it. The models are
 * read as the chip mounts and again as the menu opens, so the menu shows
 * the catalog as it stands. Under the menu's pinned rows, behind a hairline
 * of its own, one muted line says who pays for the agent (`agentPayerLine`):
 * its plan, or its key and what the run has cost on it so far. The menu closes on a pick, on Escape, and on
 * focus leaving it; Escape stops there, so it closes the menu and not the
 * panel behind it. A composer too narrow for the words has the chip draw
 * its harness's mark in their place (`iconOnly`), so the choice is named by
 * the chip's label and its tooltip rather than by its words. An agent on a
 * provider's own harness is offered only what that harness runs, the rule
 * `list_models` and `update_agent` read too (`agent-runtime-models.ts`): on
 * Claude Code, Claude models alone, with no Fast switch and no Context row.
 * An agent its starter's ChatGPT plan pays for says "Using ChatGPT plan" on
 * that line, with Manage usage at its end, as OpenAI's UI guidelines ask
 * (developers.openai.com/siwc/ui-ux-guidelines), opening ChatGPT's usage
 * settings. Who pays is read once, the page's payer before the settled
 * turns', and the plan the agent's harness runs on only where neither
 * names one, so a Codex agent says its plan before its first turn settles.
 */

/** Where OpenAI's guidelines send Manage usage: ChatGPT's own usage settings. */
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** The link at the last line's end on an agent a ChatGPT plan pays for. */
const MANAGE_USAGE = "Manage usage";

/** Manage usage, opening ChatGPT's usage settings. */
function ManageUsageLink(): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <TextLink
      href={CHATGPT_USAGE_URL}
      look={TEXT_LINK_LOOK.UNDERLINED}
      external
      onClick={(event) => {
        event.preventDefault();
        openLink(CHATGPT_USAGE_URL);
      }}
    >
      {MANAGE_USAGE}
    </TextLink>
  );
}

/** The menu's last line: who pays, with Manage usage at its end where a ChatGPT plan does; nothing where no payer is named. */
function payerLastLine(
  payer: AgentPayer | undefined,
  provider: ModelProvider | undefined,
  usage: AgentUsage | undefined,
): MenuLastLine | undefined {
  const words = agentPayerLine(payer, provider, usage?.costUsd);
  if (words === undefined) return undefined;
  return payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION
    ? { words, end: <ManageUsageLink /> }
    : { words };
}

export function AgentModelChip({
  model,
  models,
  modelsFailed,
  readModels,
  usage,
  payer,
  look = CHIP_LOOK.TOOLBAR,
  width,
  narrow = false,
  startsNew = false,
}: {
  model: AgentModelControl;
  /** The catalog as the host holds it for the account; nothing before it is first read. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the catalog could not be read. */
  modelsFailed: boolean;
  /** Asks the host for the catalog again, as the menu's Retry asks. */
  readModels: () => void;
  /** What the agent has cost, as its transcript's last page said; nothing before a turn settled. */
  usage: AgentUsage | undefined;
  /** Who pays for the agent, as its transcript's last page said, before a turn settled too; nothing where it said none. */
  payer?: AgentPayer | undefined;
  /** The chip's look: the agent box's toolbar chip, or a form row's field (`@repo/ui`'s `Chip`). */
  look?: ChipLook;
  /** How wide the chip stands; its words' own width where none is named. */
  width?: ChipWidth | undefined;
  /** Whether its place is too narrow for the words, so a chip whose harness has a mark draws that alone. */
  narrow?: boolean;
  /** Whether the choice is what a new agent would start on, on the reader's own credentials, as an automation's is, so one nothing of theirs pays for says it cannot run; never a running agent's, whose starter pays. */
  startsNew?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Note that we hand focus back to the chip, as a native menu returns it to
  // its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const provider = providerOf(model.choice.model);
  const label = choiceLabel(model.choice, models ?? []).trim();
  // Note that who pays decides Fast on Codex, which runs a fast version on an OpenAI API key alone.
  const paidBy = payer ?? usage?.payer;
  // Note that the harness's plan says who pays only where neither the page nor the turns name a payer.
  const paying = paidBy ?? planPayerOf(model.runtime);
  const offered = models === undefined ? undefined : runtimeModels(models, model.runtime, paidBy);

  return (
    <div className="agent-model-chip relative flex min-w-0" ref={root}>
      <Tooltip label={label}>
        <Chip
          ref={trigger}
          look={look}
          width={width}
          iconOnly={narrow && provider !== undefined}
          chevron
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
        >
          {narrow && provider !== undefined ? <HarnessMark provider={provider} /> : null}
          <ChipName>
            <ModelLabel choice={model.choice} models={models ?? []} />
          </ChipName>
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          align={POPOVER_ALIGN.END}
          models={offered}
          failed={modelsFailed}
          onRetry={readModels}
          chosen={settledChoice(offered, model.choice)}
          startsNew={startsNew}
          offersFast={runtimeModelRule(model.runtime, paidBy).fast}
          onChoose={model.choose}
          lastLine={payerLastLine(paying, provider, usage)}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
