# Privacy

Effective date: November 5, 2026

## 1\. Introduction

Stage Inc., a Delaware corporation ("we," "us," or "our"), operates the
vespin.dev website, the Vespin Mac app, the Vespin web app, and the hosted
service behind them (collectively, the "Service"). Vespin is an inbox for all
your coding agents. This Privacy Policy explains how we collect, use,
disclose, and safeguard your information when you use the Service.

By using the Service, you agree to the collection and use of information in
accordance with this policy.

## 2\. Information we collect

### Account information

When you sign in with Google or GitHub, we collect your name, email address,
profile picture address, and which provider you used. We also store the
records that keep you signed in, each with the IP address and browser or app
it came from, and a daily count of your dictation use. Signing in with GitHub,
or linking GitHub later, authorizes the Vespin GitHub App; we store its
OAuth tokens encrypted on the Service and never send them to your Mac or
browser.

### Workspaces, tasks, and plans

Every account gets a first workspace, and you can create or join others.
Members of a workspace see each other's names, email addresses, and roles.
Owners and admins can invite people by email, upload a workspace photo, and
connect a GitHub App installation. Within a workspace we store each task's
name, its plan (a Markdown document written by members and agents) with its
full revision history, comments on the plan, inbox items and their answers,
pages that agents make, pictures and short videos added to any of these, and,
if the Memory experiment is on, short facts agents save about how your team
works. Every member of the workspace can see all of this.

### Agent conversations

For each turn an agent runs, we store your message, any files you attach, the
agent's reply and reasoning summaries, each tool call with its input and
output, and the model, token counts, and timing. Tool output can include files
from your repository, command output, web pages, screenshots of the agent's
browser, and answers from your integrations. Transcripts and plans are stored
as written, not end-to-end encrypted, and our operators can read them.

### Repository and GitHub data

Through your workspace's GitHub App installation, we access repository
contents, pull requests, code diffs, review comments, checks, and issues for
repositories where the App is installed. Each agent works on a checkout of the
repository in its own Vercel Sandbox. We generally do not keep copies of
repository content apart from what lands in an agent's transcript, except a
pull request's number, title, state, and checks, and any chapters you
generate for it.

### Credentials you save

If you save an Anthropic or OpenAI API key, a GitHub personal access token, or
sign in with your ChatGPT plan, we store it encrypted with AES-256-GCM under a
per-credential key that is itself encrypted with a server-only secret held
outside the database. We keep a short hint (such as `sk-ant-…abcd`) and
whether the provider accepts it. We never send a saved credential back to your
device, log it, or include it in analytics, error reports, or screen
recordings.

### Integrations and connected apps

If you connect an integration (such as Linear, Notion, Sentry, Slack, Gmail,
Google Calendar, Google Drive, Granola, Mercury, Neon, PostHog, Resend, Stripe,
Supabase, Vercel, Y Combinator, or Executor), Vercel Connect stores its token
for your account, encrypted, and we keep the connection's state and a display
name. While connected, your agents can read and change whatever your grant at
that service allows, without asking you first, and everything the service
answers, which can include other people's messages or credentials it hands
out, goes to the agent's model and into its transcript. If your workspace
connects Vespin's Slack bot, we store your Slack user id, and messages you send
the bot, with the earlier messages of that Slack thread, are handed to an
agent. If you allow an app such as Claude Code or Cursor to connect to our MCP
server, we store a record of the app, your consent, and hashed tokens.

### Commands on your Mac

If you allow it in Settings › This Mac, agents can run shell commands on your
Mac as your macOS user, with access to everything you can reach. The command,
its exit code, and up to 20,000 characters each of its output and errors are
returned to the agent, stored in its transcript, and sent to the agent's model
provider. **This output is not redacted**: if a command prints a password,
token, key, or file contents, that goes too.

### Agents on your own machines

If you turn on Bring your own host, agents can run directly on This Mac or on
another machine you add, with full access to everything that machine's account
can reach. Their work stays on that machine, though their transcripts are
stored like any other. To tell your machines apart, each sends us a keyed hash
of its hardware or machine id, never the id itself, and a Mac sends its model
name.

For a repository the Vespin GitHub App reaches, an agent on your machine gets
a GitHub token from us that lasts an hour and works only for that repository.
For a repository reached only on your own GitHub token, we never send that
token to your Mac. Instead, the agent uses the GitHub sign-in already set up on
that Mac for its account: your `gh` login, your Git credential helper and
settings, and your SSH keys and SSH agent. **Such an agent acts as whoever is
signed in on that Mac, with every repository and permission that sign-in has,
not just the task's repository.** Such an agent runs only on a Mac, never on
another machine you add. Before it starts, it checks that the
sign-in reaches the repository. If it doesn't, the agent doesn't start, and its
transcript says to sign in with `gh auth login` or set up SSH.

### Usage data and screen recordings

The Mac app and the web app send counts of which features you use, from a
fixed list of event names and values, under your account's name and email.
They never include anything you type or say, titles, branches, file paths,
prompts, or error text. The Service counts work done through it (such as
tasks created and agents started) the same way. Counts are grouped by
workspace, with each workspace's name and creation date.

