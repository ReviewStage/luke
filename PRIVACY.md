# Privacy

Last updated: 23 August 2026

Luke is a macOS app that watches your coding agent sessions. This policy
explains what we collect, who we send it to, and how to turn it off.

## What we collect

**On your Mac.** Luke reads the session files your coding agents already write,
using the session title, status, repository, branch, model, current tool,
errors, and the summary the agent wrote. It does not read message history, file
contents, or command output, and it writes none of this to disk. It stays on
your Mac unless a feature below sends it.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. We also keep the records that keep you
signed in, and a daily count of how much voice and review you have used.

**Usage data.** We count how Luke's features are used, and attach your name and
email to that record. The counts are event names and values from a fixed list.
Nothing you type or say and nothing from a session can appear in one: no titles,
branches, file paths, summaries, prompts, or error text.

**Screen recordings.** Luke records what his own panel draws, and never your
screen, your editor, your terminal, or any other app. A recording shows whatever
the panel showed you, including session titles, branches, summaries and error
text, your name and email address, and any screenshot you attached to the
feedback form. Text you type into a field is replaced with blocks before the
recording leaves your Mac, so an API key or a sign-in code you enter is not in
it. While recording is on, Luke also reports what you clicked, including the
text on it, and any error his panel runs into, with its message and code path;
the fixed list above does not cover those two.

Usage data and recording are both on by default, with their own switches in
Settings. Turning off Record my screen in Luke leaves the counts on; turning off
Share usage data stops everything in these two sections.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached.

## Who we send it to

- OpenAI, for voice and session summaries. A spoken turn sends its audio, a
  typed turn sends your words, and both send the session fields listed above.
  We do not send message history, file contents, or command output, and we ask
  OpenAI not to store the request. Your conversation is kept in memory so it
  carries across calls, and is discarded when you quit Luke.
- Coding agent providers you connect (Conductor, Cursor, Devin, GitHub Copilot,
  Jules, Replicas) and Linear, using the key or account access you supply. For
  Codex cloud tasks and for messaging local Cursor chats, that access is the
  sign-in you already gave the provider's own command-line tool, which Luke runs
  and never reads. Luke reads your sessions or issues, and sends something back
  only when you ask it to, such as a message you wrote or an issue you moved.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data and screen recordings. The counts go through our own
  service; the recordings, and the clicks and errors that ride with them, go
  from Luke to PostHog directly.
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

Your settings, provider API keys, and calendar access stay on your Mac. Keys and
calendar access are encrypted in the macOS Keychain. Your account information is
held by our own service, and usage counts and recordings by PostHog.

## Your choices

- Disconnect any provider, issue tracker, or calendar to stop it being read.
- Delete your OpenAI key to turn voice off.
- Luke does not use your microphone until you start a turn.
- Delete your account from the Account section in Settings. This erases your
  account, your sign-in records, and your usage counts, and asks PostHog to
  erase your usage data and recordings. It does not affect your Google or GitHub
  account, and anything stored only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use your calendar availability only
to hold Luke's spoken announcements while you are in a meeting. It is not
transferred, sold, or used for advertising, and no human reads it.

## Contact

Email founders@stagereview.app with any questions about this policy.
