// errors
export {
  AbortError,
  AuthError,
  GitHubApiError,
  MigrationError,
  RateLimitError,
  StorageError,
  isAbortError,
} from "./errors.js";

// events
export { TypedEmitter } from "./events.js";
export type {
  EventName,
  Listener,
  StoreEventMap,
  Unsubscribe,
  UpdateKind,
} from "./events.js";

// github
export { GitHubClient } from "./github.js";
export type {
  FetchStarsOptions,
  FetchStarsResult,
  GitHubRepo,
  SearchByTopicsOptions,
  SearchResponse,
  StarredEntry,
} from "./github.js";

// migrations
export { emptyStore, migrate } from "./migrations.js";

// storage
export {
  ChromeStorageAdapter,
  FileAdapter,
  MemoryAdapter,
  type StorageAdapter,
} from "./storage.js";

// store
export { StarsStore, type StoreOptions } from "./store.js";

// types
export { PAGE_SIZES, STORE_VERSION } from "./types.js";
export type {
  DiscoverManyResult,
  DiscoverResult,
  LanguageFacet,
  PageSize,
  RateLimitInfo,
  RepoProjection,
  RepoRecord,
  SearchOpts,
  SearchResult,
  SortBy,
  SortDir,
  Source,
  Stats,
  StoreData,
  SyncChanges,
  SyncResult,
  TopicFacet,
} from "./types.js";
