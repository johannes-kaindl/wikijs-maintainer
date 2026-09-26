# Getting started

This takes you from the install to your first published page. You need Obsidian 1.8.7 or newer, the plugin installed (see the [README](https://github.com/johannes-kaindl/wikijs-maintainer/blob/main/README.md#install)) and a **Wiki.js 2.x** instance you can reach.

## 1. Create an API key in Wiki.js

In Wiki.js open **Administration → Groups** and pick a group that has **write access to pages** (or create one). Under **API Access** enable the API and create a key for that group. A key without page-write rights makes every push fail with an authentication error.

## 2. Enter the connection

Open **Settings → Wiki.js Maintainer** and fill in:

- **Wiki URL** — the base address, for example `https://wiki.example.org`, without `/graphql`.
- **API key** — the key from step 1.

Leave **Sync folder** at `_published` for now. **Wiki locale** (default `de`) is the language of pages the plugin creates; change it to your wiki's locale if it differs.

## 3. Put a note into the sync folder

Create the folder `_published` in your vault and move a note into it, for example `_published/Network/DNS-Setup.md`. Moving a note in there *is* the decision to publish it. The path maps 1:1 onto the wiki path: that note becomes `network/dns-setup`. The page title is the file name, or the `title` in the note's frontmatter if you set one; frontmatter `summary` and `tags` become the page description and tags. The frontmatter itself is never published.

## 4. Look at the plan

Run **Show sync status** from the command palette. The view **Wiki.js sync status** lists every page under the sync folder. Your note shows as **New**.

## 5. Push

Press **Push** on that row, or open the note and run **Push current note**. A notice tells you the result: *Created: network/dns-setup*. Open the page in the wiki to see it. Wikilinks became wiki links and callouts became Wiki.js blockquotes on the way out.

Edit the note and push again: the status is **Changed locally** first and the notice says *Updated: …*. **Push all changes** sends everything that changed in one run and ends with a summary such as *Push done: 1 created, 2 updated, 0 blocked*.

## 6. Bring a wiki change back

When someone edits the page in the wiki, the row reads **Changed on wiki**. Press **Pull**, or run **Pull current note from wiki** on that note, to bring the wiki's version into your note.

## Where to go next

The [README](https://github.com/johannes-kaindl/wikijs-maintainer/blob/main/README.md) explains the drift guard, what happens when you remove a note from the sync folder and the current limits (text only, no merge). If a step failed, see [Troubleshooting](troubleshooting.md).
