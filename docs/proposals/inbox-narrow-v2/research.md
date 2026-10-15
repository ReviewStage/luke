# Research: a list and its item when there is room for one column

Gathered on 2026-10-15 for `docs/proposals/inbox-narrow-v2.md`. Where a
source could not confirm a behavior, this says so instead of guessing.

## Products

**Linear, Inbox.** On desktop the Inbox is a list. Opening a notification
shows its issue in an Inbox view where you can act on it. J/K and ↑/↓ step
between notifications "while on the list or individual notification view",
so you move to the next one without going back to the list. Backspace
deletes and H snoozes. The two-column layout (list left, issue right)
arrived in 2021. Mobile is "tap to take action, swipe to delete, snooze to
deal with it later". *Not confirmed:* what the desktop Inbox does at a
narrow width.
<https://linear.app/docs/inbox>, <https://linear.app/mobile>,
<https://linear.app/changelog/2026-09-03-priority-inbox>

**Slack, Activity.** Since January 2026 Activity is one feed with two
layouts: Detailed ("full previews of messages") and Dense (for scanning).
↑/↓ move through it, Enter replies, C clears, R marks read, and a swipe
clears on mobile. Detailed puts enough of each message in the feed that a
short feed needs no second page. *Not confirmed:* whether Enter answers in
the feed or opens the thread.
<https://slack.com/help/articles/46751260742035>

**GitHub, notifications.** A notification opens its conversation page,
whose top bar offers Done, Unsubscribe, Mark read, Save, and "Return to
your notifications inbox", with E, Shift+U/I and Shift+M as shortcuts.
GitHub documents no next-notification key and no "1 of N" pager, so Done
leaves you on the page and the way on is back through the inbox (userscripts
exist to close the tab). Primer's SplitPageLayout hides its pane under 768px
and gives no list-detail rule for that width.
<https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/triaging-a-single-notification>,
<https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts>,
<https://primer.style/product/components/split-page-layout>

**Superhuman.** Opening a conversation fills the window. Auto-advance (⌘K,
"auto advance") decides where Done lands: the older conversation, the
newer one, or the list. Superhuman's own guidance is that returning to the
list "reduces throughput the most". J/K step between conversations without
the list. *Not confirmed from a page:* that its reading view is a single
column (the help center answered 403); that comes from use of the product.
<https://new.superhuman.com/customize-auto-advance-105068>,
<https://blakecrosley.com/guides/design/superhuman>

**Things 3.** A to-do opens in place: its row unfolds into a card holding
its notes, checklist and dates, the rows around it moving apart, and
Return or ⌘Return closes it again. Cultured Code describes to-dos as shown
and edited "both inside lists and when you expand them". *Not confirmed
from a page:* the exact card contents. That comes from use of the app.
<https://culturedcode.com/things/>,
<https://culturedcode.com/things/support/articles/2785159/>

**Apple Mail.** On the Mac you choose the layout (View › Use Column Layout,
Show Side Preview or Show Bottom Preview). The older "classic layout" put
the message under the list, the stacked shape of option (c). On iPhone
(compact width) Mail shows the list or a message, never both, and the
message's toolbar has up and down arrows for the previous and next message,
which iPad's split view drops because the list is on screen. The arrows
come from forum reports rather than Apple's own pages.
<https://support.apple.com/guide/mail/mlhlc18e666f/mac>,
<https://forums.macrumors.com/threads/email-on-ios-10-where-are-next-prior-email-buttons.1996856/>

## Design systems

**Android / Material canonical layouts.** At compact and medium widths a
list-detail layout shows "either the list or the detail… selection of a
list item displays the detail in place of the list", and Back shows the
list again. When an expanded window narrows, "the detail pane remains
visible and the list pane is hidden". It says nothing about a list holding
only one item.
<https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts>

**Apple, UIKit.** A collapsed `UISplitViewController` becomes a navigation
stack, and the app chooses which column stands when it collapses (WWDC 2020,
"Build for iPadOS with UISplitViewController").
<https://developer.apple.com/videos/play/wwdc2020/10105>

**PatternFly, primary-detail.** On narrow screens only the primary or the
detail shows, and the detail slides in over the primary.
<https://www.patternfly.org/patterns/primary-detail/design-guidelines>

## What it adds up to

- **One column is a stack, not a split.** Material, UIKit, PatternFly and
  iPhone Mail all show the list or the item. The Inbox has done this since
  #2680, but it starts on the list.
- **When a window narrows with an item open, the item stays.** That is
  Material's rule and UIKit's default. Today's Inbox goes back to the list.
- **No source covers a list of one or two.** None says "open the only item".
  The nearest answer is Slack's Detailed feed and Things' expanding rows,
  which put enough of each item in the list that a short list needs no
  second page. Whatever we do here is our own call.
- **You move between items with keys first and buttons second.** J/K work in
  Linear's and Superhuman's item views, ↑/↓ in Slack's feed, and iPhone Mail
  shows next/previous arrows only because its list is hidden. GitHub has
  neither and sends you back to the inbox.
- **After you finish an item, apps move you on rather than back.**
  Superhuman's auto-advance can be set to the older item, the newer one, or
  the list, and Superhuman ranks going back to the list worst.
- **Expand in place suits a short item. A page suits a long one.** Things and
  Slack's Detailed feed expand in place. Linear, GitHub, Mail and Superhuman
  open a page, because an issue, a PR or a thread is long. An Inbox item is
  in between: usually a question and three options, but sometimes a code
  card, an image, or a form.
