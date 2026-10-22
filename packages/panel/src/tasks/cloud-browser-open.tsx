import type { AgentBrowserTab } from "@luke/features/agent-browser-tab-wire";
import { browserAddressOf } from "@luke/features/browser-acts";
import { BROWSER_TAB_OPEN_FAILURE, type BrowserTabOpenFailure } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import {
  AddressField,
  BUTTON_VARIANT,
  Button,
  DIALOG_SIZE,
  Dialog,
  FormField,
  SELECT_WIDTH,
  Select,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useRef, useState } from "react";
import { useAct } from "../act.js";
import { noteOpenedCloudTab } from "./cloud-browser-tabs.js";

/**
 * cloud-browser-open.tsx -- New tab in an agent's browser, from the side panel's "+": which of the task's coding agents, and the address, asked in a dialog over the window.
 *
 * A member opens a tab in a coding agent's cloud browser to sign in
 * somewhere for it, or to show it a page. The dialog asks for the address
 * in the Browser tab's own bar (`@luke/ui`'s AddressField), read as that
 * bar reads one (`browserAddressOf`), so `localhost:3000` is the agent's own
 * dev server; and, where the task has several agents, whose browser, the
 * one the member was viewing first. The service opens the page, resuming
 * the agent's sandbox where it stopped, which may take a minute, and takes
 * the tab over for the member at once; the dialog then puts itself away and
 * the panel lands on the tab (`noteOpenedCloudTab`). A refusal stays up,
 * said in words under the address, and nothing the address holds is kept
 * past the dialog.
 */

/** A coding agent whose browser a tab may open in: its id, and its name as its tab is named. */
export interface CloudBrowserAgent {
  readonly id: string;
  readonly name: string;
}

/** Why the tab did not open, in words, naming the agent where the reason is its. */
function failureWords(failure: BrowserTabOpenFailure, agent: string): string {
  switch (failure) {
    case BROWSER_TAB_OPEN_FAILURE.INVALID_ADDRESS:
      return "Only http and https addresses open in an agent's browser.";
    case BROWSER_TAB_OPEN_FAILURE.NOT_PERMITTED:
      return `Only whoever started ${agent} can open a tab in its browser.`;
    case BROWSER_TAB_OPEN_FAILURE.NOT_FOUND:
      return `${agent} is no longer on this task.`;
    case BROWSER_TAB_OPEN_FAILURE.NOT_READY:
      return `${agent} hasn't opened its sandbox yet. Try again once it has started working.`;
    case BROWSER_TAB_OPEN_FAILURE.RETIRED:
      return `${agent} is archived, so its browser is gone.`;
    case BROWSER_TAB_OPEN_FAILURE.UNREACHABLE:
      return `${agent}'s browser couldn't be reached. Try again in a moment.`;
    case BROWSER_TAB_OPEN_FAILURE.UNANSWERED:
      return "The tab couldn't be opened. Try again.";
  }
}

/** What a browser is called by whose it is. */
const browserOf = (name: string) => `${name}'s browser`;

/**
 * The dialog while it is asked: the agents to choose among, the one chosen
 * first, and what a tab opened does. `onOpened` hears the tab once the
 * service took it over for the member; `onDismiss` puts the dialog away.
 */
export function CloudBrowserOpenDialog({
  taskId,
  agents,
  chosen,
  onOpened,
  onDismiss,
}: {
  taskId: string;
  agents: readonly CloudBrowserAgent[];
  /** The agent chosen as the dialog opens: the one the member was viewing, or the first. */
  chosen: string;
  onOpened: (tab: AgentBrowserTab) => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const field = useRef<HTMLInputElement>(null);
  const [agentId, setAgentId] = useState(chosen);
  const [typed, setTyped] = useState("");
  const [opening, setOpening] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const agent = agents.find((each) => each.id === agentId) ?? agents[0];
  const name = agent?.name ?? "The agent";

  const open = () => {
    if (opening || agent === undefined) return;
    const address = browserAddressOf(typed);
    if (address === undefined) {
      setRefused("Type an address, like localhost:3000.");
      field.current?.focus();
      return;
    }
    setOpening(true);
    setRefused(undefined);
    act(ACT_KIND.TASKS_BROWSER_TAB_OPEN, { taskId, agentId: agent.id, address }).then(
      (answer) => {
        setOpening(false);
        if ("tab" in answer) {
          noteOpenedCloudTab(taskId, answer.tab);
          onOpened(answer.tab);
          return;
        }
        setRefused(failureWords(answer.failure, name));
      },
      () => {
        setOpening(false);
        setRefused(failureWords(BROWSER_TAB_OPEN_FAILURE.UNANSWERED, name));
      },
    );
  };
  const dismiss = () => {
    if (!opening) onDismiss();
  };
  return (
    <Dialog
      size={DIALOG_SIZE.CONFIRM}
      title={`New tab in ${browserOf(name)}`}
      busy={opening}
      initialFocus={field}
      onDismiss={dismiss}
      actions={
        <>
          <Button variant={BUTTON_VARIANT.QUIET} disabled={opening} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            variant={BUTTON_VARIANT.PRIMARY}
            busy={opening}
            busyLabel="Opening"
            onClick={open}
          >
            Open tab
          </Button>
        </>
      }
    >
      <div className="cloud-browser-open">
        {agents.length > 1 ? (
          <FormField label="Agent">
            {(control) => (
              <Select
                label="Agent"
                options={agents.map((each) => ({ value: each.id, label: each.name }))}
                value={agentId}
                describedBy={control["aria-describedby"]}
                disabled={opening}
                width={SELECT_WIDTH.FIELD}
                onChange={setAgentId}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="Address" error={refused}>
          {(control) => (
            <AddressField
              ref={field}
              field={control}
              value={typed}
              disabled={opening}
              onChange={(value) => {
                setTyped(value);
                setRefused(undefined);
              }}
              onOpen={open}
            />
          )}
        </FormField>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {opening
            ? `Opening in ${browserOf(name)}. A sandbox that stopped can take a minute to wake.`
            : `It opens in ${browserOf(name)}, in its own sandbox, and you drive it until you hand it back.`}
        </Text>
      </div>
    </Dialog>
  );
}
