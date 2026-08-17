# Talk to Luke

Luke can answer questions about your sessions by voice or text. Voice remains
off until you connect an OpenAI API key.

## Connect voice

1. Open **Settings · Voice**.
2. Select **Connect** beside OpenAI.
3. Paste an OpenAI API key with access to the Realtime API.

Luke stores the key encrypted through the macOS Keychain. You can disconnect it
from the same page. Disconnecting turns off voice, spoken announcements, and
optional attention review immediately.

## Use the default shortcuts

- Hold `⌥Space` while speaking, then release it to send.
- Tap `⌥Space` in less than a quarter second to leave the microphone turn open;
  tap it again to send.
- Press `⌥Space` while Luke is speaking to interrupt and take the turn.
- Press `⌥L` to open the text composer from any app.
- Press `⌥S` to stop Luke without starting another turn.
- Press Escape to stop or discard a turn while Luke's panel is active.

You can change the talk, ask, and stop shortcuts under **Settings · Keyboard
shortcuts**. Luke shows the shortcut that macOS successfully registered. If a
shortcut is unavailable, choose another one there.

The talk-key helper watches only the configured chord. It does not request
Accessibility or Input Monitoring permission. If the helper cannot run, Luke
uses a press-to-start, press-to-send toggle and reports that behavior in
Settings.

## Microphone permission

macOS asks for microphone access when the first voice conversation connects.
Luke does not open the microphone until you start a turn. To review or revoke
access later, open **System Settings · Privacy & Security · Microphone**. Luke's
Permissions page links to the same location.

## Captions and sound

Turn on captions under **Settings · Voice** to show Luke's words while he
speaks. Captions are temporary and disappear when the reply ends.

When system output is muted or set to zero, Luke shows captions automatically
and displays a volume hint. Luke reads the output device's mute switch and
volume but never changes either one.

The **Quiet Music and Spotify** setting lowers those players during a spoken
exchange and restores their previous volume afterward. Luke never pauses them.

## Spoken announcements

Luke can announce when a session starts waiting, fails, or finishes. Change
this behavior with **Announce when a session needs you** under **Settings ·
Voice**.

Announcements require an OpenAI key. When no conversation is open, Luke uses a
speak-only connection with no microphone track. See [Privacy](../PRIVACY.md)
for the session fields included in an announcement.

## Related documentation

- [Connect providers and Linear](providers.md)
- [Configuration reference](configuration.md)
- [Privacy](../PRIVACY.md)
