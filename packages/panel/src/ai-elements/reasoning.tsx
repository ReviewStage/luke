import {
  GLYPH_INK,
  GlyphSlot,
  LineSummary,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  useDisclosurePreviewShown,
} from "@repo/ui";
import { BrainIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Fold, FoldBody, type FoldProps } from "./fold.js";

const REASONING_LINE = "Thought";

export const REASONING_BODY_CLASS =
  "mt-tight-gap mr-0 mb-0 ml-transcript-gutter text-muted-foreground";

export const REASONING_WORDS_CLASS = "m-0 whitespace-pre-wrap wrap-anywhere";

export type ReasoningProps = Omit<FoldProps, "className">;

export function Reasoning({ children, ...props }: ReasoningProps): ReactNode {
  return (
    <Fold className="reasoning text-caption-inline" {...props}>
      {children}
    </Fold>
  );
}

export interface ReasoningTriggerProps {
  preview?: string;
}

export function ReasoningTrigger({ preview = "" }: ReasoningTriggerProps): ReactNode {
  const previewed = useDisclosurePreviewShown(true);
  return (
    <LineSummary brightens>
      <GlyphSlot ink={GLYPH_INK.INHERIT}>
        <BrainIcon />
      </GlyphSlot>
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} truncate className="flex-1">
        <span className="text-foreground">{REASONING_LINE}</span>
        {previewed && preview !== "" ? ` ${preview}` : null}
      </Text>
    </LineSummary>
  );
}

export function ReasoningContent({ text }: { text: string }): ReactNode {
  return (
    <FoldBody className={REASONING_BODY_CLASS}>
      <p className={REASONING_WORDS_CLASS}>{text}</p>
    </FoldBody>
  );
}
