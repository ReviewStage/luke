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
  Text,
} from "@repo/ui";
import { HarnessMark } from "../harness-marks.js";
import type { ConnectFailure } from "./agent-model.js";
import { useRepositoryRemedy } from "./repository-remedy.js";

/**
 * connect-agent-banner.tsx -- the card over a composer whose agent nothing of the account's pays for: what to connect, and the presses that connect it.
 *
 * A box whose chosen model no plan or API key of the account's pays for
 * holds Start (`unrunnableChoice`), and this card says so above it, before
 * anything is typed, rather than a line under the box once Start is
 * pressed. Where nothing is connected at all it offers both harnesses, the
 * chosen model's last as the primary press; where another harness is
 * connected it offers the chosen model's alone and says another model on
 * the chip runs now. Each press lands on its harness's row in Settings ›
 * Agents, as the model menu's Connect does.
 */

/** The harnesses a card offers where nothing is connected, in reading order before the chosen one. */
const PROVIDERS: readonly ModelProvider[] = [MODEL_PROVIDER.ANTHROPIC, MODEL_PROVIDER.OPENAI];

/** What the card says, worded once. */
const CONNECT_AGENT_COPY = {
  NONE_TITLE: "Connect an agent to start",
  NONE_DETAIL: "Agents run on your Claude or ChatGPT plan, or an API key.",
  OTHER_DETAIL: "Connect it, or choose another model below.",
} as const;

/** What the card says where `provider` is unpaid but another harness is connected. */
function unpaidTitle(provider: ModelProvider): string {
  return `Connect ${harnessNameOf(provider)} to run this model`;
}

export function ConnectAgentBanner({
  models,
  unpaid,
}: {
  /** The catalog as last read, which says whether any harness is connected. */
  models: readonly CatalogModel[];
  /** Why the chosen model cannot run: the harness its provider runs in. */
  unpaid: ConnectFailure;
}): React.JSX.Element {
  const remedy = useRepositoryRemedy();
  const anyPaid = models.some((model) => model.credentialMissing !== true);
  // Note that the chosen model's harness is the primary press, which stands last.
  const offered = anyPaid
    ? [unpaid.provider]
    : [...PROVIDERS.filter((provider) => provider !== unpaid.provider), unpaid.provider];
  const connect = (provider: ModelProvider) =>
    remedy({ reason: FAILURE_REASON.CONNECT_AGENTS, text: unpaid.text, provider })?.();
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.ATTENTION}
      glyph={<PlugIcon />}
      actions={offered.map((provider) => (
        <Button
          key={provider}
          variant={provider === unpaid.provider ? BUTTON_VARIANT.PRIMARY : BUTTON_VARIANT.OUTLINE}
          icon={<HarnessMark provider={provider} />}
          onClick={() => connect(provider)}
        >
          {`Connect ${harnessNameOf(provider)}`}
        </Button>
      ))}
    >
      <Text>{anyPaid ? unpaidTitle(unpaid.provider) : CONNECT_AGENT_COPY.NONE_TITLE}</Text>
      <Text tone={TEXT_TONE.MUTED}>
        {anyPaid ? CONNECT_AGENT_COPY.OTHER_DETAIL : CONNECT_AGENT_COPY.NONE_DETAIL}
      </Text>
    </Banner>
  );
}
