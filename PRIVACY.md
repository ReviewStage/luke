# Privacy

Last updated: 21 August 2026

Luke is a macOS app that watches your coding agent sessions. This policy
explains what we collect, who we send it to, and how to turn it off.

## Information we collect

**On your Mac.** Luke reads the session files your coding agents already write.
It uses the session title, status, repository, branch, model, current tool,
errors, and the summary the agent wrote. It does not read message history, file
contents, or command output while observing, and it does not write any of this
to disk. This information stays on your Mac unless a feature below sends it.

**Your account.** Signing in with Google or GitHub gives us your name, email
address, and which of the two you used. We also keep the records needed to keep
you signed in, and a daily count of how much voice and review you have used.

**Usage data.** We count how Luke's features are used. This is on by default,
and you can turn it off under Share usage data in Settings. The counts are
event names and values from a fixed list. Nothing you type or say, and nothing
from a session, can appear in one: no titles, branches, file paths, summaries,
prompts, or error text. Your name and email are attached to your usage record,
so the counts belong to an account rather than to an anonymous identifier.

**Feedback.** If you use the feedback form, we receive what you typed, the name
and email you signed it with, and any screenshots you attached.

## Who we send it to

- OpenAI, for voice and session summaries. A spoken turn sends its audio and a
  typed turn sends your words. Both also send the session fields listed above.
  We do not send message history, file contents, or command output, and we ask
  OpenAI not to store the request. Luke keeps your conversation with it in
  memory so it carries across calls, and sends it again when you open the next
  one. It is never written to disk and is discarded when you quit Luke.
- Coding agent providers you connect (Conductor, Cursor, Devin, GitHub Copilot,
  Jules, Replicas) and Linear, using the key or account access you supply — for Codex
  cloud tasks and for messaging local Cursor chats, that access is the sign-in
  you already gave the provider's own command-line tool, which Luke runs and
  never reads. Luke reads your sessions or issues, and sends something back
  only when you ask it to, such as a message you wrote or an issue you moved.
- Google, if you connect Google Calendar. We request your calendar list and your
  availability. Google returns busy times only, so event titles and attendees
  are never available to Luke.
- PostHog, for usage data, sent through our own service.
- GitHub, to check for updates. These requests are unauthenticated and carry
  nothing about you.

We do not sell your information or use it for advertising.

If you connect nothing, Luke sends nothing to any provider, and reading your
local sessions works with no network connection.

## Our website

tryluke.dev counts page views and sign-in steps using PostHog. Unlike the app,
your browser contacts PostHog directly, so PostHog sees your network address, as
it would with any third-party script.

## Storage

Your settings, provider API keys, and calendar access stay on your Mac. Keys and
calendar access are encrypted and stored in the macOS Keychain.

Your account information is held by our own service. Usage counts are held by
PostHog.

## Your choices

- Turn off Share usage data in Settings to stop usage data.
- Disconnect any provider, issue tracker, or calendar to stop it being read.
- Delete your OpenAI key to turn voice off.
- Luke does not use your microphone until you start a turn.

## Deleting your data

You can delete your account from the Account section in Settings. This erases
your account, your sign-in records, and your usage counts, and asks PostHog to
erase your usage data. It does not affect your Google or GitHub account, and
anything stored only on your Mac stays there until you remove it.

## Google user data

Luke's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use your calendar availability only
to hold Luke's spoken announcements while you are in a meeting. It is not
transferred, sold, or used for advertising, and no human reads it.

## Contact

Email founders@stagereview.app with any questions about this policy.
