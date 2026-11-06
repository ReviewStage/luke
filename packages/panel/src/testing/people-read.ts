/**
 * people-read.ts -- a test's surface drawn under a member directory, and the wait until that directory has read the workspace's people.
 *
 * The members the host lays reach their query a tick after they land
 * (`live-reads.ts`), so a test that reads a face or a name the directory
 * gives waits on the directory itself rather than on the words it draws,
 * which a surface may draw the same either way.
 */

import { createElement, Fragment, type ReactElement, useEffect } from "react";
import { assert, vi } from "vitest";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";

/** Whether the directory the test last drew under has read the workspace's people, its read answered or refused. */
let read = false;

/** Tells the test whether the directory it stands under has read the workspace's people. */
function PeopleRead(): null {
  const { reading } = useMemberDirectory();
  useEffect(() => {
    read = !reading;
  }, [reading]);
  return null;
}

/** `children` under a member directory, as `MemberDirectory` takes them, beside the mark `peopleRead` waits on. */
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

/** Waits until the directory drawn by `withPeopleRead` has read the workspace's people. */
export function peopleRead(): Promise<void> {
  return vi.waitFor(() => assert.isTrue(read));
}
