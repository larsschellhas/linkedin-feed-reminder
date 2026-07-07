# LinkedIn Feed Reminder

A Firefox extension that helps you stay focused on LinkedIn instead of getting
sucked into endless feed scrolling.

## What it does

- When you open the LinkedIn feed, it asks what you actually want to do there
  and how long you plan to stay (1, 5, or 10 minutes).
- After that time (capped at 5 minutes) a reminder pops up showing how long
  you've actually been in the feed, with a progress ring relative to your
  chosen duration.
- The reminder offers a choice: continue what you stated you wanted to do, or
  close the tab and do something else instead (e.g. take a walk, get a
  coffee). Buttons that keep you on LinkedIn have a short cooldown before
  they become clickable, so you can't just reflexively click through.
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
