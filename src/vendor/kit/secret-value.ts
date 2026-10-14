// vendored from code-kit@0.27.1, src/ts/pure/secret-value.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: wikijs-maintainer `src/core/api-key-storage.ts` (36 lines, `loadApiKey`/`persistApiKey`; its header names a
// yijing-oracle source that no longer exists) and yijing-oracle `src/core/settings/migrate.ts:68-88` (the `strandedKey`
// return value). Waiting consumers: paperless-storage (API token in `data.json`) and vault-rag (`mcpToken`, generated).
// Welle 22, 2026-10-14. The Obsidian half — `secretStorageAvailable`, `obsidianSecretStore` — lives in
// `obsidian-kit/src/obsidian/secrets.ts` and stays there; this module only needs the {@link SecretStore} contract.
//
// **What it is.** A setting that is one string — an API token, a generated key — used to live in `data.json`, which every
// vault sync and backup carries along. This moves it into the keychain (`SecretStore`), once, on the first load after the
// update, and keeps the plugin's runtime reading it from memory as before (`getSecret` is synchronous, so no network path
// has to change). Two functions, no state: {@link loadSecretValue} when the settings are read, {@link persistSecretValue}
// when the user changes the field.
//
// **Cases the consumers' tasks require, and where they sit:**
// - Plaintext in `data.json` is put into the keychain on the first load and removed from the file → state `"migrated"`,
//   `persisted: ""`, `dirty: true`.
// - No keychain (Obsidian before 1.11.4; the plugin passes `null` after `secretStorageAvailable(app)` said no): the
//   plaintext stays, state `"plaintext"` — the plugin shows a notice (paperless-storage, decision 2026-10-13: "older
//   Obsidian versions keep plaintext with a notice, minAppVersion stays 1.8.7"). An empty field is `"empty"`, not
//   `"plaintext"`, so a user without a token sees no notice.
// - A **generated** token (vault-rag) is carried over unchanged. The migration never calls a generator; the plugin
//   generates only when the load reports `"empty"`, and persists with {@link persistSecretValue}.
// - Keychain refuses (`set` throws) or accepts and forgets: the plaintext stays, state `"kept"`, `error` says why. wikijs-
//   maintainer wrote it as "better plaintext with a warning than a silent loss the user notices at the 401".
//
// **Differences between the two templates, settled:**
// - yijing-oracle's `strandedKey` is a field of its multi-endpoint migration (a key for which there is no row), not a
//   property of a single value: it stays in yijing-oracle's `migrate.ts`; this module covers the single-value case that
//   wikijs-maintainer had, and a stranded key can use {@link persistSecretValue}.
// - wikijs-maintainer lets the keychain win when both hold a value and clears the file either way (`migrate: stored !== ""`).
//   Kept, as state `"cleaned"`: the keychain is the newer place, and the plaintext is cleared on every path. If the two
//   values differ, the plaintext is lost — that is the same behaviour, now with a name a plugin can log.
// - wikijs-maintainer had no `null` case ("the floor is 1.11.4, the keychain is always there"); paperless-storage cannot
//   say that, so `store` may be `null`.
// - Order is keychain first, file second. A crash between the two leaves the plaintext in the file *and* the value in the
//   keychain; the next load reports `"cleaned"` and finishes the job. Nothing is lost at any point.
// **Rules for the plugin that these functions cannot enforce:**
// - *Every path that serialises the settings must write `persisted`, never the secret.* `loadSecretValue` returns `value`
//   (for memory) and `persisted` (for the file) apart; a plugin that keeps the secret in the settings object it saves
//   (vault-rag: `settings.mcpToken` and `saveSettings()`) writes it back into `data.json` on the next save. Save the way
//   `persistSecretValue` returns it — `data.token = persistSecretValue(settings.token, store, ID).persisted` — or take the
//   field out of the object before `saveData`.
// - *The keychain is per device, `data.json` is synced.* Device A migrates and syncs `""`; device B then reports `"empty"`
//   and has no value: the user enters it again, a generated token is generated again (for vault-rag's client snippets that
//   is per device anyway). Nothing is lost on the device that migrated; that is all "nothing is lost" means here.
// - *No `trim()`.* Only line breaks are stripped (`stripCrLf`, as the keychain does): a blank can be part of a secret. A
//   settings field that wants trimming (paperless-storage's "token without leading spaces") trims before calling.
// - An unreadable keychain (`get` throws) does not stop the load: the plaintext stays, state `"kept"`, `error` says why.
import { stripCrLf, type SecretStore } from "./secrets";