While you are signed in, the Mac app and the web app record how you use
Vespin's window, such as the screens you visit and where you click, never your
screen or other apps. Text you type and other content that may be sensitive is
masked before a recording leaves your device. Recordings are linked to your
account. While a maintainer is signed in as your account with your support
access (section 4), their use of the web app is counted and recorded the same
way, under your account.

### Error and performance data

The Mac app, the web app, and the Service send Sentry error reports, crash
reports, reports of the errors Vespin shows you, and performance traces for a
sample of launches and page loads. They use Sentry's default data collection,
so reports may include error messages, stack traces, request addresses and
headers, device details, and your IP address. Sentry replaces values whose
names look like credentials, and Vespin removes query parameter values and
token-shaped parts of addresses. Reports name your account by its id only. The
Service does not send Sentry what was sent to or returned by a model, though an
error's own words can quote what an agent was working on.

For about one launch in twenty, the Mac app also sends Sentry performance
profiles of its windows for as long as they are open: which of the app's own
functions were running, by name and file, sampled many times a second. A
profile holds no words you or an agent wrote.

### Feedback

If you send feedback, we receive your words, any screenshots you attach, and,
unless you untick it, your name and email.

### Information stored on your Mac

The Mac app keeps its window layout and the drafts of messages you have not
sent. While you are signed in, it also keeps a copy of your workspaces' lists
and changes you made offline in one file, `entities.sealed`, encrypted under a
key in the macOS Keychain and deleted when you sign out. Your sign-in
tokens are kept encrypted the same way. Transcripts and pictures you
open are held in memory only.

## 3\. Legal basis for processing

We process your personal information on the following legal bases, as
applicable under the EU General Data Protection Regulation (GDPR) and similar
laws:

- **Contractual necessity:** processing required to provide the Service,
  manage your account, and run your agents.
- **Legitimate interest:** processing for security, error monitoring, abuse
  prevention, and improving the Service, where these interests are not
  overridden by your rights.
- **Consent:** processing based on your consent, such as connecting an
  integration, letting agents run commands on your Mac, or sharing usage data.
  You may withdraw consent at any time.
- **Legal obligation:** processing necessary to comply with applicable laws
  and regulations.

## 4\. How we use your information

- Provide, operate, and maintain the Service
- Run your agents and the models they use, on your own keys
- Authenticate your identity and manage your account and workspaces
- Send workspace invitations and the Slack messages your workspace asked for
- Monitor and analyze usage to improve the Service
- Detect, prevent, and address technical issues and security threats
- Comply with legal obligations

Our operators can read what the Service stores. Vespin's maintainers also have
an admin page showing each account's name, email, activity counts, workspaces
and members, agents' status and models, and which providers and integrations
are connected. A maintainer may sign in to the web app as your account only
while you have granted support access from Settings. A grant lasts seven days
and you can revoke it at any time, which also ends any such sign-in under way;
each sign-in lasts up to an hour. While signed in as you, a maintainer sees and
can do what you can in the web app.

We do not use your code or conversations to train AI models.

## 5\. Data sharing and disclosure

We do not sell your personal information or use it for advertising. We share
data with:

- **AI providers:** your agents, web search, dictation, titles, and pull
  request chapters run on Anthropic or OpenAI, always on the API key or
  subscription you saved, never ours. Each call carries what the model needs,
  such as the plan, the conversation, attached files, and what the agent read.
  These providers process it under their own policies.
- **GitHub:** to check out repositories, push branches, and open pull requests
  through the Vespin GitHub App. Your devices also contact GitHub directly to
  check for updates and load avatars.
