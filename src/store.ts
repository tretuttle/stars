import { TypedEmitter, type Listener, type Unsubscribe, type EventName } from "./events.js";
import type { GitHubClient, GitHubRepo } from "./github.js";
import { migrate, emptyStore } from "./migrations.js";
import type { StorageAdapter } from "./storage.js";
import {
  PAGE_SIZES,
  type DiscoverManyResult,
  type DiscoverResult,
  type LanguageFacet,
  type RepoProjection,
  type RepoRecord,
  type SearchOpts,
  type SearchResult,
  type SortBy,
  type SortDir,
  type Source,
  type Stats,
  type StoreData,
  type SyncChanges,
  type SyncResult,
  type TopicFacet,
} from "./types.js";

export interface StoreOptions {
  /** Treat unstarred repos found during sync as removed (only `source: "github"` records). Default true. */
  pruneUnstarred?: boolean;
}

export class StarsStore {
  private readonly emitter = new TypedEmitter();
  private readonly opts: Required<StoreOptions>;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly gh: GitHubClient,
    opts: StoreOptions = {},
  ) {
    this.opts = { pruneUnstarred: opts.pruneUnstarred ?? true };
  }

  // ---- events ----

  on<K extends EventName>(event: K, fn: Listener<K>): Unsubscribe {
    return this.emitter.on(event, fn);
  }
  off<K extends EventName>(event: K, fn: Listener<K>): void {
    this.emitter.off(event, fn);
  }
  once<K extends EventName>(event: K, fn: Listener<K>): Unsubscribe {
    return this.emitter.once(event, fn);
  }

  // ---- read ----

  async data(): Promise<StoreData> {
    const raw = await this.adapter.load();
    if (raw == null) return emptyStore();
    return migrate(raw);
  }

  async export(): Promise<StoreData> {
    return await this.data();
  }

  async stats(): Promise<Stats> {
    const cur = await this.data();
    const by_source: Record<Source, number> = { github: 0, topic: 0 };
    const by_language: Record<string, number> = {};
    const by_discovered_topic: Record<string, number> = {};
    let hidden = 0,
      tagged = 0,
      noted = 0;

    for (const r of cur.stars) {
      by_source[r.source] = (by_source[r.source] ?? 0) + 1;
      const lang = r.language ?? "(none)";
      by_language[lang] = (by_language[lang] ?? 0) + 1;
      for (const t of r.discovered_via) {
        by_discovered_topic[t] = (by_discovered_topic[t] ?? 0) + 1;
      }
      if (r.hidden) hidden++;
      if (r.tags.length > 0) tagged++;
      if (r.note) noted++;
    }

    return {
      total: cur.stars.length,
      by_source,
      by_language,
      by_discovered_topic,
      hidden,
      tagged,
      noted,
      last_synced_at: cur.last_synced_at,
      last_full_sync_at: cur.last_full_sync_at,
    };
  }

  async topics(minCount = 1): Promise<TopicFacet[]> {
    const cur = await this.data();
    const map = new Map<string, string[]>();
    for (const r of cur.stars) {
      if (r.hidden) continue;
      for (const t of r.topics) {
        const list = map.get(t) ?? [];
        list.push(r.full_name);
        map.set(t, list);
      }
    }
    const facets: TopicFacet[] = [];
    for (const [topic, repos] of map) {
      if (repos.length >= minCount) facets.push({ topic, count: repos.length, repos });
    }
    facets.sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
    return facets;
  }

  async languages(): Promise<LanguageFacet[]> {
    const cur = await this.data();
    const map = new Map<string, number>();
    for (const r of cur.stars) {
      if (r.hidden) continue;
      const lang = r.language ?? "(none)";
      map.set(lang, (map.get(lang) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
  }

  async get(fullName: string): Promise<RepoRecord | null> {
    const cur = await this.data();
    return cur.stars.find((r) => r.full_name === fullName) ?? null;
  }

  // ---- search ----

  async search(query: string, opts: SearchOpts = {}): Promise<SearchResult<RepoRecord>> {
    return this.searchInternal(query, opts, (r) => r);
  }

  async searchProjected(query: string, opts: SearchOpts = {}): Promise<SearchResult<RepoProjection>> {
    return this.searchInternal(query, opts, project);
  }

  async *searchAll(
    query: string,
    opts: Omit<SearchOpts, "page"> = {},
  ): AsyncGenerator<SearchResult<RepoRecord>, void, void> {
    let page = 1;
    while (true) {
      const result = await this.search(query, { ...opts, page });
      yield result;
      if (!result.hasMore) return;
      page++;
    }
  }

  private async searchInternal<T>(
    query: string,
    opts: SearchOpts,
    transform: (r: RepoRecord) => T,
  ): Promise<SearchResult<T>> {
    const perPage = opts.perPage ?? 50;
    if (!PAGE_SIZES.includes(perPage)) {
      throw new Error(`perPage must be one of ${PAGE_SIZES.join(", ")}; got ${perPage}`);
    }
    const page = Math.max(1, opts.page ?? 1);
    const cur = await this.data();
    const q = query.toLowerCase().trim();

    let matches = cur.stars.slice();
    if (!opts.includeHidden) matches = matches.filter((r) => !r.hidden);
    if (q) matches = matches.filter((r) => r.search_blob.includes(q));
    if (opts.source) matches = matches.filter((r) => r.source === opts.source);
    if (opts.language) matches = matches.filter((r) => r.language === opts.language);
    if (opts.minStars != null) matches = matches.filter((r) => r.stars >= opts.minStars!);
    if (opts.topics?.length) {
      const required = opts.topics.map((t) => t.toLowerCase());
      matches = matches.filter((r) => required.every((t) => r.topics.includes(t)));
    }
    if (opts.anyTopic?.length) {
      const any = new Set(opts.anyTopic.map((t) => t.toLowerCase()));
      matches = matches.filter((r) => r.topics.some((t) => any.has(t)));
    }
    if (opts.tags?.length) {
      const requiredTags = opts.tags;
      matches = matches.filter((r) => requiredTags.every((t) => r.tags.includes(t)));
    }

    sortRecords(matches, opts.sortBy ?? "stars", opts.sortDir ?? "desc");

    const total = matches.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const items = matches.slice(start, start + perPage).map(transform);

    return { items, total, page, perPage, totalPages, hasMore: page < totalPages, query: q };
  }

  // ---- mutations (sync, discover, import) ----

  async sync(opts: { signal?: AbortSignal; force?: boolean } = {}): Promise<SyncResult & { changes: SyncChanges }> {
    return this.write(async () => {
      const cur = await this.data();
      const ifNoneMatch = opts.force ? null : cur.sync_etag;
      const fetched = await this.gh.fetchAllStars({
        ifNoneMatch: ifNoneMatch ?? undefined,
        signal: opts.signal,
      });

      if (fetched.notModified) {
        const result: SyncResult = {
          added: 0,
          refreshed: 0,
          upgraded: 0,
          removed: 0,
          total: cur.stars.length,
          not_modified: true,
          rate_limit: fetched.rateLimit,
        };
        const changes: SyncChanges = { added: [], refreshed: [], upgraded: [], removed: [] };
        cur.last_synced_at = nowIso();
        await this.adapter.save(cur);
        this.emitter.emit("synced", { result, changes });
        return { ...result, changes };
      }

      const map = new Map(cur.stars.map((r) => [r.full_name, r]));
      const seenOnGitHub = new Set<string>();
      const changes: SyncChanges = { added: [], refreshed: [], upgraded: [], removed: [] };

      for (const entry of fetched.entries) {
        seenOnGitHub.add(entry.repo.full_name);
        const old = map.get(entry.repo.full_name);
        const rec = makeRecord(entry.repo, {
          source: "github",
          starred_at: entry.starred_at,
          carryFrom: old,
        });
        if (!old) {
          changes.added.push(rec);
        } else if (old.source === "topic") {
          changes.upgraded.push(rec);
        } else {
          changes.refreshed.push(rec);
        }
        map.set(rec.full_name, rec);
      }

      if (this.opts.pruneUnstarred) {
        for (const r of cur.stars) {
          if (r.source === "github" && !seenOnGitHub.has(r.full_name)) {
            changes.removed.push(r);
            map.delete(r.full_name);
          }
        }
      }

      cur.stars = sortStars([...map.values()]);
      cur.last_synced_at = nowIso();
      cur.last_full_sync_at = nowIso();
      cur.sync_etag = fetched.rootEtag;
      await this.adapter.save(cur);

      const result: SyncResult = {
        added: changes.added.length,
        refreshed: changes.refreshed.length,
        upgraded: changes.upgraded.length,
        removed: changes.removed.length,
        total: cur.stars.length,
        not_modified: false,
        rate_limit: fetched.rateLimit,
      };
      this.emitter.emit("synced", { result, changes });
      return { ...result, changes };
    }, "sync");
  }

  async discover(
    topics: string[],
    opts: { limit?: number; sort?: "stars" | "forks" | "updated"; signal?: AbortSignal } = {},
  ): Promise<DiscoverResult> {
    return this.write(async () => {
      const normalized = normalizeTopics(topics);
      if (normalized.length === 0) throw new Error("At least one non-empty topic required");

      const result = await this.gh.searchByTopics(normalized, {
        limit: opts.limit ?? 30,
        sort: opts.sort ?? "stars",
        signal: opts.signal,
      });

      const cur = await this.data();
      const map = new Map(cur.stars.map((r) => [r.full_name, r]));
      let added = 0,
        augmented = 0,
        skipped = 0;
      const addedRepos: string[] = [];

      for (const repo of result.items) {
        const old = map.get(repo.full_name);
        if (old) {
          if (old.source === "topic") {
            const merged = [...new Set([...old.discovered_via, ...normalized])].sort();
            if (merged.length !== old.discovered_via.length) {
              old.discovered_via = merged;
              augmented++;
            } else {
              skipped++;
            }
          } else {
            skipped++;
          }
        } else {
          map.set(repo.full_name, makeRecord(repo, { source: "topic", discovered_via: normalized }));
          added++;
          addedRepos.push(repo.full_name);
        }
      }

      cur.stars = sortStars([...map.values()]);
      await this.adapter.save(cur);

      const out: DiscoverResult = {
        topics: normalized,
        found: result.items.length,
        total_matching: result.total_count,
        added,
        augmented,
        skipped,
        added_repos: addedRepos,
        rate_limit: result.rate_limit,
      };
      this.emitter.emit("discovered", { topics: normalized, result: out });
      return out;
    }, "discover");
  }

  /** Run multiple topic-set discoveries sequentially, sharing the lock. */
  async discoverMany(
    topicSets: string[][],
    opts: { limit?: number; sort?: "stars" | "forks" | "updated"; signal?: AbortSignal } = {},
  ): Promise<DiscoverManyResult> {
    const runs: DiscoverResult[] = [];
    let total_added = 0,
      total_augmented = 0;
    for (const topics of topicSets) {
      const r = await this.discover(topics, opts);
      runs.push(r);
      total_added += r.added;
      total_augmented += r.augmented;
      if (opts.signal?.aborted) break;
    }
    return { runs, total_added, total_augmented };
  }

  async importRecords(
    records: RepoRecord[],
    opts: { overwrite?: boolean } = {},
  ): Promise<number> {
    return this.write(async () => {
      const cur = await this.data();
      const map = new Map(opts.overwrite ? [] : cur.stars.map((r) => [r.full_name, r]));
      let added = 0;
      for (const r of records) {
        if (!map.has(r.full_name)) added++;
        map.set(r.full_name, normalizeRecord(r));
      }
      cur.stars = sortStars([...map.values()]);
      await this.adapter.save(cur);
      this.emitter.emit("imported", { count: added });
      return added;
    }, "import");
  }

  // ---- per-record mutations ----

  async setTags(fullName: string, tags: string[]): Promise<RepoRecord | null> {
    return this.updateRecord(fullName, "tags", (r) => {
      r.tags = [...new Set(tags.map((t) => t.toLowerCase().trim()).filter(Boolean))].sort();
    });
  }

  async addTag(fullName: string, tag: string): Promise<RepoRecord | null> {
    const t = tag.toLowerCase().trim();
    if (!t) return await this.get(fullName);
    return this.updateRecord(fullName, "tags", (r) => {
      if (!r.tags.includes(t)) r.tags = [...r.tags, t].sort();
    });
  }

  async removeTag(fullName: string, tag: string): Promise<RepoRecord | null> {
    const t = tag.toLowerCase().trim();
    return this.updateRecord(fullName, "tags", (r) => {
      r.tags = r.tags.filter((x) => x !== t);
    });
  }

  async setNote(fullName: string, note: string | null): Promise<RepoRecord | null> {
    return this.updateRecord(fullName, "note", (r) => {
      r.note = note && note.trim() ? note : null;
    });
  }

  async hide(fullName: string): Promise<RepoRecord | null> {
    return this.updateRecord(fullName, "hide", (r) => {
      r.hidden = true;
    });
  }

  async unhide(fullName: string): Promise<RepoRecord | null> {
    return this.updateRecord(fullName, "unhide", (r) => {
      r.hidden = false;
    });
  }

  async remove(fullName: string): Promise<boolean> {
    return this.write(async () => {
      const cur = await this.data();
      const before = cur.stars.length;
      cur.stars = cur.stars.filter((r) => r.full_name !== fullName);
      if (cur.stars.length === before) return false;
      await this.adapter.save(cur);
      this.emitter.emit("updated", { full_name: fullName, kind: "remove", record: null });
      return true;
    }, "remove");
  }

  async clear(): Promise<void> {
    return this.write(async () => {
      await this.adapter.clear();
      this.emitter.emit("cleared", undefined);
    }, "clear");
  }

  // ---- internals ----

  private async updateRecord(
    fullName: string,
    kind: "tags" | "note" | "hide" | "unhide",
    mutator: (r: RepoRecord) => void,
  ): Promise<RepoRecord | null> {
    return this.write(async () => {
      const cur = await this.data();
      const idx = cur.stars.findIndex((r) => r.full_name === fullName);
      if (idx < 0) return null;
      const record = { ...cur.stars[idx]! };
      mutator(record);
      cur.stars[idx] = record;
      await this.adapter.save(cur);
      this.emitter.emit("updated", { full_name: fullName, kind, record });
      return record;
    }, `update:${kind}`);
  }

  /** Serialize all writes. Reads stay free. */
  private write<T>(fn: () => Promise<T>, op: string): Promise<T> {
    const next = this.writeQueue.then(
      () => fn(),
      () => fn(),
    ).catch((e) => {
      this.emitter.emit("error", { error: toError(e), op });
      throw e;
    });
    this.writeQueue = next.catch(() => {});
    return next;
  }
}

// ---- helpers ----

function makeRecord(
  repo: GitHubRepo,
  opts: {
    source: Source;
    starred_at?: string | null;
    discovered_via?: string[];
    carryFrom?: RepoRecord | undefined;
  },
): RepoRecord {
  const name = repo.full_name;
  const desc = repo.description ?? "";
  const topics = repo.topics ?? [];
  const lang = repo.language ?? "";
  const carry = opts.carryFrom;
  return {
    full_name: name,
    name: repo.name ?? null,
    owner: repo.owner.login,
    owner_avatar: repo.owner.avatar_url ?? null,
    url: repo.html_url ?? null,
    homepage: repo.homepage ?? null,
    description: desc,
    language: repo.language ?? null,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    watchers: repo.watchers_count ?? 0,
    open_issues: repo.open_issues_count ?? 0,
    topics,
    archived: !!repo.archived,
    disabled: !!repo.disabled,
    fork: !!repo.fork,
    default_branch: repo.default_branch ?? null,
    created_at: repo.created_at ?? null,
    updated_at: repo.updated_at ?? null,
    pushed_at: repo.pushed_at ?? null,
    license: repo.license?.spdx_id ?? null,
    size_kb: repo.size ?? 0,
    starred_at: opts.starred_at ?? null,
    source: opts.source,
    discovered_via: opts.discovered_via ?? carry?.discovered_via ?? [],
    local_added_at: carry?.local_added_at ?? nowIso(),
    search_blob: [name, desc, topics.join(" "), lang].join(" ").toLowerCase(),
    // carry user annotations across syncs
    tags: carry?.tags ?? [],
    note: carry?.note ?? null,
    hidden: carry?.hidden ?? false,
    etag: carry?.etag ?? null,
  };
}

function normalizeRecord(r: RepoRecord): RepoRecord {
  return {
    ...r,
    tags: r.tags ?? [],
    note: r.note ?? null,
    hidden: r.hidden ?? false,
    etag: r.etag ?? null,
    discovered_via: r.discovered_via ?? [],
    source: r.source ?? "github",
    local_added_at: r.local_added_at ?? nowIso(),
    search_blob:
      r.search_blob ??
      [r.full_name, r.description ?? "", (r.topics ?? []).join(" "), r.language ?? ""]
        .join(" ")
        .toLowerCase(),
  };
}

function normalizeTopics(topics: string[]): string[] {
  return [...new Set(topics.map((t) => t.toLowerCase().trim()))].filter(Boolean).sort();
}

function project(r: RepoRecord): RepoProjection {
  return {
    full_name: r.full_name,
    owner: r.owner,
    description: r.description,
    language: r.language,
    stars: r.stars,
    topics: r.topics,
    source: r.source,
    url: r.url,
    tags: r.tags,
    hidden: r.hidden,
  };
}

function sortStars(stars: RepoRecord[]): RepoRecord[] {
  return [...stars].sort((a, b) => {
    const ka = a.starred_at ?? a.local_added_at ?? "";
    const kb = b.starred_at ?? b.local_added_at ?? "";
    return kb.localeCompare(ka);
  });
}

function sortRecords(records: RepoRecord[], by: SortBy, dir: SortDir): void {
  const mult = dir === "desc" ? -1 : 1;
  const cmpStr = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");
  const cmpNum = (a: number, b: number) => a - b;
  records.sort((a, b) => {
    switch (by) {
      case "stars":
        return mult * cmpNum(a.stars, b.stars);
      case "updated":
        return mult * cmpStr(a.updated_at, b.updated_at);
      case "pushed":
        return mult * cmpStr(a.pushed_at, b.pushed_at);
      case "created":
        return mult * cmpStr(a.created_at, b.created_at);
      case "starred_at":
        return mult * cmpStr(a.starred_at ?? a.local_added_at, b.starred_at ?? b.local_added_at);
      case "name":
        return mult * a.full_name.localeCompare(b.full_name);
      default:
        return 0;
    }
  });
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
