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
- Hides the red notification dots LinkedIn puts on nav items that carry no
  actual count (most prominently "Home") — they exist to lure you back into
  the feed even when there's nothing new. Badges showing a real number
  (messages, notifications) are left untouched.

## Installation (temporary, for development/testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click "Load Temporary Add-on…".
3. Select the `manifest.json` file in this repository.

Temporary add-ons are removed when Firefox restarts. For permanent use, see
below.

After changing any file, hit "Reload" on the add-on in `about:debugging`
**and** reload the LinkedIn tab. Reloading the add-on alone leaves
already-open tabs running without a content script until the page itself is
reloaded — which looks exactly like a broken selector and is easy to chase
for a long time.

## Development

No build step is required — the extension ships exactly the files in this
repo. `npm install` pulls in `web-ext` for optional tooling:

- `npm run lint` — lint the extension via `web-ext lint`.
- `npm run start` — run it in a temporary Firefox profile via `web-ext run`.
- `npm run build` — package it into `web-ext-artifacts/`.

See [AGENTS.md](AGENTS.md) for conventions (i18n, coding style, verification
steps) before making changes.

## Publishing

### Automated (listed releases)

1. Bump `"version"` in both [manifest.json](manifest.json) and
   [package.json](package.json) to the same new value, commit, and get it
   merged to `master` (PR review, per [AGENTS.md](AGENTS.md#branching--commits)).
2. Tag `master` and push the tag:

   ```
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

The [publish workflow](.github/workflows/publish.yml) then lints, builds,
and submits the new version to AMO's listed channel via `web-ext sign`,
and attaches the signed `.xpi` to a GitHub release at
`github.com/<repo>/releases/tag/vX.Y.Z`.

**One-time setup**: generate an API key at
[addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/en-US/developers/addon/api/key/)
and store it as two repo secrets (Settings → Secrets and variables →
Actions): `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Paste them without any
extra whitespace/newline — a stray character here fails signing with
`Error decoding signature`, not an obviously credentials-related message.

**What can go wrong / how to react**:

- **Tag/manifest version mismatch** → workflow fails fast on purpose,
  before touching AMO. Fix the version and re-tag.
- **`Error decoding signature` at the sign step** → bad `AMO_JWT_ISSUER` /
  `AMO_JWT_SECRET` secrets (swapped, stale, or has extra whitespace). Not
  a code problem; re-check the secrets.
- **Run times out after ~15 minutes at "Waiting for approval..."** →
  `web-ext sign` polls AMO and gives up after its default timeout. This
  does **not** mean the submission failed — if AMO flagged the version for
  manual review (rather than auto-signing it), review can take far longer
  than 15 minutes. Check the
  [AMO developer dashboard](https://addons.mozilla.org/en-US/developers/addons)
  for the actual status before assuming anything is broken.
- **Re-running a failed attempt for the same version**: if AMO never
  accepted the version (e.g. the run failed before or during signing),
  it's safe to fix the issue and retrigger by deleting and re-pushing the
  same tag:

  ```
  git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
  git tag vX.Y.Z && git push origin vX.Y.Z
  ```

  Once a version has actually been accepted/signed by AMO, its number is
  burned — you can't resubmit it, only bump to the next one.

### Manual self-distribution

Package the extension (`web-ext build` or a zip of this directory) and
have it signed via [addons.mozilla.org](https://addons.mozilla.org/developers/)
as an unlisted add-on, then install the signed `.xpi` file.

## License

MIT — see [LICENSE](LICENSE).
