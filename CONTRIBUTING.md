# Contributing

## Setup

```sh
bun install
```

## Develop

```sh
bun run typecheck       # tsc --noEmit
bun run smoke           # offline test against scripts/smoke.ts
bun run build           # compile to dist/
```

`scripts/smoke.ts` exercises every read/write path through `MemoryAdapter` against a sample `stars.json`. Set `STARS_JSON=/path/to/stars.json` to point it at your own file.

## Layout

```
src/
  types.ts        Public types, PAGE_SIZES, STORE_VERSION
  errors.ts       Typed errors + isAbortError
  events.ts       TypedEmitter + StoreEventMap
  migrations.ts   migrate(), emptyStore()
  storage.ts      Chrome / Memory / File adapters
  github.ts       GitHubClient (fetch-based, paginated, AbortSignal, ETag, rate-limit)
  store.ts        StarsStore — events, write queue, all ops
  index.ts        Barrel export
scripts/
  smoke.ts        Offline integration test
```

## Release

```sh
# 1. bump version in package.json
# 2. commit
# 3. tag + push
git tag -a v$(jq -r .version package.json) -m "Release v$(jq -r .version package.json)"
git push origin main --tags

# 4. publish (prepublishOnly rebuilds dist)
npm publish
```

`prepublishOnly` runs `bun run clean && bun run build` so `dist/` is always fresh in the published tarball.

## Conventions

- Zero runtime dependencies. Native `fetch`, native `chrome.storage`. Add a dep only with strong justification.
- All async ops accept an `AbortSignal`.
- Mutations go through `store.write(...)` for serialization.
- New schema fields require a migrator entry in `migrations.ts` and a version bump on `STORE_VERSION`.
