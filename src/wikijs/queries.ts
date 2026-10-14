// GraphQL-Dokumente fuer Wiki.js 2.x. Gegen die laufende Instanz gemessen —
// Befund in docs/LAB.md; die Doku-Fassung ist NICHT die Quelle der Wahrheit.
export const LIST_PAGES = `query { pages { list(orderBy: PATH) { id path title locale updatedAt } } }`;

export const SINGLE_PAGE = `query($id: Int!) {
  pages { single(id: $id) { id path title description content updatedAt isPublished tags { tag } } }
}`;

/** Drift-Guard: bewusst nur ein Feld — der Query laeuft vor JEDEM Push.
 *  `updatedAt` ist GraphQL-`Date`, nicht `String` (docs/LAB.md); ueber JSON kommt
 *  es als String an, und der Drift-Guard vergleicht diese Zeichenkette auf
 *  Gleichheit — kein Zeitvergleich, keine Parsing-Annahme. */
export const PAGE_UPDATED_AT = `query($id: Int!) { pages { single(id: $id) { updatedAt } } }`;

// tags ist bei create serverseitig NON_NULL ([String]!), bei update nullable ([String])
// (docs/LAB.md). $tags: [String]! ist an beiden Stellen zulaessig — ein Non-Null-Wert
// darf an eine nullable Position uebergeben werden — und der Client uebergibt ohnehin
// immer ein Array (leer statt null).
// `isPublished` ist eine Variable, keine Konstante: eine fest verdrahtete Sichtbarkeit nahm jede
// bewusst depublizierte Seite beim naechsten Push wieder online (Frontmatter `wiki_published`).
export const CREATE_PAGE = `mutation($content: String!, $description: String!, $path: String!, $tags: [String]!, $title: String!, $locale: String!, $isPublished: Boolean!) {
  pages {
    create(content: $content, description: $description, editor: "markdown", isPublished: $isPublished,
           isPrivate: false, locale: $locale, path: $path, tags: $tags, title: $title) {
      responseResult { succeeded errorCode slug message }
      page { id updatedAt }
    }
  }
}`;

export const UPDATE_PAGE = `mutation($id: Int!, $content: String!, $description: String!, $tags: [String]!, $title: String!, $isPublished: Boolean!) {
  pages {
    update(id: $id, content: $content, description: $description, tags: $tags, title: $title, isPublished: $isPublished) {
      responseResult { succeeded errorCode slug message }
      page { id updatedAt }
    }
  }
}`;

/** Depublizieren statt loeschen: die Seite bleibt samt Historie erhalten, ist aber
 *  nicht mehr oeffentlich (Default-Antwort auf "lokal aus dem Sync-Ordner entfernt").
 *
 *  `content` und `tags` MUESSEN mit, obwohl das Schema sie als optional fuehrt:
 *  der Resolver von Wiki.js 2.5 behandelt ein fehlendes `content` als leeren
 *  Inhalt und antwortet `PageEmptyContent` (6004), und ueber ein fehlendes `tags`
 *  stolpert er intern mit `Cannot read properties of undefined (reading 'map')` —
 *  letzteres ERST, NACHDEM er die Seite bereits geaendert hat. Gemessen
 *  2026-08-12 gegen die Instanz; die Introspektion in docs/LAB.md zeigt das nicht,
 *  weil sie nur die Signatur kennt, nicht das Verhalten. */
export const UNPUBLISH_PAGE = `mutation($id: Int!, $content: String!, $tags: [String]!) {
  pages {
    update(id: $id, content: $content, tags: $tags, isPublished: false) {
      responseResult { succeeded errorCode slug message }
    }
  }
}`;

export const DELETE_PAGE = `mutation($id: Int!) {
  pages { delete(id: $id) { responseResult { succeeded errorCode slug message } } }
}`;

/** Verschiebt eine Seite serverseitig, Id und Historie bleiben (statt Loeschen + Anlegen). Das
 *  Schema fuehrt `move` (docs/LAB.md); das Verhalten an der echten Instanz ist NICHT gemessen. */
export const MOVE_PAGE = `mutation($id: Int!, $destinationPath: String!, $destinationLocale: String!) {
  pages {
    move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale) {
      responseResult { succeeded errorCode slug message }
    }
  }
}`;
