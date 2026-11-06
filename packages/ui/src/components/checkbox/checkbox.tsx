import { type ReactNode, useRef } from "react";
import { cn } from "../../cn.js";
import { pulsePress } from "../../press-pulse.js";
import { Checkbox as ShadcnCheckbox } from "../../shadcn/checkbox.js";

type Named =
  | {
      children: ReactNode;
      label?: undefined;
    }
  | {
      children?: undefined;
      label: string;
    };

const CHECKBOX =
  "ui-checkbox inline-flex items-start gap-icon-gap min-w-0 align-top font-ui text-body cursor-press";

const BOX_ALONE =
  "relative pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']";

const DETAIL =
  "ui-checkbox-detail min-w-0 pl-[calc(var(--spacing-select-box)+var(--spacing-icon-gap))]";

const BOX_ON_LINE = "mt-[calc((var(--ui-type-body-leading)-14px)/2)]";

export function Checkbox({
  checked,
  onChange,
  mixed = false,
  disabled,
  readOnly = false,
  name,
  id,
  "aria-describedby": describedBy,
  children,
  label,
  detail,
}: Named & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  mixed?: boolean;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  name?: string | undefined;
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  detail?: ReactNode;
}): React.JSX.Element {
  const words = label === undefined;
  const box = useRef<HTMLElement | null>(null);
  const checkbox = (
    // biome-ignore lint/a11y/noLabelWithoutControl: the box inside is Base UI's checkbox, whose native input the label's press reaches, which the rule cannot see through a component.
    <label
      className={cn(
        CHECKBOX,
        (disabled === true || readOnly) && "cursor-default",
        !words && BOX_ALONE,
      )}
      data-disabled={disabled === true}
      data-read-only={readOnly || undefined}
      data-words={words}
    >
      <ShadcnCheckbox
        ref={box}
        className={cn("ui-checkbox-box", words && BOX_ON_LINE)}
        id={id}
        name={name}
        checked={checked}
        indeterminate={mixed}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={label}
        aria-describedby={describedBy}
        onCheckedChange={(next) => {
          if (readOnly) return;
          if (box.current !== null) pulsePress(box.current);
          onChange(mixed ? true : next);
        }}
      />
      {words ? <span className="ui-checkbox-words min-w-0 wrap-anywhere">{children}</span> : null}
    </label>
  );
  if (detail === undefined || !words) return checkbox;
  return (
    <div className="ui-checkbox-detailed flex min-w-0 flex-col gap-tight-gap">
      {checkbox}
      <div className={DETAIL}>{detail}</div>
    </div>
  );
}
