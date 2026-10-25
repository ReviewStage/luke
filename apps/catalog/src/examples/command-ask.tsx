import { BUTTON_VARIANT, Button, CommandAsk, Inline } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * command-ask.tsx -- a command an agent asks to run on this Mac, put to the
 * developer over the window: a short one, a long one that scrolls
 * inside its card, and one carrying a base64 payload it shortens, each opened from its button and put away by any of its
 * answers, Escape, or a press on the dimmed window, fading out as it goes.
 */

const SHORT_COMMAND = "git -C ~/code/app status --short";

const LONG_COMMAND = [
  "cd ~/code/app && pnpm install --frozen-lockfile",
  "pnpm exec vitest run packages/host/src/compose-mac-commands.test.ts --reporter=verbose",
  "git log --oneline -20 && git status --short && pnpm exec tsc --noEmit",
  'for pkg in packages/*; do echo "$pkg"; (cd "$pkg" && pnpm run typecheck); done',
  "tail -n 200 ~/Library/Logs/Luke/main.log",
].join(" && \\\n  ");

/** A script shipped as base64, as an agent writes a file to the Mac in one command. */
const PAYLOAD_COMMAND = [
  'd=$(mktemp -d) && cd "$d" && git init -q',
  `echo '${"H4sICCUi3moCA3NwbGl0LnBhdGNo".padEnd(4800, "AMVyTomQwK860JbsX0cp5JNjpWKdCoPsjYEgSGJCAS4GFCXV")}' | base64 -d | gunzip | git apply`,
  "pnpm exec vitest run packages/service",
].join(" && ");

/** A button that puts `command` to the developer, whose answers put it away. */
function Asking({ label, command }: { label: string; command: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <CommandAsk
        open={open}
        command={command}
        onAllowOnce={close}
        onAllowAlways={close}
        onDeny={close}
      />
    </>
  );
}

function CommandAsks(): React.JSX.Element {
  return (
    <CatalogSection id="command-ask-states" title="A command asked">
      <Inline>
        <Asking label="Short command…" command={SHORT_COMMAND} />
        <Asking label="Long command…" command={LONG_COMMAND} />
        <Asking label="Encoded payload…" command={PAYLOAD_COMMAND} />
      </Inline>
    </CatalogSection>
  );
}

export const COMMAND_ASK_EXAMPLE: Example = {
  id: "command-ask",
  title: "Command ask",
  Render: CommandAsks,
};
