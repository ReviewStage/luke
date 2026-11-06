import { harnessNameOf } from "@repo/features/agent-runtime-models";
import { FAILURE_REASON } from "@repo/features/failure-remedy";
import { type CatalogModel, MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import {
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  PlugIcon,
  STATUS_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { HarnessMark } from "../harness-marks.js";
import type { ConnectFailure } from "./agent-model.js";
import { useRepositoryRemedy } from "./repository-remedy.js";

export const NOTICE_LOOK = {
  INSET: "inset",
  CARD: "card",
} as const;

export type NoticeLook = (typeof NOTICE_LOOK)[keyof typeof NOTICE_LOOK];

const PROVIDERS: readonly ModelProvider[] = [MODEL_PROVIDER.ANTHROPIC, MODEL_PROVIDER.OPENAI];

const CONNECT_AGENT_COPY = {
  NONE_TITLE: "Connect an agent to start",
  NONE_DETAIL: "Agents run on your Claude or ChatGPT plan, or an API key.",
  OTHER_DETAIL: "Connect it, or choose another model below.",
} as const;

function unpaidTitle(provider: ModelProvider): string {
  return `Connect ${harnessNameOf(provider)} to run this model`;
}

export function ConnectAgentBanner({
  models,
  unpaid,
  look = NOTICE_LOOK.INSET,
}: {
  models: readonly CatalogModel[];
  unpaid: ConnectFailure;
  look?: NoticeLook | undefined;
}): React.JSX.Element {
  const card = look === NOTICE_LOOK.CARD;
  const remedy = useRepositoryRemedy();
  const anyPaid = models.some((model) => model.credentialMissing !== true);
  const offered = anyPaid
    ? [unpaid.provider]
    : [...PROVIDERS.filter((provider) => provider !== unpaid.provider), unpaid.provider];
  const connect = (provider: ModelProvider) =>
    remedy({ reason: FAILURE_REASON.CONNECT_AGENTS, text: unpaid.text, provider })?.();
  return (
    <Banner
      look={card ? BANNER_LOOK.CARD : BANNER_LOOK.INSET}
      tone={card ? STATUS_TONE.ATTENTION : STATUS_TONE.NEUTRAL}
      glyph={<PlugIcon />}
      actions={offered.map((provider) => (
        <Button
          key={provider}
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<HarnessMark provider={provider} />}
          onClick={() => connect(provider)}
        >
          {`Connect ${harnessNameOf(provider)}`}
        </Button>
      ))}
    >
      <Text variant={card ? TEXT_VARIANT.SECTION : TEXT_VARIANT.BODY}>
        {anyPaid ? unpaidTitle(unpaid.provider) : CONNECT_AGENT_COPY.NONE_TITLE}
      </Text>
      <Text tone={TEXT_TONE.MUTED}>
        {anyPaid ? CONNECT_AGENT_COPY.OTHER_DETAIL : CONNECT_AGENT_COPY.NONE_DETAIL}
      </Text>
    </Banner>
  );
}
