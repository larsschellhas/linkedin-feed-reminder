# LinkedIn Feed Reminder

A Firefox extension that helps you stay focused on LinkedIn instead of getting
sucked into endless feed scrolling.

## What it does

- When you open the LinkedIn feed, it asks how long you plan to stay (1, 5,
  or 10 minutes).
- After that time (capped at 5 minutes) a reminder pops up showing how long
  you've actually been in the feed, with a progress ring relative to the
  time you've granted yourself.
- The reminder's main action closes the tab, paired with a randomly picked
  suggestion (take a walk, grab a coffee, drink some water, stretch,
  breathe). Below that: quick links to less distracting LinkedIn pages
  (Notifications, Messages, your profile), and — de-emphasized at the
  bottom — the option to extend by 1/5/10 more minutes. Buttons that keep
  you on LinkedIn have a cooldown before they become clickable (longer for
  longer extensions), so you can't just reflexively click through.
- The session keeps running in the background while you browse other
  LinkedIn pages: a small, non-interactive status bubble shows the
  remaining time and fades out in its final seconds — no alert, no link
  back to the feed. Returning to the feed brings the reminder straight back
  if time has run out in the meantime; if time ran out while you were away,
  the session ends and you're asked fresh next time you open the feed.
- The running session is shared across all LinkedIn tabs, so opening a
  second feed tab adopts the same countdown instead of resetting it.
- Opening a single post from a notification (a `?highlightedUpdateUrn=...`
  link) gets a brief grace period before it's treated as regular feed
  browsing.
- Available in 15 European languages (auto-detected from your browser
  language, with English as fallback).
- Hides the red notification bubble LinkedIn shows on the "Home" nav item,
  which is designed to lure you back into the feed even without new content.

## Installation (temporary, for development/testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on…".
3. Select the `manifest.json` file in this repository.

Temporary add-ons are removed when Firefox restarts. For permanent use, see
below.

## Development

No build step is required — the extension ships exactly the files in this
repo. `npm install` pulls in `web-ext` for optional tooling:

- `npm run lint` — lint the extension via `web-ext lint`.
- `npm run start` — run it in a temporary Firefox profile via `web-ext run`.
- `npm run build` — package it into `web-ext-artifacts/`.

See [AGENTS.md](AGENTS.md) for conventions (i18n, coding style, verification
steps) before making changes.

## Publishing

- **Self-distribution**: package the extension (`web-ext build` or a zip of
  this directory) and have it signed via
  [addons.mozilla.org](https://addons.mozilla.org/developers/) as an unlisted
  add-on, then install the signed `.xpi` file.
- **Public listing on AMO**: submit the same package for review as a listed
  add-on so it's discoverable and installable directly from
  addons.mozilla.org.

## License

MIT — see [LICENSE](LICENSE).
