import { Component, type ReactNode } from "react";
import { ProductMark } from "../../marks/product-mark.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

const SHOWN_FAILED = "This page could not be shown.";

const WORDS = {
  HEADING: "Something went wrong",
  RELOAD: "Reload",
} as const;

export const RELOAD_ROOM = {
  WINDOW: "window",
  REGION: "region",
} as const;

export type ReloadRoom = (typeof RELOAD_ROOM)[keyof typeof RELOAD_ROOM];

const ROOM = {
  [RELOAD_ROOM.WINDOW]:
    "ui-reload-state fixed inset-0 flex flex-col items-center overflow-x-hidden overflow-y-auto bg-ground before:flex-[2_1_0] after:flex-[3_1_0]",
  [RELOAD_ROOM.REGION]:
    "ui-reload-state ui-empty-state flex min-h-0 flex-[1_1_0] flex-col items-center overflow-x-hidden overflow-y-auto before:flex-[2_1_0] after:flex-[3_1_0]",
} as const satisfies Record<ReloadRoom, string>;

const HEADING_ELEMENT = {
  [RELOAD_ROOM.WINDOW]: TEXT_ELEMENT.H1,
  [RELOAD_ROOM.REGION]: TEXT_ELEMENT.H2,
} as const satisfies Record<ReloadRoom, (typeof TEXT_ELEMENT)[keyof typeof TEXT_ELEMENT]>;

export function ReloadState({
  failure = SHOWN_FAILED,
  room = RELOAD_ROOM.REGION,
  onReload,
}: {
  failure?: string | undefined;
  room?: ReloadRoom | undefined;
  onReload: () => void;
}): React.JSX.Element {
  return (
    <div className={ROOM[room]} data-room={room}>
      {room === RELOAD_ROOM.WINDOW ? (
        <div
          className="ui-reload-state-drag absolute inset-x-0 top-0 h-ui-40 in-data-[ui-profile=desktop]:[-webkit-app-region:drag]"
          aria-hidden="true"
        />
      ) : null}
      <div
        role="alert"
        className="ui-reload-state-body box-border flex max-w-auth-card flex-col items-center p-ui-24 text-center"
      >
        <span
          className="ui-reload-state-mark flex text-muted-foreground opacity-60 [&_svg]:size-ui-32"
          aria-hidden="true"
        >
          <ProductMark inherit />
        </span>
        <Text
          as={HEADING_ELEMENT[room]}
          variant={TEXT_VARIANT.DIALOG}
          className="mt-ui-16 text-balance"
        >
          <ReplayWords unmasked>{WORDS.HEADING}</ReplayWords>
        </Text>
        <Text tone={TEXT_TONE.MUTED} className="mt-ui-4 text-balance">
          <ReplayWords unmasked>{failure}</ReplayWords>
        </Text>
        <div className="ui-reload-state-action mt-ui-20 in-data-[ui-profile=desktop]:[-webkit-app-region:no-drag]">
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onReload}>
            <ReplayWords unmasked>{WORDS.RELOAD}</ReplayWords>
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  readonly failure?: string | undefined;
  readonly room?: ReloadRoom | undefined;
  readonly onReload?: (() => void) | undefined;
  readonly children?: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  reload = (): void => {
    this.props.onReload?.();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ReloadState failure={this.props.failure} room={this.props.room} onReload={this.reload} />
    );
  }
}
