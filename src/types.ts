export const STORE_VERSION = 2 as const;

export type Source = "github" | "topic";
export type SortBy = "stars" | "updated" | "pushed" | "starred_at" | "name" | "created";
export type SortDir = "asc" | "desc";
export type PageSize = 25 | 50 | 100;
export const PAGE_SIZES: readonly PageSize[] = [25, 50, 100] as const;

export interface RepoRecord {
  // identity
  full_name: string;
  name: string | null;
  owner: string;
  owner_avatar: string | null;

  // links
  url: string | null;
  homepage: string | null;

  // discovery surface
  description: string;
  language: string | null;
  topics: string[];

  // engagement
  stars: number;
  forks: number;
  watchers: number;
  open_issues: number;

  // status
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  default_branch: string | null;
  license: string | null;
  size_kb: number;

  // timestamps
  created_at: string | null;
  updated_at: string | null;
  pushed_at: string | null;
  starred_at: string | null;

  // local provenance
  source: Source;
  discovered_via: string[];
  local_added_at: string;
  search_blob: string;

  // v2: user annotations + sync state
  tags: string[];
  note: string | null;
  hidden: boolean;
  etag: string | null;
}

/** Slim projection for memory-conscious UIs (lists, autocomplete). */
export interface RepoProjection {
  full_name: string;
  owner: string;
  description: string;
  language: string | null;
  stars: number;
  topics: string[];
  source: Source;
  url: string | null;
  tags: string[];
  hidden: boolean;
}

export interface StoreData {
  version: typeof STORE_VERSION;
  stars: RepoRecord[];
  last_synced_at: string | null;
  last_full_sync_at: string | null;
  sync_etag: string | null;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  used: number;
  resetAt: string; // ISO
  resource: "core" | "search" | "graphql" | "unknown";
}

export interface SyncChanges {
  added: RepoRecord[];
  refreshed: RepoRecord[];
  upgraded: RepoRecord[]; // topic → github
  removed: RepoRecord[];  // unstarred since last sync
}

export interface SyncResult {
  added: number;
  refreshed: number;
  upgraded: number;
  removed: number;
  total: number;
  not_modified: boolean;
  rate_limit: RateLimitInfo | null;
}

export interface DiscoverResult {
  topics: string[];
  found: number;
  total_matching: number;
  added: number;
  augmented: number;
  skipped: number;
  added_repos: string[];
  rate_limit: RateLimitInfo | null;
}

export interface DiscoverManyResult {
  runs: DiscoverResult[];
  total_added: number;
  total_augmented: number;
}

export interface SearchOpts {
  source?: Source;
  language?: string;
  minStars?: number;
  /** Require ALL of these topics (intersection). */
  topics?: string[];
  /** Require ANY of these topics (union). */
  anyTopic?: string[];
  /** Require ALL of these local user tags. */
  tags?: string[];
  /** Include hidden records (default false). */
  includeHidden?: boolean;
  perPage?: PageSize;
  page?: number;
  sortBy?: SortBy;
  sortDir?: SortDir;
}

export interface SearchResult<T = RepoRecord> {
  items: T[];
  total: number;
  page: number;
  perPage: PageSize;
  totalPages: number;
  hasMore: boolean;
  query: string;
}

export interface TopicFacet {
  topic: string;
  count: number;
  repos: string[];
}

export interface LanguageFacet {
  language: string;
  count: number;
}

export interface Stats {
  total: number;
  by_source: Record<Source, number>;
  by_language: Record<string, number>;
  by_discovered_topic: Record<string, number>;
  hidden: number;
  tagged: number;
  noted: number;
  last_synced_at: string | null;
  last_full_sync_at: string | null;
}
