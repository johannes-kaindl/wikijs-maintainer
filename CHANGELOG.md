# Changelog

All notable changes to this plugin. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning according to [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- **The page description now comes from the frontmatter field `description`, with `summary` as a fallback.** `description` is the field name Wiki.js itself uses, so a vault pulled from an existing wiki keeps its descriptions on the next push instead of losing them. A note with both fields uses `description`; notes that only use `summary` behave as before.

### Changed

- **The page description now comes from the frontmatter field `description`, with `summary` as a fallback.** `description` is the field name Wiki.js itself uses, so a vault pulled from an existing wiki keeps its descriptions on the next push instead of losing them. A note with both fields uses `description`; notes that only use `summary` behave as before.

## [0.3.2] — 2026-10-12

### Changed

- Kit vendoring raised from `obsidian-kit` 0.45.1 to 0.57.0 and from `code-kit` 0.8.0 to 0.24.0 (`secrets` now comes from `code-kit`). Nothing changes for users: the bundled plugin file is byte-identical before and after; the gate and 253 tests ran green before, 257 after (four of them cover the frontmatter fix below).

### Fixed

- **A pull no longer deletes the frontmatter of the local note.** Pulling a page changed on the wiki replaced the whole file with the wiki text, so `seitentyp`, `aliases`, `tags` and every other frontmatter field were lost. The local frontmatter block now stays untouched and only the text below it follows the wiki; the page is not reported as locally changed afterwards.

## [0.3.1] — 2026-10-03

### Changed

- The author in `manifest.json` is now "Johannes Kaindl"; Obsidian shows it in the plugin list.
- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.3.0] — 2026-09-30

### Changed

- **The API key now lives in Obsidian's keychain (Secret Storage) instead of in plain text in `data.json`.** An existing key is moved into the keychain on the first start after the update and removed from `data.json`. The keychain is per device: if you sync the vault to a second device, enter the key there once. If the keychain rejects the value, it stays in `data.json` and the console warns instead of silently losing it. **Breaking:** `minAppVersion` rises from 1.8.7 to 1.11.4 (Secret Storage only exists from there); older Obsidian versions stay on 0.2.1.
- Kit vendoring raised from `obsidian-kit` 0.30.0 to 0.45.1 and from `code-kit` 0.5.0 to 0.8.0 (new: module `secrets`); the gate and 243 tests ran green before and after.

### Added

