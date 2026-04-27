# @t-rents/stars

[![npm version](https://img.shields.io/npm/v/@t-rents/stars.svg)](https://www.npmjs.com/package/@t-rents/stars)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@t-rents/stars)](https://bundlephobia.com/package/@t-rents/stars)
[![types](https://img.shields.io/npm/types/@t-rents/stars.svg)](https://www.npmjs.com/package/@t-rents/stars)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![license](https://img.shields.io/npm/l/@t-rents/stars.svg)](./LICENSE)

A local search and discovery layer over your GitHub starred repos.

If you've starred more than a few hundred repos, GitHub's own stars page collapses — slow, no tags, no notes, no way to find that vector-db thing you starred two years ago, and no way to expand the set without manually clicking through topic pages. This is the storage and search engine for fixing that: sync your stars, expand the set with topic searches, annotate with tags / notes / a hidden flag — and every annotation survives every resync. Works in any TypeScript runtime, including Chrome MV3 extensions.

## Quick start

```ts
import { StarsStore, GitHubClient, FileAdapter } from "@t-rents/stars";

const gh = new GitHubClient(process.env.GH_TOKEN!);
const store = new StarsStore(new FileAdapter("./stars.json"), gh);

await store.sync();                                              // pull /user/starred
await store.discover(["vector-database", "rag"], { limit: 50 }); // expand via topic search

await store.addTag("pgvector/pgvector", "favorite");
await store.setNote("pgvector/pgvector", "the one i actually use in prod");

const { items } = await store.search("vector db", { tags: ["favorite"] });
```

## Install

```sh
npm install @t-rents/stars
# or
bun add @t-rents/stars
```

## Why not just...

- **GitHub's own stars page** — fine for a few dozen stars; collapses at scale. No tags, no notes, no topic-based set expansion, no fuzzy search across description + topics + language.
- **`gh api /user/starred`** — gives you the JSON. Doesn't give you a query layer, annotations, sync diff, ETag-conditional refresh, or a way to merge topic-discovered repos into the same searchable space.
- **[astralapp](https://github.com/astralapp/astral) and similar star managers** — mirror your existing stars and stop there. This treats topic-discovery as a first-class source, so repos you *haven't* starred yet sit alongside the ones you have, in one searchable space.

## Storage adapters

```ts
new FileAdapter("/path.json")    // node, CLI, seeding from existing JSON
new ChromeStorageAdapter()       // chrome.storage.local — extensions (10MB quota MV3)
new MemoryAdapter()              // tests, transient state
```

`StorageAdapter` is a 3-method interface (`load`, `save`, `clear`) — implement to plug in IndexedDB, localStorage, OPFS, or anything else.

## API

### Reads
```ts
store.data()                                    // StoreData
store.get(fullName)                             // RepoRecord | null
store.search(query, opts?)                      // SearchResult<RepoRecord>
store.searchProjected(query, opts?)             // SearchResult<RepoProjection> (slim shape)
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

store.importRecords(records, { overwrite? })    // seed from an existing record array
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

- A repo found on `/user/starred` overwrites the local record but preserves `tags`, `note`, `hidden`, and `local_added_at`.
- A topic-discovered repo that turns out to be starred is upgraded (`source: "topic" → "github"`) with `discovered_via` retained as audit trail.
- Repos that disappear from `/user/starred` (you unstarred them) are pruned by default. Disable with `new StarsStore(adapter, gh, { pruneUnstarred: false })`. Topic-discovered repos are never pruned.
- Sends `If-None-Match` (page-1 ETag) on subsequent syncs; returns `not_modified: true` on 304 with no work done.

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

## Schema versioning

The persisted store has a `version` field. New installs start at the current schema. A migration registry runs on load, so future schema changes can roll forward without breaking existing stores. Throws `MigrationError` if it encounters a store from a newer schema than the library knows.

## Browser extension manifest

If you're using this in a Chrome MV3 extension:

```json
{
  "manifest_version": 3,
  "permissions": ["storage"],
  "host_permissions": ["https://api.github.com/*"]
}
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
