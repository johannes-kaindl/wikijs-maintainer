# LAB — gemessenes GraphQL-Schema

**Instanz:** eine produktive Wiki.js-2.5.x-Installation · **gemessen:** 2026-08-09
**Werkzeug:** `npm run lab:wikijs` (`scripts/wikijs-lab.ts`)

Diese Datei ist die Quelle der Wahrheit für `src/wikijs/queries.ts` — **nicht** die
Online-Dokumentation. Wo unten „angenommen" steht, ist die Angabe *nicht* gemessen.

## pages.list

Aufruf `pages { list(orderBy: PATH) { … } }` — das Argument `orderBy: PATH` wurde
akzeptiert (Messung 5 lief fehlerfrei durch).

Felder von `PageListItem`:

| Feld | Typ |
|---|---|
| `id` | `Int!` |
| `path` | `String!` |
| `locale` | `String!` |
| `title` | `String` |
| `description` | `String` |
| `contentType` | `String!` |
| `isPublished` | `Boolean!` |
| `isPrivate` | `Boolean!` |
| `privateNS` | `String` |
| `createdAt` | `Date!` |
| `updatedAt` | `Date!` |
| `tags` | `[String]` |

Der Client nutzt davon `id`, `path`, `title`, `updatedAt` — alle vorhanden.

## pages.single

Felder von `Page` (Auswahl der genutzten): `id`, `path`, `title`, `description`,
`content`, `updatedAt`, `isPublished`, `editor`, `locale`, `tags`, `contentType`,
`createdAt`, `hash`, `render`, `toc`, `authorId`/`authorName`/`authorEmail`,
`creatorId`/`creatorName`/`creatorEmail`, `publishStartDate`, `publishEndDate`,
`scriptCss`, `scriptJs`, `isPrivate`, `privateNS`.

Alle vom Client abgefragten Felder existieren.

## Mutations create / update / delete

`create` — **alle Kernargumente sind NON_NULL**:
`content: String!`, `description: String!`, `editor: String!`, `isPublished: Boolean!`,
`isPrivate: Boolean!`, `locale: String!`, `path: String!`, `tags: [String]!`,
`title: String!`. Optional: `publishStartDate`, `publishEndDate`, `scriptCss`, `scriptJs`.

`update` — nur `id: Int!` ist Pflicht, **alles andere ist optional (nullable)**:
`content`, `description`, `editor`, `isPrivate`, `isPublished`, `locale`, `path`,
`tags: [String]`, `title`, `publishStartDate`, `publishEndDate`, `scriptCss`, `scriptJs`.

`delete` — `id: Int!`.

Weitere, hier ungenutzte Mutations der Instanz: `convert`, `move`, `deleteTag`,
`updateTag`, `flushCache`, `migrateToLocale`, `rebuildTree`, `render`, `restore`,
`purgeHistory`. **`move` ist bemerkenswert** — eine Seite kann serverseitig
umbenannt werden, statt sie zu löschen und neu anzulegen. Für V2/V3 relevant,
wenn eine Notiz im Vault umzieht; im MVP ungenutzt.

## Fehlerform

`PageResponse` trägt genau zwei Felder: `responseResult` und `page`. **Bestätigt.**

Die Unterfelder von `responseResult` wurden **nicht gemessen** — die Messung ging
nur eine Ebene tief. Der Client fragt `succeeded errorCode slug message` ab
(Wiki.js-2-Typ `ResponseStatus`); das ist eine **Annahme**. Sie fällt beim ersten
echten Schreibzugriff auf, falls sie falsch ist: ein unbekanntes Feld quittiert
Wiki.js mit einem GraphQL-Fehler, den der Client als `kind: "graphql"` meldet.
Der Erfolgspfad des Clients prüft `result?.succeeded === true` und ist damit auch
gegen ein fehlendes Feld robust — er meldet dann „fehlgeschlagen", nicht einen
falschen Erfolg.

## Abweichungen von den Annahmen des Plans

1. **`updatedAt` ist vom GraphQL-Typ `Date`, nicht `String`.** Über JSON kommt es als
   String an, und der Drift-Guard vergleicht Strings auf Gleichheit — das funktioniert,
   solange die Instanz dasselbe Format stabil zurückgibt. **Kein Umbau nötig**, aber die
   Annahme ist damit benannt: verglichen wird die *Zeichenkette*, nicht ein Zeitpunkt.
2. **`tags` ist bei `create` NON_NULL (`[String]!`), bei `update` nullable (`[String]`).**
   Der Client übergibt in beiden Fällen ein Array (leer statt `null`) — das erfüllt beide.
   Die Variablendeklaration `$tags: [String]!` ist auch für `update` zulässig, weil ein
   Non-Null-Wert an eine nullable Position übergeben werden darf.
3. **Die Instanz ist leer** (`pages.list` → `[]`). Der erste Push legt also an, statt zu
   aktualisieren — der `create`-Pfad wird zuerst geübt, nicht `update`.

## Nachtrag 2026-08-12: Signatur ≠ Verhalten

**Die Introspektion beschreibt, was die API *annimmt* — nicht, was der Resolver
*verlangt*.** Im GUI-Smoke fiel auf, dass `pages.update` mit nur `id` und
`isPublished` fehlschlägt, obwohl oben gemessen steht, dass alle übrigen
Argumente nullable sind. Zwei getrennte Fallen, beide gegen die Instanz
reproduziert:

| Fehlendes Argument | Antwort der Instanz |
|---|---|
| `content` | `succeeded: false`, `errorCode: 6004`, `PageEmptyContent` — „Page content cannot be empty." |
| `tags` | `succeeded: false`, `errorCode: 1`, `TypeError` — „Cannot read properties of undefined (reading 'map')" |

Der `tags`-Fall ist der unangenehmere: der Resolver **ändert die Seite zuerst und
stolpert danach**. Die Seite war depubliziert, die Antwort meldete einen Fehler.
Wer daraufhin einen Wiederholungsversuch baut, arbeitet auf einem Zustand, den er
für unverändert hält.

Folge für den Client: `unpublishPage` holt die Seite frisch (`fetchPage`) und
schickt deren aktuellen `content` und `tags` mit — nicht die Fassung aus dem
Snapshot, sonst drehte das Depublizieren eine zwischenzeitliche Wiki-Änderung
stillschweigend zurück.

`pages.delete` ist **nicht** betroffen (an einer Wegwerf-Seite geprüft): `id`
allein genügt.

**Die allgemeine Lehre:** eine Introspektion taugt, um Feldnamen und Tippfehler
auszuschließen. Ob ein Aufruf *funktioniert*, sagt nur der Aufruf. Für jede
Mutation, die dieses Plugin absetzt, gilt: einmal echt gegen die Instanz laufen
lassen, bevor man ihr traut.

## Offene Messlücken

Beim nächsten Lauf mitnehmen, falls Bedarf entsteht:

- Unterfelder von `responseResult` (`__type(name: "ResponseStatus")`)
- Argumente von `PageQuery.single` und `PageQuery.list` (bisher nur indirekt bestätigt)