/** Where the value ended up. */
export type SecretValueState =
  /** Nothing anywhere. A generated setting is generated now. */
  | "empty"
  /** In the keychain; `data.json` was already clean. */
  | "keychain"
  /** Found in `data.json`, put into the keychain; the plugin must clear the field in `data.json`. */
  | "migrated"
  /** The keychain already had a value (it wins); the plaintext in `data.json` is stale and must be cleared. */
  | "cleaned"
  /** No keychain on this Obsidian. The value stays in `data.json`; the plugin shows a notice. */
  | "plaintext"
  /** There is a keychain but it did not keep the value. It stays in `data.json`; `error` says why. */
  | "kept";

/** The result of {@link loadSecretValue}. */
export interface LoadedSecretValue {
  /** The value to use at runtime — what the plugin keeps in memory. */
  value: string;
  /** What the field in `data.json` must hold from now on: `""` once the value is in the keychain. */
  persisted: string;
  /** `true` when `persisted` differs from what was read, so the plugin has to save `data.json`. */
  dirty: boolean;
  state: SecretValueState;
  /** `true` only with `state: "cleaned"` when the plaintext in `data.json` differed from the keychain value and was dropped
   *  — the plugin may tell the user (a token changed on another device would show up here). */
  conflict?: true;
  /** With `state: "kept"` or `"empty"`: why the keychain could not be read or written. */
  error?: string;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Reads a single-value secret when the settings are loaded.
 *
 *  @param stored what `data.json` holds for the field (`""` if absent)
 *  @param store the keychain, or `null` when this Obsidian has none (`secretStorageAvailable(app)` is false)
 *  @param id the keychain id; fixed per field, lowercase alphanumeric with hyphens (`secretIdFor`) */
export function loadSecretValue(stored: string, store: SecretStore | null, id: string): LoadedSecretValue {
  if (store === null) {
    return { value: stored, persisted: stored, dirty: false, state: stored === "" ? "empty" : "plaintext" };
  }
  const plain = stripCrLf(stored);
  let inStore: string;
  try {
    inStore = store.get(id) ?? "";
  } catch (e) {
    // An unreadable keychain must not stop the plugin from starting, and must not make the plaintext look migrated.
    return { value: plain, persisted: stored, dirty: false, state: plain === "" ? "empty" : "kept", error: messageOf(e) };
  }
  if (inStore !== "") {
    const dirty = stored !== "";
    const out: LoadedSecretValue = { value: inStore, persisted: "", dirty, state: dirty ? "cleaned" : "keychain" };
    if (dirty && plain !== inStore) out.conflict = true;
    return out;
  }
  if (plain === "") return { value: "", persisted: "", dirty: stored !== "", state: "empty" };
  try {
    store.set(id, plain);
  } catch (e) {
    return { value: plain, persisted: stored, dirty: false, state: "kept", error: messageOf(e) };
  }
  const back = store.get(id) ?? "";
  if (back === "") {
    return { value: plain, persisted: stored, dirty: false, state: "kept", error: "the keychain accepted the value but did not keep it" };
  }
  return { value: back, persisted: "", dirty: true, state: "migrated" };
}

/** The result of {@link persistSecretValue}. */
export interface PersistedSecretValue {
  /** The value to keep in memory: `value` without the line breaks the keychain strips, so memory and keychain agree. */
  value: string;
  /** What the field in `data.json` must hold: `""` when the keychain has the value. */
  persisted: string;
  /** `"keychain"`: stored there. `"plaintext"`: no keychain, the value stays in the file. `"kept"`: the keychain refused,
   *  the value stays in the file. `"empty"`: the field was cleared. */
  state: "keychain" | "plaintext" | "kept" | "empty";
  /** With `state: "kept"`: why. With `"empty"`: the keychain entry could not be deleted (the field is cleared regardless —
   *  the old keychain value then comes back on the next load). */
  error?: string;
}

/** Writes a single-value secret when the user changes the field (or the plugin generates one). Returns what `data.json`
 *  has to contain. An empty `value` removes the keychain entry. */
export function persistSecretValue(value: string, store: SecretStore | null, id: string): PersistedSecretValue {
  const plain = stripCrLf(value);
  if (store === null) return { value: plain, persisted: plain, state: plain === "" ? "empty" : "plaintext" };
  if (plain === "") {
    try {
      store.delete(id);
    } catch (e) {
      return { value: "", persisted: "", state: "empty", error: messageOf(e) };
    }
    return { value: "", persisted: "", state: "empty" };
  }
  try {
    store.set(id, plain);
  } catch (e) {
    return { value: plain, persisted: plain, state: "kept", error: messageOf(e) };
  }
  let back: string;
  try {
    back = store.get(id) ?? "";
  } catch (e) {
    return { value: plain, persisted: plain, state: "kept", error: messageOf(e) };
  }
  if (back === "") {
    return { value: plain, persisted: plain, state: "kept", error: "the keychain accepted the value but did not keep it" };
  }
  return { value: back, persisted: "", state: "keychain" };
}
