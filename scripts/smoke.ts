/**
 * Offline smoke test. Reads a sample stars.json (bare-array, legacy format)
 * and exercises every mutation/read path through MemoryAdapter.
 *
 *   bun scripts/smoke.ts
 *   STARS_JSON=/path/to/stars.json bun scripts/smoke.ts
 */
import { GitHubClient } from "../src/github.js";
import { MemoryAdapter } from "../src/storage.js";
import { StarsStore } from "../src/store.js";
import type { RepoRecord } from "../src/types.js";

const LEGACY = process.env.STARS_JSON ?? "../stars.json";

async function main() {
  const fs = await import("node:fs/promises");
  const legacyTxt = await fs.readFile(LEGACY, "utf8");
  const legacyData = JSON.parse(legacyTxt) as RepoRecord[];
  console.log(`legacy stars.json has ${legacyData.length} records`);

  // Use MemoryAdapter so the test is fully isolated.
  const adapter = new MemoryAdapter();
  // Seed adapter with raw legacy bare-array, exercise the migration path.
  await adapter.save(legacyData as any);

  const gh = new GitHubClient(process.env.GH_TOKEN ?? "no-token-needed-offline");
  const store = new StarsStore(adapter, gh);

  // Migration check
  const data = await store.data();
  console.log(`migrated to v${data.version}, ${data.stars.length} records`);
  console.log(`first record has v2 fields:`, {
    tags: data.stars[0]?.tags,
    note: data.stars[0]?.note,
    hidden: data.stars[0]?.hidden,
  });

  // Event subscription
  const events: string[] = [];
  const offUpdated = store.on("updated", (e) => events.push(`updated:${e.kind}:${e.full_name}`));

  // Per-record annotations
  await store.addTag("BurntSushi/ripgrep", "favorite");
  await store.addTag("BurntSushi/ripgrep", "cli");
  await store.setNote("BurntSushi/ripgrep", "fastest grep i've used");
  const ripgrep = await store.get("BurntSushi/ripgrep");
  console.log("ripgrep tags+note:", { tags: ripgrep?.tags, note: ripgrep?.note });

  // Hidden filter
  await store.hide("openclaw/openclaw");
  const visibleRust = await store.search("rust", { perPage: 25 });
  const allRust = await store.search("rust", { perPage: 25, includeHidden: true });
  console.log(
    `rust search: visible=${visibleRust.total}, with-hidden=${allRust.total} (delta should be 1)`,
  );

  // Pagination + sort
  const p1 = await store.search("rust", { perPage: 25, page: 1, sortBy: "stars" });
  const p2 = await store.search("rust", { perPage: 25, page: 2, sortBy: "stars" });
  console.log(
    `pagination: ${p1.totalPages} pages, p1=${p1.items.length}, p2=${p2.items.length}, hasMore p2=${p2.hasMore}`,
  );

  // Topic intersection filter (local, no GH call)
  const cliRust = await store.search("", { topics: ["cli", "rust"], perPage: 25 });
  console.log(`local AND-topics cli+rust: ${cliRust.total} matches`);

  // Tag filter
  const fav = await store.search("", { tags: ["favorite"], perPage: 25 });
  console.log(`tagged "favorite": ${fav.total}`);

  // Projection
  const projected = await store.searchProjected("rust", { perPage: 25 });
  console.log(`projection sample:`, projected.items[0]);

  // Facets
  const langs = await store.languages();
  console.log(`top 3 languages:`, langs.slice(0, 3));

  // Stats
  const stats = await store.stats();
  console.log("stats:", {
    total: stats.total,
    by_source: stats.by_source,
    hidden: stats.hidden,
    tagged: stats.tagged,
    noted: stats.noted,
  });

  // perPage validation
  try {
    await store.search("x", { perPage: 7 as any });
    console.log("BUG: should throw");
  } catch (e) {
    console.log("perPage validation OK:", (e as Error).message);
  }

  // Concurrency: kick two writes; ensure both land
  const work = Promise.all([
    store.addTag("sharkdp/bat", "tooling"),
    store.addTag("sharkdp/bat", "rust"),
  ]);
  await work;
  const bat = await store.get("sharkdp/bat");
  console.log(`bat after concurrent tag adds:`, bat?.tags);

  offUpdated();
  console.log(`events captured: ${events.length}`);
  console.log("v2 smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
