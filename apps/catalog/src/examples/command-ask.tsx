import { PRODUCT_NAME } from "@repo/features/product-name";
import { BUTTON_VARIANT, Button, CommandAsk, Inline } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SHORT_COMMAND = "git -C ~/code/app status --short";

const LONG_COMMAND = [
  "cd ~/code/app && pnpm install --frozen-lockfile",
  "pnpm exec vitest run packages/host/src/compose-mac-commands.test.ts --reporter=verbose",
  "git log --oneline -20 && git status --short && pnpm exec tsc --noEmit",
  'for pkg in packages/*; do echo "$pkg"; (cd "$pkg" && pnpm run typecheck); done',
  `tail -n 200 ~/Library/Logs/${PRODUCT_NAME}/main.log`,
].join(" && \\\n  ");

const PAYLOAD_COMMAND = [
  'd=$(mktemp -d) && cd "$d" && git init -q',
  `echo '${"H4sICCUi3moCA3NwbGl0LnBhdGNo".padEnd(4800, "AMVyTomQwK860JbsX0cp5JNjpWKdCoPsjYEgSGJCAS4GFCXV")}' | base64 -d | gunzip | git apply`,
  "pnpm exec vitest run packages/service",
].join(" && ");

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
