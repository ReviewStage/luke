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

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

const MANAGE_USAGE = "Manage usage";

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
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  readModels: () => void;
  usage: AgentUsage | undefined;
  payer?: AgentPayer | undefined;
  look?: ChipLook;
  width?: ChipWidth | undefined;
  narrow?: boolean;
  startsNew?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const provider = providerOf(model.choice.model);
  const label = choiceLabel(model.choice, models ?? []).trim();
  const paidBy = payer ?? usage?.payer;
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
