import {
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  CopyField,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useRef, useState } from "react";

const GITHUB_SIGN_IN_WORDS = {
  UNNAMED_MAC: "This Mac",
  UNNAMED_REPOSITORY: "the repository",
  HOW: "Sign in on that Mac, then retry:",
  COMMAND: "gh auth login",
  COMMAND_LABEL: "Sign-in command",
  COMMAND_WHAT: "command",
  RETRY: "Retry",
  MOVE_TO_CLOUD: "Move to cloud",
} as const;

export const RETRY_LINE = "Try again";

export interface GitHubSignInDoors {
  readonly host: string | undefined;
  readonly repository: string | undefined;
  readonly onRetry: () => void;
  readonly onMoveToCloud: (() => void) | undefined;
  readonly copy: (text: string) => Promise<void>;
}

export function GitHubSignInCard({
  host,
  repository,
  onRetry,
  onMoveToCloud,
  copy,
}: GitHubSignInDoors): React.JSX.Element {
  const pressed = useRef(false);
  const [retried, setRetried] = useState(false);
  const retry = () => {
    if (pressed.current) return;
    pressed.current = true;
    setRetried(true);
    onRetry();
  };
  return (
    <Banner
      look={BANNER_LOOK.CARD}
      tone={STATUS_TONE.DANGER}
      glyph={<GLYPH.FAILED />}
      glyphLook={BANNER_GLYPH.MARK}
      actions={
        <>
          {onMoveToCloud === undefined ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<GLYPH.CLOUD />} onClick={onMoveToCloud}>
              {GITHUB_SIGN_IN_WORDS.MOVE_TO_CLOUD}
            </Button>
          )}
          <Button variant={BUTTON_VARIANT.PRIMARY} disabled={retried} onClick={retry}>
            {GITHUB_SIGN_IN_WORDS.RETRY}
          </Button>
        </>
      }
    >
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
        {host ?? GITHUB_SIGN_IN_WORDS.UNNAMED_MAC} can't reach{" "}
        {repository === undefined ? (
          GITHUB_SIGN_IN_WORDS.UNNAMED_REPOSITORY
        ) : (
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
            {repository}
          </Text>
        )}{" "}
        on GitHub.
      </Text>
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {GITHUB_SIGN_IN_WORDS.HOW}
      </Text>
      <CopyField
        label={GITHUB_SIGN_IN_WORDS.COMMAND_LABEL}
        value={GITHUB_SIGN_IN_WORDS.COMMAND}
        what={GITHUB_SIGN_IN_WORDS.COMMAND_WHAT}
        copy={copy}
        width={COPY_FIELD_WIDTH.FULL}
        prompt={COPY_FIELD_PROMPT.SHELL}
      />
    </Banner>
  );
}
