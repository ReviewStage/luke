import { inviteesOf } from "@repo/features/workspace-invitation-wire";
import { EMAIL_CHIP_STATE, type EmailChip, EmailChipsField, GAP, Stack } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * email-chips.tsx -- the field of email addresses empty, holding an address
 * in every state (to be sent, no address, on its way, sent, and refused),
 * and unavailable, a long list of wrong ones among them.
 */

/** Every state an address stands in, as an invitation's run leaves them. */
const EVERY_STATE: readonly EmailChip[] = [
  {
    id: "dana@acme.dev",
    words: "Dana Ruiz",
    typed: "Dana Ruiz <dana@acme.dev>",
    state: EMAIL_CHIP_STATE.SENT,
  },
  {
    id: "theo@acme.dev",
    words: "theo@acme.dev",
    typed: "theo@acme.dev",
    state: EMAIL_CHIP_STATE.SENDING,
  },
  {
    id: "priya@acme.dev",
    words: "priya@acme.dev",
    typed: "priya@acme.dev",
    state: EMAIL_CHIP_STATE.DRAFT,
  },
  {
    id: "sam@gmail",
    words: "sam@gmail",
    typed: "sam@gmail",
    state: EMAIL_CHIP_STATE.BAD,
    reason: "Not an email address",
  },
  {
    id: "lee@acme.dev",
    words: "lee@acme.dev",
    typed: "lee@acme.dev",
    state: EMAIL_CHIP_STATE.REFUSED,
    reason: "Already a member",
  },
];

/** A long paste with many addresses wrong, two ways, as a list from a spreadsheet lands. */
const MANY_WRONG: readonly EmailChip[] = [
  "dana@acme.dev",
  "theo",
  "priya@acme.dev",
  "sam@gmail",
  "lee@acme.dev",
  "kim@",
  "ana@acme.dev",
  "ravi",
  "mo@acme.dev",
  "jo@acme",
  "ida@acme.dev",
  "max",
  "zoe@acme.dev",
  "eli@acme.dev",
  "noor@acme.dev",
  "ben",
].map((one) => ({
  id: one,
  words: one,
  typed: one,
  state:
    one.includes("@") && one.split("@")[1]?.includes(".")
      ? EMAIL_CHIP_STATE.DRAFT
      : EMAIL_CHIP_STATE.BAD,
  reason:
    one.includes("@") && one.split("@")[1]?.includes(".") ? undefined : "Not an email address",
}));

/** A field the example holds the chips of, reading what is typed into addresses as the panel does. */
function Held({
  start,
  disabled,
}: {
  start: readonly EmailChip[];
  disabled?: boolean;
}): React.JSX.Element {
  const [typed, setTyped] = useState("");
  const [chips, setChips] = useState(start);
  return (
    <EmailChipsField
      chips={chips}
      typed={typed}
      onTyped={setTyped}
      label="Invite by email"
      placeholder="Type or paste emails, like dana@acme.dev"
      disabled={disabled}
      onAdd={(typed) =>
        setChips((now) => [
          ...now,
          ...inviteesOf(typed)
            .filter((one) => !now.some((chip) => chip.id === one.email.toLowerCase()))
            .map((one) => ({
              id: one.email.toLowerCase(),
              words: one.name ?? one.email,
              typed: one.typed,
              state: one.invitable ? EMAIL_CHIP_STATE.DRAFT : EMAIL_CHIP_STATE.BAD,
              reason: one.invitable ? undefined : "Not an email address",
            })),
        ])
      }
      onRemove={(id) => setChips((now) => now.filter((chip) => chip.id !== id))}
    />
  );
}

function EmailChips(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="email-chips" title="Empty, in every state, and unavailable">
        <Stack gap={GAP.CONTROL}>
          <Held start={[]} />
          <Held start={EVERY_STATE} />
          <Held start={MANY_WRONG} />
          <Held start={EVERY_STATE.slice(0, 3)} disabled />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const EMAIL_CHIPS_EXAMPLE: Example = {
  id: "email-chips",
  title: "Email chips",
  Render: EmailChips,
};
