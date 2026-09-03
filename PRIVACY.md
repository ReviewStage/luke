# Privacy

Last updated: 2 September 2026

Luke is a macOS app that watches your coding agent sessions, with a companion
iOS app for the cloud sessions your account can see. This policy explains what
we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads the session files your coding agents already write,
using the session title, status, repository, branch, model, current tool,
errors, and the tool it is running. It writes none of this to disk. For a
session running on your Mac, Luke also reads a bounded rendering of that
session's own conversation — the end of the transcript file its agent already
writes (up to the last 256 KB), with each message and tool result cut short —
to write himself a one-line phrase saying what the agent is working on,
because a session's title is only its first message and the work usually
moves on. That rendering is read only when Luke is about to speak about that
session, once per announcement, sent to derive the phrase (see below), and
kept nowhere: the phrase travels inside that one announcement and is used to
name the session as Luke speaks about it, then discarded. Nothing else reads
message history, file contents, or command output. If you run
agents inside the Herdr terminal manager, Luke also asks Herdr's own
command-line tool which of those sessions it holds, so their rows can say so;
that read never starts Herdr, reads no terminal output, and sends nothing
anywhere. It stays on your Mac unless a feature below sends it.

**Your conversation with Luke.** Luke keeps the conversation you have with him
— what you typed or said, what he spoke or announced, and the actions he took
at your request — in a file on your Mac, so it is still there the next time you
open him. It holds the 200 most recent entries and nothing older than 14 days,
whichever runs out first, each kept in full so the History tab shows every
word. Only the 20 most recent are carried into a call, and each of those is
capped at 400 characters there. Clearing the History
tab deletes the file as well as the view. Nothing about the conversation is
written on our servers, and a fixture or evidence run keeps no conversation at
all.

**Things Luke remembers about you.** During a conversation you start, Luke may
silently save a concise preference, personal fact, goal, or recurring constraint
that looks useful later. He skips temporary details and uncertain guesses, never
saves credentials, and saves sensitive facts only when you explicitly ask. At
most 32 are stored on your Mac beside your settings and they do not expire. You
can ask Luke what he remembers, correct something, or tell him to forget it.
They are sent to OpenAI with the rest of a conversation's context so Luke can
personalize replies; they are not sent to a coding-agent provider, a tracker, or
our own service, and they are never used to decide anything on your behalf.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. We also keep the records that keep you
signed in, and a daily count of how much voice and review you have used.

**Usage data.** We count how Luke's features are used, on the Mac and in the
iOS app, and attach your name and email to that record. The counts are event
names and values from a fixed list, and each one says which of the two apps it
came from. Nothing you type or say and nothing from a session can appear in
one: no titles, branches, file paths, prompts, or error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. A recording shows whatever
the panel showed you, including session titles, branches and error
text, your name and email address, and any screenshot you attached to the
feedback form. The History tab is blocked from recordings, so neither the words in your
conversation with Luke nor the things he remembers about you are included. Text you type into a field is replaced
with blocks before the recording leaves your Mac, so an API key or a sign-in
code you enter is not in it. While recording is on, Luke also reports what you
clicked, including the text on it; the fixed list above does not cover those
clicks.

Recording starts when Luke opens, before you sign in, so it covers the spoken
introduction on first launch and the signed-out panel. A recording that begins
before you sign in is attached to your account if you sign in while it is
running. One that never reaches a sign-in belongs to nobody, so deleting your
account does not reach it — we have no way to tell it was yours.

**Crash reports.** In ordinary runs, Luke sends Sentry anonymous reports of
unhandled exceptions in its Electron main, preload, and renderer code, along
with anonymous process-session status and native minidumps when an Electron
main, renderer, or GPU process crashes. Sentry's default reports include the
exception message and code path, breadcrumbs, and Electron, operating-system,
runtime, and device context. Luke does not attach your Luke account or user
identity, and does not enable PII collection, tracing, Sentry Replay,
screenshots, profiling, or manual reports of handled errors. Fixture and
evidence runs send no crash reports.

The iOS app records on the same terms: its own screens as screenshots, never
anything else on your device, from the moment it opens, and shows the same
things its screens show — session titles, branches, error text, and
your name and email. A Conductor session's conversation, fetched onto that
session's screen, is masked out of recordings the way the desktop's History
tab is blocked, so those messages reach your phone and nothing else. Text you
type into a field is masked, a message you sent stays masked when it is drawn
back as a chat bubble, and a crash is reported on the next launch with its
message and code path. Unlike the Mac
app, taps are not separately reported with their text — only the recording
itself shows what was pressed. Signing in attaches the running recording to
your account, and signing out starts a fresh anonymous one.