- **Infrastructure providers:** Vercel (hosting, agent sandboxes, and Vercel
  Connect, which holds integration tokens), Neon (database), PostHog (usage
  data, screen recordings, and feedback), Sentry (error and performance
  monitoring), Resend (email), and Slack (feedback and Vespin's Slack bot).
- **Integrations and connected apps:** the services and MCP clients you connect
  receive what your agents send them, or what our tools answer, and keep it
  under their own policies.
- **Workspace members:** data within a workspace is visible to its other
  members.
- **Legal requirements:** we may disclose information if required by law,
  regulation, or legal process.

## 6\. Data storage and security

Your data is stored on servers provided by our infrastructure partners: our
database is hosted by Neon, and agents' checkouts and session files live in
Vercel Sandboxes and in snapshots kept for up to thirty days after last use.
We use encryption in transit (TLS), encrypt saved credentials as described
above, and keep the tokens agents use outside their sandboxes, adding them at
the sandbox's network firewall. Transcripts, plans, and other content are not
end-to-end encrypted.

While we strive to protect your information, no method of electronic storage
or transmission is 100% secure, and we cannot guarantee absolute security. In
the event of a data breach affecting your personal information, we will notify
affected users and relevant authorities as required by applicable law.

## 7\. Data retention

We retain your data for as long as your account is active and as needed to
provide the Service. Deleting a task deletes it at once with its history,
pages, inbox items, and pictures; its agents' transcripts and sandboxes are
removed seven days later. When you delete your account:

- **Account data** (profile, sessions, OAuth tokens, saved credentials,
  preferences, and integration records) is deleted at once.
- **Your tasks, plans, transcripts, and inbox items** are deleted at once, and
  your agents' sandboxes shortly after.
- **Workspaces you own**, and the memories, comments, and plan text you left in
  them, stay with the workspace without your name.
- **Usage data and screen recordings:** we ask PostHog to erase them; if it
  cannot be reached, your account is deleted anyway and PostHog keeps them.
- **Error reports** already sent to Sentry are kept until Sentry's retention
  ends, since Sentry offers no way to erase one account's reports.
- **Integrations:** we ask Vercel Connect to revoke your grants; anything your
  agents already did at those services stays there.

## 8\. Your rights and choices

Depending on your jurisdiction, you may have the right to:

- Access the personal data we hold about you
- Request correction of inaccurate data
- Request deletion of your data
- Object to or restrict processing of your data
- Request a copy of your data in a portable format
- Withdraw consent at any time

To exercise any of these rights, contact us at founders@vespin.dev. You
can also act directly in the app:

- **Usage data:** turn off Settings › Account › "Share usage data". It is set
  per Mac and per browser, is on by default in the Vespin you download, and
  does not stop the counts the Service makes of work done through it.
- **Commands on your Mac:** set Settings › This Mac › "Let agents run commands
  on this Mac" to Never.
- **Integrations:** switch one off for a single agent in its message box's MCP
  menu, or disconnect it in Settings › Integrations. Revoke connected apps in
  Settings › MCP › Agents with access.
- **GitHub:** revoke the Vespin GitHub App in GitHub's settings under
  Applications.
- **Delete your account** in Settings › Account.

## 9\. Cookies and tracking

The web app uses a session cookie to keep you signed in. vespin.dev uses
PostHog to count page views, clicks (by what was clicked and where, never the
words on it), and sign-in steps, and to record its pages, except the sign-in
pages; recordings mask what you type into fields. Before anything leaves your
browser, the site removes sign-in codes, tokens, and similar values from every
address. It collects nothing else, regardless of our PostHog project's
settings: no errors, console output, network requests, timings, heatmaps,
surveys, chat widgets, or feature flags. When you finish signing in, the site
links your visits to your account's id, name, and email.

Your browser sends this data to a path on vespin.dev, which passes it on to
PostHog without the site's cookies. PostHog receives your IP address and user
agent; our project is set to discard IP addresses. Vespin in a browser
(vespin.dev/app) records and reports as the Mac app does, and sends Sentry
reports directly from your browser.

## 10\. Third-party services

The Service connects to third-party services you choose, including GitHub,
your model providers, and any integrations you connect. We are not responsible
for the privacy practices of these third parties, and we encourage you to
review their privacy policies.

## 11\. Children's privacy

The Service is not intended for individuals under the age of 18. We do not
knowingly collect personal information from children. If we learn we have
collected data from a child under 18, we will delete it promptly.

## 12\. California privacy rights (CCPA/CPRA)

If you are a California resident, you have additional rights under the
California Consumer Privacy Act (CCPA) and the California Privacy Rights Act
(CPRA):

- **Right to know:** you may request details about the categories and specific
  pieces of personal information we have collected about you.
- **Right to delete:** you may request deletion of your personal information,
  subject to certain exceptions.
- **Right to correct:** you may request correction of inaccurate personal
  information.
- **Right to opt out of sale or sharing:** we do not sell or share your
  personal information as defined under the CCPA/CPRA.
- **Right to non-discrimination:** we will not discriminate against you for
  exercising any of these rights.

To exercise these rights, contact us at founders@vespin.dev. We will
verify your identity before processing your request.

## 13\. International data transfers

Your information may be transferred to and processed in countries other than
your own, including the United States. We rely on Standard Contractual Clauses
(SCCs) and other legally recognized transfer mechanisms to ensure your data is
protected when transferred internationally. Our service providers are
contractually obligated to protect your information in accordance with this
policy.

## 14\. Google user data

Vespin's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. We use what Google returns when you
sign in with it, your name, email address, and profile picture, only to
identify your account. What Gmail, Google Calendar, and Google Drive answer an
agent, where you connect them, is used only for the work you or your
automations ask that agent to do: it goes to the model that agent runs on and
into the agent's transcript, which is kept as every transcript is. Agents can
read and label mail and write drafts but never send mail. None of it is
transferred or sold, used for advertising, or used to train or improve any AI
or machine-learning model, ours or anyone's, and no person at Vespin reads it
unless you ask us to, for security, or where the law requires it.

## 15\. Changes to this policy

We may update this Privacy Policy from time to time. We will notify you of
material changes by posting the new policy on this page and updating the
effective date. Your continued use of the Service after changes constitutes
acceptance of the updated policy.

## 16\. Governing law

This Privacy Policy is governed by and construed in accordance with the laws
of the State of Delaware, United States, without regard to its conflict of law
provisions.

## 17\. Contact us

If you have questions about this Privacy Policy, please contact us at
founders@vespin.dev.
