// Sondier-Skript: misst das GraphQL-Schema einer laufenden Wiki.js-2.x-Instanz.
// Kein Bundle-Bestandteil (nur tsconfig.scripts.json). Muster: koda-agent/scripts/koda-lab.ts.
const URL_BASE = process.env.WIKIJS_URL;
const TOKEN = process.env.WIKIJS_TOKEN;

if (!URL_BASE || !TOKEN) {
  console.error("WIKIJS_URL und WIKIJS_TOKEN muessen gesetzt sein.");
  process.exit(2);
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${URL_BASE!.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN!}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: unknown; errors?: unknown };
  if (json.errors) console.error("GraphQL-Fehler:", JSON.stringify(json.errors, null, 2));
  return json.data;
}

async function main(): Promise<void> {
  console.log("── 1. Felder von PageListItem ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageListItem") { fields { name type { name kind ofType { name } } } } }`), null, 2));

  console.log("── 2. Felder von Page ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "Page") { fields { name } } }`), null, 2));

  console.log("── 3. Argumente von PageMutation.create/update/delete ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageMutation") { fields { name args { name type { name kind ofType { name } } } } } }`), null, 2));

  console.log("── 4. Form von PageResponse (responseResult) ──");
  console.log(JSON.stringify(await gql(`{ __type(name: "PageResponse") { fields { name } } }`), null, 2));

  console.log("── 5. Echter Listen-Aufruf ──");
  console.log(JSON.stringify(await gql(`{ pages { list(orderBy: PATH) { id path title updatedAt locale } } }`), null, 2));
}

void main();
