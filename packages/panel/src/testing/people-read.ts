import { createElement, Fragment, type ReactElement, useEffect } from "react";
import { assert, vi } from "vitest";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";

let read = false;

function PeopleRead(): null {
  const { reading } = useMemberDirectory();
  useEffect(() => {
    read = !reading;
  }, [reading]);
  return null;
}

export function withPeopleRead(
  props: Omit<React.ComponentProps<typeof MemberDirectory>, "children">,
  children: ReactElement,
): ReactElement {
  read = false;
  return createElement(MemberDirectory, {
    ...props,
    children: createElement(Fragment, null, createElement(PeopleRead), children),
  });
}

export function peopleRead(): Promise<void> {
  return vi.waitFor(() => assert.isTrue(read));
}