- The GitHub release now also carries a ready-to-unpack `wikijs-maintainer.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

## [0.2.1] — 2026-09-26

### Changed
- **The "API key" field in the settings shows dots instead of plain text.** Until now the key was readable in the field — visible in screenshots and screen shares. The row is a `render` hatch with `type="password"`, because Obsidian's declarative settings have no password type; it stays findable through the settings search ("token", "bearer", "api key"). Storage is unchanged in `data.json`; moving to the keychain is not part of this change.

## [0.2.0] — 2026-09-26

### Added
- **Help row at the top of the settings** with links to the documentation and the issue tracker (kit `help-setting`, `obsidian-kit` 0.43.0).

### Fixed
- **An API key with characters outside Latin-1 now aborts with a readable message instead of dying in the header conversion.** Header values are ByteStrings — a key containing, for example, "•" used to make `requestUrl`/`fetch` crash with "Cannot convert argument to a ByteString …". The GraphQL client now checks this before every request.

### Changed
- **`scripts/shots.ts` no longer writes a non-ASCII placeholder into the vault settings for `settings.png`.** Previously `"•".repeat(48)` ended up permanently in the `data.json` of the recording vault — the next GUI smoke run inherited the broken key and aborted on the first GraphQL fetch. The masking for the image now happens in the rendering (`type="password"` only for the recording); the stored value is an ASCII placeholder.
- **The GUI smoke checks the API key for Latin-1 suitability before it goes into a header** — a damaged key in the vault now shows up as a red check point with a tally, not as a bare abort without a result.

## [0.1.3] — 2026-08-18

### Changed
- **README illustrated.** Four images (status view, settings tab, conflict and removal dialogs) in `README.md`/`README.de.md` — until then the README carried only badges. Recording driver and contract in `docs/images/`.
- **`README.de.md` brought up to date with 0.1.2.** The German version had been frozen since the MVP: "Not yet in the Community Store" (it has been since 2026-08-12), and the limits list knew neither "Adopt page" nor "Discard snapshot". Also removed a duplicated "Requirements" section from the English version.
- **The GUI smoke automates the four 0.1.2 dead-end exits** (occupied slug own/foreign, orphaned snapshot, no silent abort for an externally deleted note) — 11/11 instead of 7/7, counter-check verified.
- **The GUI smoke's CDP bridge imports the central umbrella version** (`tools/obsidian-cdp/`) instead of carrying it inline; this also fixes a focus-guard gap (Chromium throttles unfocused windows, which went unnoticed without a check).

## [0.1.2] — 2026-08-14

### Added
- **Exit from "Occupied".** For an occupied slug the status view offers "Adopt page": the plugin fetches the wiki page and records the missing snapshot **only if** its content matches your own version character for character. This covers exactly the path on which this state actually arises (page created, writing the snapshot failed afterwards). If the content differs, it is a foreign page — then nothing is adopted and it says so. The path never writes to the wiki.
- **Exit from "Stale snapshot".** Rows with no local note and no wiki page get "Discard snapshot". The service refuses the deletion as long as either of the two still exists: a snapshot is the basis of every later drift comparison.

### Fixed
- **Three silent aborts in the status view now report themselves.** A slug collision that arose between display and click, a vanished entry and a missing local note led to no push **and** no message.
- **The status view reads the client's error classification.** A rejected API key still appeared there as a bare "Forbidden" — the same finding that was fixed for the commands on 2026-08-12, one door further.
- **Foreign file extensions are cut off instead of being pulled into the slug.** `Not-A-Page.canvas` produced the path `not-a-pagecanvas`; note names with a dot (`Node.js Grundlagen.md`) stay untouched.
- **An incomplete plan entry is no longer reported as a slug collision.** It has its own reason and its own message; the old one sent the user searching for a page that does not exist.
- **The collision hint no longer covers the state label** — the row shows both.

### Changed
- Blocking reasons are now handled exhaustively by type (`assertNever`): a new reason without its own message breaks the build instead of ending up in the last message listed. Exactly this path had produced the bug above.
- 235 tests (previously 225), including the previously untested write adapter that creates files in the vault during a pull.

## [0.1.1] — 2026-08-12

## [0.1.0] — 2026-08-12

### Added
- One-way sync (push/pull) of a vault folder against a Wiki.js 2.x instance via GraphQL, snapshot-based (`src/core/sync-plan.ts` + `snapshot.ts`): vault path ↔ wiki path through deterministic slugification, drift guard immediately before every write (`updatedAt` comparison as a string).
- Four commands: "Show sync status", "Push current note", "Push all changes", "Pull current note from wiki".
- Status view with push/pull buttons per row; warning blocks for slug collisions (blocks the push for the pages concerned) and for ambiguous note names (blocks nothing — `[[Name]]` stays text instead of a link there).
- Conflict dialog with a line diff (local vs. wiki), even if the wiki page was reset to the old state in the meantime. No merge in the MVP — the decision is up to the user (keep local / cancel; "keep wiki" only cancels the push but does **not** bring the wiki version into the vault — a conflict entry cannot be pulled, see limits below).
- Removal dialog when a note is taken out of the sync folder: unpublish (default) / delete / keep; Esc always means keep.
- Bulk push runs sequentially and collects errors instead of stopping at the first failure; the report counts Created/Updated/Blocked/Errors.
- Obsidian Markdown → Wiki.js Markdown: wikilinks → wiki links, callouts → Wiki.js blockquote classes (`is-info`/`is-success`/`is-warning`/`is-danger`).
- GraphQL client over `requestUrl` with timeout and normalised errors (`src/wikijs/client.ts`); schema measured against a running instance instead of derived from the docs (`docs/LAB.md`, tool `npm run lab:wikijs`).
- Full i18n (DE/EN, EN canonical).
- 158 tests, gate green (`lint`, `typecheck`, `typecheck:scripts`, `test`, `check:pure`, `build`).

### Limits (deliberately not in the MVP)
- Images/assets are not synchronised (V2).
- No three-way merge on conflicts (V3) — the snapshot structure is already the basis for it.
- No automatic pull out of a conflict: as long as a page is changed both locally and in the wiki, there is no way to bring the wiki version into the vault with one click — only "New on wiki" and "Changed on wiki" can be pulled. If you want the wiki version, copy it from the diff in the conflict dialog or align the local file by hand until the conflict is resolved.

### Verified

- Tested against a real Wiki.js 2.x instance and a running Obsidian, not just against mocks: `docs/SMOKE.md` (seven points automated through `npm run smoke:gui`, the rest by hand). The first run found three bugs that 194 green unit tests could not see — all fixed before this release.
- The GraphQL schema is measured, not derived from the documentation (`docs/LAB.md`) — including the two places where Wiki.js' runtime behaviour deviates from its own schema declaration (`content` and `tags` are declared optional on `pages.update` but are mandatory).