**Provider API keys (server-side vault).** While the "Sync provider keys"
switch in Settings > Connections is on — it starts on — the provider API keys
you entered into Luke on this Mac are kept synced to Luke's hosted service,
for your other Luke devices: a key saved while signed in syncs in the same
press, and Luke re-syncs the stored keys when he starts signed in, when you
sign in, and when the switch turns on. Keys Luke merely reads from your
environment are never synced, and an automatic re-sync happens only for the
account these keys were last synced for — a different account signing in on
this Mac syncs nothing until it saves a key or turns the switch on itself. Turning the switch off deletes every synced
copy from our database while the keys on this Mac stay; deleting a key
deletes its synced copy too, and signed out nothing is ever synced. We store a synced key encrypted in our own
database using AES-256-GCM with a server-only secret. The key is never
returned to any caller: there is no endpoint that reads it back, and no code
path that decrypts it for any purpose other than the observation or acts you
explicitly request through that provider. The server-side use of these keys
ships as a separate feature; this describes only the storage. Every synced key
is deleted alongside your account if you delete that.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached.

## Who we send it to

- OpenAI, for voice and session summaries. A spoken turn sends its audio, a
  typed turn sends your words, and both send the session fields listed above —
  on the Mac app, read locally from your machine; on iOS, drawn from the same
  cloud observation your vault keys already allow (titles, status, repository,
  and branch of your cloud sessions, as described under Provider API
  keys above). We do not send message history, file contents, or command
  output, and we ask OpenAI not to store the request. The one exception is the
  subject phrase above: to derive it, only when Luke is about to announce a
  local session and once per announcement, Luke sends the bounded transcript
  slice of that session and its title — directly to OpenAI on
  your own key if you entered one, otherwise through our service on our key —
  asks OpenAI not to store the request, and our service stores and logs none
  of it either. The phrase that comes back is spoken with that announcement
  and kept nowhere. On the Mac app,
  your conversation and Luke's durable memory are kept on your Mac and sent
  with a call so the conversation carries across calls and across launches; on
  iOS, the conversation is held in memory and discarded when the session
  closes.
  The one voice call that happens before you sign in is the spoken
  introduction on first launch of the Mac app: it sends its own fixed script,
  the titles of the coding agent sessions found on your Mac, and anything you
  say during its practice moment. It plays once, can act on nothing, and our
  service issues its credential without an account — keeping only a hash of
  your network address for that day's rate limit, tied to nobody.
- Coding agent providers you connect (Conductor) and Linear, using the key or
  account access you supply. For Codex cloud tasks, that access is the sign-in
  you already gave the provider's own command-line tool, which Luke runs and
  never reads. The synced-key vault holds Conductor keys only. Luke reads your sessions or issues, and sends something back
  only when you ask it to, such as a message you wrote or an issue you moved.
  If you open a Conductor session's screen in the iOS app, our service also
  reads that session's conversation from Conductor — your own messages and the
  agent's replies, not its tool activity — using the key you synced, and
  passes it to your phone while the screen is open. We store none of it: each
  refresh is a new read, and nothing about the conversation stays on our
  servers after the response is sent.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data and screen recordings, from the Mac and iOS apps
  both. The counts go through our own service; the recordings, desktop clicks,
  and iOS errors that ride with them go from Luke to PostHog directly.
- Sentry, for the anonymous exception, process-session, and native crash reports
  described above.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.

We do not sell your information or use it for advertising. If you connect
nothing, Luke sends nothing to any provider, and reading your local sessions
works with no network connection.

## Our website

tryluke.dev counts page views, presses, and sign-in steps using PostHog, and
records the pages themselves. Anything you type is blurred, and so is the text
of whatever you clicked. Your browser contacts PostHog directly, so PostHog sees
your network address, as it does for the app's recordings.

## Storage

Your settings, your conversation with Luke, the things he remembers about you,
local provider API keys, and calendar access stay on your Mac.
Local keys and calendar access are encrypted in the macOS Keychain. Provider
API keys you sync to the hosted service are stored encrypted in our own
database, as described above. Your account information is held by our own
service, usage counts and recordings by PostHog, and crash reports by Sentry.

## Your choices

- Disconnect any provider, issue tracker, or calendar to stop it being read.
- Delete your OpenAI key to turn voice off.
- Delete any synced provider API key from that provider's row in Settings. Keys
  are also deleted when you delete your account.
- Clear the History tab to delete your stored conversation from your Mac.
- Ask Luke what he remembers, correct a memory, or tell him to forget one.
- Luke does not use your microphone until you start a turn.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, your usage counts, and any provider API keys
  you synced to the hosted service, and asks PostHog to erase your usage data
  and recordings, including the iOS app's. It does not reach a recording that was
  never attached to your account, as described above. Luke stops recording for
  the rest of the session, and starts again the next time you open it or sign
  in. Sentry reporting continues after deletion, and prior anonymous crash
  reports cannot be identified as yours and targeted through account deletion.
  Deleting does not affect your Google or GitHub account, and anything stored
  only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use your calendar availability only
to hold Luke's spoken announcements while you are in a meeting. It is not
transferred, sold, or used for advertising, and no human reads it.

## Contact

Email founders@stagereview.app with any questions about this policy.
