# @t-rents/stars

Local store for your GitHub stars + repos discovered via topic search. Browser-extension-ready, framework-agnostic, zero runtime deps.

- `source: "github"` — actually starred on GitHub (refreshed via `sync()`)
- `source: "topic"` — surfaced via topic search, not starred (won't be removed by sync)
- Annotations (`tags`, `note`, `hidden`) survive every sync
- Events fire on every mutation; writes are serialized
- Schema versioned + auto-migrates from v0 (legacy bare-array JSON) and v1

## Install

```sh
npm install @t-rents/stars
# or
bun add @t-rents/stars
```

## Develop

```sh
bun install
bun run typecheck
bun run smoke    # offline test against a sample stars.json
bun run build
```

## Quick start

```ts
import {
  StarsStore,
  GitHubClient,
  ChromeStorageAdapter,
  RateLimitError,
} from "@t-rents/stars";

const gh = new GitHubClient(token);                  // PAT or OAuth token
const store = new StarsStore(new ChromeStorageAdapter(), gh);

store.on("synced", ({ result, changes }) => {
  console.log(`+${result.added} -${result.removed}`, changes.added.map(r => r.full_name));
});

try {
  await store.sync();
} catch (e) {
  if (e instanceof RateLimitError) console.log("resets at", e.resetAt);
}

await store.discover(["rust", "tui"], { limit: 50 });
const result = await store.search("vector db", { perPage: 25, page: 1 });
```

## Storage adapters

```ts
new ChromeStorageAdapter()       // chrome.storage.local — extensions (10MB quota MV3)
new MemoryAdapter()              // tests, transient state
new FileAdapter("/path.json")    // node, CLI, seeding from existing stars.json
```

`StorageAdapter` is a 3-method interface (`load`, `save`, `clear`) — implement to plug in IndexedDB, localStorage, OPFS, etc.

## API

### Reads
```ts
store.data()                                    // StoreData (v2)
store.get(fullName)                             // RepoRecord | null
store.search(query, opts?)                      // SearchResult<RepoRecord>
store.searchProjected(query, opts?)             // SearchResult<RepoProjection> (slim)
store.searchAll(query, opts?)                   // AsyncGenerator<SearchResult>
store.topics(minCount?)                         // TopicFacet[]
store.languages()                               // LanguageFacet[]
store.stats()                                   // Stats
store.export()                                  // StoreData (deep clone)
```

### Writes (serialized through internal queue)
```ts
store.sync({ signal?, force? })                 // SyncResult & { changes: SyncChanges }
store.discover(topics, { limit?, sort?, signal? })
store.discoverMany(topicSets, opts?)            // sequential batch

store.addTag(fullName, tag)
store.removeTag(fullName, tag)
store.setTags(fullName, tags[])
store.setNote(fullName, note | null)
store.hide(fullName) / store.unhide(fullName)
store.remove(fullName)                          // hard delete

store.importRecords(records, { overwrite? })    // seed from legacy data
store.clear()                                   // wipe storage
```

### Events
```ts
store.on("synced",     ({ result, changes }) => {})
store.on("discovered", ({ topics, result }) => {})
store.on("imported",   ({ count }) => {})
store.on("updated",    ({ full_name, kind, record }) => {}) // kind: tags|note|hide|unhide|remove
store.on("cleared",    () => {})
store.on("error",      ({ error, op }) => {})
// each `on` returns an unsubscribe fn
```

### Search options
```ts
{
  source?:        "github" | "topic"
  language?:      string
  minStars?:      number
  topics?:        string[]                  // require ALL (intersection)
  anyTopic?:      string[]                  // require ANY (union)
  tags?:          string[]                  // require ALL local tags
  includeHidden?: boolean                   // default false
  perPage?:       25 | 50 | 100             // default 50; throws on other values
  page?:          number                    // 1-indexed
  sortBy?:        "stars" | "updated" | "pushed" | "starred_at" | "name" | "created"
  sortDir?:       "asc" | "desc"            // default desc
}
```

## Sync semantics

- Sends `If-None-Match` (page-1 ETag) on subsequent syncs; returns `not_modified: true` on 304 with no work done.
- A repo found on GitHub overwrites the local record (preserving `tags`, `note`, `hidden`, `local_added_at`).
- A topic-discovered repo that turns out to be starred is upgraded (`source: "topic" → "github"`) with `discovered_via` retained as audit trail.
- Repos that disappear from `/user/starred` (you unstarred them) are pruned by default. Disable via `new StarsStore(adapter, gh, { pruneUnstarred: false })`. Topic-discovered repos are never pruned.

## Errors

```ts
GitHubApiError    // any non-2xx, non-304 response
AuthError         // 401 — bad token
RateLimitError    // 403/429 with rate-limit headers; has resetAt, remaining, limit, resource
AbortError        // signal aborted
StorageError      // adapter failures
MigrationError    // bad schema version or migrator failure
```

`isAbortError(e)` covers both `AbortError` and `DOMException("AbortError")`.

## Browser extension manifest

```json
{
  "manifest_version": 3,
  "permissions": ["storage"],
  "host_permissions": ["https://api.github.com/*"]
}
```

## Schema migrations

Auto-migrates on every load:

- v0 (bare array, e.g. legacy `stars.json`) → v1 → v2
- v1 (no annotations) → v2 (adds `tags`, `note`, `hidden`, `etag` per record + sync state)

`MigrationError` thrown if the store is from a newer version than the library.

