import { PRODUCT_NAME } from "@repo/features/product-name";
import { CheckIcon } from "../../face/glyphs.js";
import { ICON_SIZE } from "../../icons/icon-size.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { GLYPH_INK, GlyphSlot } from "../glyph-slot/glyph-slot.js";
import { AuthMark } from "./auth-mark.js";
import { AuthPage } from "./auth-page.js";

export const CONSENT_ANSWER = {
  ALLOW: "allow",
  DENY: "deny",
} as const;

export type ConsentAnswer = (typeof CONSENT_ANSWER)[keyof typeof CONSENT_ANSWER];

const ANSWER_WORDS = {
  [CONSENT_ANSWER.ALLOW]: { label: "Allow", busy: "Allowing" },
  [CONSENT_ANSWER.DENY]: { label: "Deny", busy: "Denying" },
} as const satisfies Record<ConsentAnswer, { label: string; busy: string }>;

function AnswerButton({
  answer,
  answering,
  onAnswer,
}: {
  answer: ConsentAnswer;
  answering: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
}): React.JSX.Element {
  const words = ANSWER_WORDS[answer];
  return (
    <Button
      variant={answer === CONSENT_ANSWER.ALLOW ? BUTTON_VARIANT.PRIMARY : BUTTON_VARIANT.OUTLINE}
      busy={answering === answer}
      busyLabel={words.busy}
      disabled={answering !== undefined && answering !== answer}
      onClick={() => onAnswer(answer)}
    >
      {words.label}
    </Button>
  );
}

const CONSENT_MEANING = "It acts as you until you revoke it in Settings › MCP.";

export function ConsentCard({
  client,
  account,
  abilities,
  destination,
  answering,
  onAnswer,
}: {
  client: string;
  account: string;
  abilities: readonly string[];
  destination: string;
  answering: ConsentAnswer | undefined;
  onAnswer: (answer: ConsentAnswer) => void;
}): React.JSX.Element {
  return (
    <AuthPage
      mark={<AuthMark mcpClient />}
      title={`${client} wants to use your ${PRODUCT_NAME} account`}
      description={CONSENT_MEANING}
      footnote={`You'll allow it as ${account}. Your answer goes to ${destination}.`}
      foot={
        <div className="ui-consent-answers grid grid-cols-2 gap-control-gap">
          <AnswerButton answer={CONSENT_ANSWER.DENY} answering={answering} onAnswer={onAnswer} />
          <AnswerButton answer={CONSENT_ANSWER.ALLOW} answering={answering} onAnswer={onAnswer} />
        </div>
      }
    >
      <ul
        className="ui-consent-abilities m-0 p-0 list-none flex flex-col border border-border rounded-control bg-well text-label"
        aria-label={`What ${client} will be able to do`}
      >
        {abilities.map((ability) => (
          <li
            className="ui-consent-ability flex items-start gap-ui-8 px-ui-12 py-ui-8 not-first:border-t not-first:border-border"
            key={ability}
          >
            <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.SMALL} line>
              <CheckIcon />
            </GlyphSlot>
            <span>{ability}</span>
          </li>
        ))}
      </ul>
    </AuthPage>
  );
}
