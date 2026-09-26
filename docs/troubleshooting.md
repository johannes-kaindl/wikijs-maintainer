# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## Nothing happens on push

> Set the wiki URL and API key first.

**Fix:** fill in **Wiki URL** and **API key** under **Settings → Wiki.js Maintainer**.

> This note is outside the sync folder (_published).

**Cause:** **Push current note** and **Pull current note from wiki** only act on notes below the **Sync folder**.

**Fix:** move the note into that folder, or change **Sync folder**.

## The wiki rejected the API key

> The wiki rejected the API key. Check it in the plugin settings — a key needs write access to pages.

**Cause:** the key is wrong, disabled, or belongs to a group without write access to pages.

**Fix:** in Wiki.js open **Administration → Groups**, check the group's page permissions and that **API Access** is enabled, then create a new key and paste it into **API key**.

## The wiki could not be reached

> The wiki could not be reached: …

**Cause:** the address is wrong, the server is down, or the request timed out. The text after the colon is the underlying reason.

**Fix:** check **Wiki URL** — base address only, no `/graphql`. If the wiki is slow, raise **Request timeout** (5 to 120 seconds, default 30).

## A page is blocked

> Blocked: … changed on the wiki since the last plan — no push.

**Cause:** the page was edited in the wiki between the status view and your push. The plugin never overwrites silently.

**Fix:** refresh the status view and push again. If the local note also changed, a conflict dialog shows a line diff and offers **Keep local** (overwrite the wiki), **Keep remote** (stop, leave the wiki page untouched) and **Cancel**. **Keep remote** does not pull; to take the wiki's text, copy it from the diff or edit your note until it matches.

> Blocked: … already exists on the wiki under another page.

**Cause:** the row reads **Occupied**. A wiki page exists at the path this note maps to, but the plugin holds no snapshot tying the two together.

**Fix:** press **Adopt page**. If the wiki page matches your note character for character, the plugin starts tracking it. If it differs, you are told: *Not adopted: the wiki page at … holds different content, so it isn't this note. Rename the note or remove the page in the wiki.*

> Blocked: … is claimed by more than one local file.

**Cause:** two notes map onto the same wiki path, for example `Dns Setup.md` and `dns-setup.md`. The row reads **Blocked: slug collision**.

**Fix:** rename one of the two files.

> Blocked: … was deleted on the wiki. Recreating a deleted page isn't supported yet.

**Cause:** the row reads **Removed on wiki**.

**Fix:** recreate the page in the wiki by hand, or remove the local note from the sync folder.

> Blocked: … has no local note to push (removed, wiki-only, or an orphaned snapshot).

**Cause:** the row has nothing to push.

**Fix:** use **Pull** for a wiki-only page.

> Blocked: … is no longer in the plan — the view was out of date. It has been refreshed.

**Fix:** try again; the view has been refreshed.

## A link stays plain text

The sync status view shows *Ambiguous note name: …* with the hint *[[…]] stays plain text — rename one file or link by path.*

**Cause:** two files with the same name in different folders make `[[Name]]` ambiguous. Publishing is not blocked, but that link is not turned into a wiki link.

**Fix:** rename one file or link by full path. The sync report also counts *Unresolved links* to notes that are not published, and *Skipped embeds*: images and other attachments are not synced yet.

## A removed note asks what to do

**Cause:** you removed a note from the sync folder. The dialog **Removed locally** asks what should happen to the page on the wiki.

**Fix:** choose **Unpublish** (reversible, the page history stays), **Delete**, or **Keep**. Closing the dialog with Esc means **Keep**.

## Snapshots

> network/dns-setup still has a local note or a wiki page — its snapshot is still needed.

**Cause:** you pressed **Discard snapshot** on a row where the note or the page still exists. Only a **Stale snapshot** row — note and page both gone — can be discarded.

## Getting help

Open an issue at [github.com/johannes-kaindl/wikijs-maintainer/issues](https://github.com/johannes-kaindl/wikijs-maintainer/issues). Include the exact message, the Obsidian version and your Wiki.js version. Never paste your API key.
