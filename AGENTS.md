# AGENTS.md

Conventions for working on this repository. Read this before making changes.

## What this is

A Firefox WebExtension (Manifest V3), plain JavaScript, no build step, no
bundler, no framework. It only needs Node/npm for optional dev tooling
(`web-ext` for linting/packaging) — the extension itself ships exactly the
files in this repo, unmodified, straight to Firefox.

## Layout

- [manifest.json](manifest.json) — extension manifest. `name`/`description`
  are localized (`__MSG_extName__` / `__MSG_extDescription__`); update every
  locale file when you change them.
- [content.js](content.js) — all UI/behavior logic, wrapped in a single IIFE,
  injected into `https://www.linkedin.com/*`. This is where almost all
  changes happen.
- [content.css](content.css) — styles for the overlay/prompt/bubble UI
  injected by content.js. Class names are prefixed `lfr-` (LinkedIn Feed
  Reminder) to avoid colliding with LinkedIn's own classes.
- [background.js](background.js) — minimal background script: closes the tab
  on request from content.js (content scripts can't close their own tab) and
  clears the stored session once no LinkedIn tabs are left.
- [_locales/\*/messages.json](_locales/en/messages.json) — one file per
  supported language (15 total; `en` is `default_locale`). All user-facing
  strings (including the manifest name/description) go through here.
- [icons/](icons/) — extension icons, generated sizes 16/32/48/96/128.

## Coding conventions

- 2-space indent, double quotes, semicolons — match the existing style.
- Code identifiers and log/comment structure in English; explanatory
  **comments are written in German** in this file, matching the existing
  convention in content.js/content.css (they explain *why*, not *what*).
  Keep that pattern for new comments.
- Content script stays a single IIFE with module-level `const`/`let`, no
  globals leaked onto `window`.
- **Never use `innerHTML`** for anything that includes translated text
  (`t()` output). Use the `createElement()` helper in content.js (sets
  `textContent`, so it's auto-escaped) or plain `textContent` assignment.
  This is a deliberate XSS guard — don't reintroduce `innerHTML` with
  dynamic content.
- Selectors into LinkedIn's own DOM (see the notification-badge rules in
  content.css and `cleanBaitBadgeAriaLabels` in content.js) should target
  stable anchors (Artdeco design-system classes, SVG icon IDs, `data-*`
  attributes, ARIA attributes) instead of LinkedIn's hashed/generated
  utility classes, which change on every LinkedIn deploy — and can differ
  entirely between desktop and mobile layouts, so verify a selector against
  both before relying on it.
- Prefer a pure CSS rule over JS-toggled classes for hiding LinkedIn's own
  elements: LinkedIn's Ember nav re-creates nodes like the notification
  badge on every SPA rerender, which strips any class a poll loop had set
  and lets it flash back briefly until the next tick. A structural CSS
  selector re-matches every new node automatically, with no polling delay
  and no flash.

## Working against LinkedIn's DOM

Read this before changing a selector — and especially before concluding that
a selector is wrong. Most of it was learned the expensive way.

### LinkedIn ships several frontends at once

The same logged-in account gets structurally different markup depending on
the page and rollout state:

- **Redesign** — hashed, build-dependent class names throughout, no stable
  IDs. The only reliable anchor found so far is `[data-testid="primary-nav"]`.
  "Start" is a `<button>` here while the other nav items are `<a>`, so don't
  put a tag filter in nav selectors.
- **Legacy Voyager** — `#global-nav` plus Artdeco classes
  (`.artdeco-notification-badge`, `.notification-badge__no-count`). Observed
  on `/messaging` and `/notifications`.
- **Mobile ("mwlite")** — a third, unrelated markup, and the only one with
  genuinely stable IDs: `#secondary-nav` (top bar), `#primary-nav` (bottom
  tab bar).

Navigating between pages can switch which variant you get **without a page
reload**. A selector that works right after F5 can stop matching two clicks
later. Handle every variant, and back each measurement with a fallback
constant (nav heights: 52px desktop, 48px mobile).

### Content scripts must run in all frames

LinkedIn renders parts of its UI — including the legacy global nav — inside a
viewport-filling iframe: `<iframe data-testid="interop-iframe"
src="/preload/?_bprMode=vanilla">`. Content scripts default to the top frame
only, so anything targeting that nav silently does nothing there. Hence
`"all_frames": true` in the manifest.

The flip side: **session state, timers and the lock overlay must stay
top-frame-only** — that's the `isTopFrame` guard in content.js. Without it
every subframe builds its own lock and reminder overlay and competes for the
same session. When adding behavior to content.js, decide explicitly which
side of that line it belongs on.

### Debugging protocol

When something "doesn't work", establish in *this* order whether:

1. the content script is live in the document you're looking at —
   `document.documentElement.dataset.lfr === "1"` (set by content.js);
2. the CSS is applied — append a throwaway `<div class="lfr-bubble">` and
   check `getComputedStyle(...).position === "fixed"`;
3. the selector matches — `element.matches(...)`.

Jumping straight to (3) is a trap: DevTools switches the console context to
the iframe the moment you inspect an element inside it, so the same snippet
returns contradictory results depending on which frame it ran in. An entire
debugging session went into rewriting selectors that were fine all along,
while the real cause was step (1).

### Traps found the hard way

- `.artdeco-notification-badge` is **not** the red dot. It's the
  `position: relative` wrapper shared by the dot *and* the icon — hiding it
  hides the whole nav icon. Target the inner `<span class="notification-badge">`.
- CSS `:empty` does not match an element containing whitespace (Firefox
  implements the Level 3 behavior). Pseudo-elements don't count as children
  though, so a dot drawn via `::after` still leaves its host `:empty`.
- Reloading the temporary add-on does **not** re-inject into already-open
  tabs — they keep running without a content script until the page itself is
  reloaded. Manifest changes need an add-on reload *and* an F5.

## Shared state / cross-tab behavior

Session state (chosen duration, next reminder time) lives in
`browser.storage.local` under one key and is synced across all LinkedIn tabs
via `storage.onChanged` — opening a second feed tab adopts the running
session instead of starting a fresh one. When touching the session
lifecycle in content.js, keep this cross-tab sync intact: don't reintroduce
purely in-memory, per-tab-only state for anything the user perceives as
"the timer".

Because that state is persistent, it also has to be cleaned up: background.js
clears it on `tabs.onRemoved` once no LinkedIn tab is left, and again on
`runtime.onStartup`. Without the startup path a session survives a browser or
PC restart and the next LinkedIn visit opens straight into the reminder
overlay instead of the intent prompt. Note that MV3 background scripts are
**not persistent** — they can be terminated between events, so never rely on
a `setTimeout` there surviving; register listeners at top level and do the
work synchronously inside them.

## i18n

- Every user-facing string must go through `_locales/*/messages.json` and
  the `t(key)` helper — no hardcoded UI text in content.js.
- **When adding or changing a message key, update all 15 locale files**,
  not just `en`/`de`. Missing keys silently fall back to the key name via
  `t()`, which is easy to miss visually.
- `manifest.json`'s `name`/`description` are localized too
  (`__MSG_extName__`/`__MSG_extDescription__`); update every locale file's
  `extName`/`extDescription` alongside any manifest description change.

## Versioning

Bump `"version"` in [manifest.json](manifest.json) (and matching
`"version"` in [package.json](package.json)) for any user-facing change
(new behavior, fixed bug, new permission). Publishing to AMO is triggered by
pushing a `vX.Y.Z` tag that matches the manifest version — see
[README.md#publishing](README.md#publishing).

## Releasing (agents: read before tagging)

The [publish workflow](.github/workflows/publish.yml) submits directly to
AMO's listed channel — pushing a `vX.Y.Z` tag is a real, outward-facing
release, not a dry run. Treat it accordingly:

- **Confirm with the human before pushing a release tag**, and again before
  deleting/re-pushing one — don't chain it automatically onto a merge.
- The tag must match `manifest.json`'s `"version"` exactly (the workflow
  verifies this and fails otherwise) and must not already exist on AMO —
  check the current published version if unsure rather than assuming.
- Deleting and re-pushing the *same* tag is only safe to retrigger a run
  that failed **before** AMO accepted the version (bad secrets, workflow
  bug, etc.). Once AMO has actually signed a version, that number is
  burned; bump to the next one instead.
- A run stuck at "Waiting for approval..." past ~15 minutes is not
  necessarily broken — AMO may have queued it for manual review, which
  this repo's usual patch/minor updates rarely trigger but can't rule out.
  Check the [AMO developer dashboard](https://addons.mozilla.org/en-US/developers/addons)
  before concluding the workflow failed.
- The workflow has no `package-lock.json` to work with (none is committed
  — see "What this is" above), so it uses `npm install`, not `npm ci`. Keep
  it that way unless a lockfile gets deliberately introduced.
- Full troubleshooting notes (credential errors, timeout behavior, retrigger
  steps) live in [README.md#publishing](README.md#publishing) — read that
  before improvising a fix.

## Verifying changes

There is no automated test suite. Before submitting a change:

1. `npm install` once, then `npm run lint` (`web-ext lint`) to catch
   manifest/WebExtension issues.
2. Load it as a temporary add-on: open `about:debugging#/runtime/this-firefox`
   in Firefox → "Load Temporary Add-on…" → select `manifest.json`.
3. Manually exercise the flow on `https://www.linkedin.com/feed/`: intent
   prompt, duration cooldown, reminder overlay, continue/walk/coffee
   actions, and (if touched) the cross-tab bubble by opening a second feed
   tab.
4. For anything touching LinkedIn's own DOM, navigate **between** pages
   (feed → messaging → notifications) without reloading, not just F5 on one
   page — that's what switches the nav variant and moves it in and out of
   the interop iframe. A change that looks fine on a freshly loaded feed
   regularly falls apart two clicks later.

After editing files, reload the add-on in `about:debugging` **and** reload
the LinkedIn tab; the add-on reload alone leaves open tabs without a content
script.

## Branching / commits

- Branch off `master` for changes; don't commit directly to `master`.
- Commit messages: short, imperative, present tense (matches existing
  history, e.g. "Fix AMO validation issues").
