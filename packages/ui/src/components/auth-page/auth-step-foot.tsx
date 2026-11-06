import { BUTTON_VARIANT, type BusyProps, Button } from "../button/button.js";

export type AuthStepNext = BusyProps & {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean | undefined;
};

const FOOT =
  "ui-auth-step-foot grid grid-cols-[1fr_auto_1fr] items-center gap-control-gap @max-[300px]/ui-auth-foot:grid-cols-[auto_1fr]";

const PLACE =
  "whitespace-nowrap text-caption text-muted-foreground tabular-nums @max-[300px]/ui-auth-foot:col-span-full @max-[300px]/ui-auth-foot:row-start-2 @max-[300px]/ui-auth-foot:justify-self-center";

const BLEED = {
  start: "flex -ms-control-inset",
  end: "flex -me-control-inset",
  none: "flex",
} as const;

function NextButton({ next }: { next: AuthStepNext }): React.JSX.Element {
  const { label, onPress, ...pressed } = next;
  return (
    <Button variant={BUTTON_VARIANT.PRIMARY} onClick={onPress} {...pressed}>
      {label}
    </Button>
  );
}

export function AuthStepFoot({
  at,
  total,
  onBack,
  onSkip,
  next,
}: {
  at: number;
  total: number;
  onBack?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  next?: AuthStepNext | undefined;
}): React.JSX.Element {
  return (
    <div className={FOOT}>
      <div className="flex justify-start">
        {onBack === undefined ? null : (
          <span className={BLEED.start}>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onBack}>
              Back
            </Button>
          </span>
        )}
      </div>
      <span className={PLACE}>
        {at} of {total}
      </span>
      <div className="flex justify-end gap-control-gap">
        {onSkip === undefined ? null : (
          <span className={next === undefined ? BLEED.end : BLEED.none}>
            <Button variant={BUTTON_VARIANT.QUIET} onClick={onSkip}>
              Skip
            </Button>
          </span>
        )}
        {next === undefined ? null : <NextButton next={next} />}
      </div>
    </div>
  );
}
