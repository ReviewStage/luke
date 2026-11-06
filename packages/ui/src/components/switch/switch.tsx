import type { SwitchRootProps } from "@base-ui/react/switch";
import type { MouseEvent } from "react";
import { pulsePress } from "../../press-pulse.js";
import { ShadcnSwitch, SWITCH_THUMB, SWITCH_TRACK } from "../../shadcn/switch.js";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean, event: MouseEvent<HTMLElement>) => void;
  label: string;
  describedBy?: string | undefined;
} & Omit<
  SwitchRootProps,
  | "checked"
  | "defaultChecked"
  | "onCheckedChange"
  | "onClick"
  | "className"
  | "style"
  | "children"
  | "render"
  | "nativeButton"
  | "aria-checked"
  | "aria-label"
>;

export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  ...button
}: SwitchProps): React.JSX.Element {
  return (
    <ShadcnSwitch
      {...button}
      nativeButton
      render={<button type="button" />}
      checked={checked}
      aria-label={label}
      aria-describedby={describedBy ?? button["aria-describedby"]}
      onClick={(event) => {
        const thumb = event.currentTarget.firstElementChild;
        if (thumb instanceof HTMLElement) pulsePress(thumb);
        onChange(!checked, event);
      }}
    />
  );
}

const LABELED_SWITCH =
  "inline-flex items-center gap-icon-gap min-w-0 font-ui text-body cursor-press has-disabled:cursor-default";

export function LabeledSwitch(props: SwitchProps): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is a native button, which the label's press reaches, which the rule cannot see through a component.
    <label className={LABELED_SWITCH}>
      <Switch {...props} />
      <span className="min-w-0">{props.label}</span>
    </label>
  );
}

export function SwitchMark({ checked }: { checked: boolean }): React.JSX.Element {
  const state = checked ? { "data-checked": "" } : { "data-unchecked": "" };
  return (
    <span data-slot="switch" className={SWITCH_TRACK} {...state} aria-hidden="true">
      <span className={SWITCH_THUMB} {...state} />
    </span>
  );
}
