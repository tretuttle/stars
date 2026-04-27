import {
  AbortError,
  AuthError,
  GitHubApiError,
  RateLimitError,
  isAbortError,
} from "./errors.js";
import type { RateLimitInfo } from "./types.js";

const BASE = "https://api.github.com";

export interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  html_url: string;
  homepage: string | null;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  topics?: string[];
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  license: { spdx_id: string | null } | null;
  size: number;
}

export interface StarredEntry {
  starred_at: string;
  repo: GitHubRepo;
}

export interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubRepo[];
  rate_limit: RateLimitInfo | null;
}

export interface FetchStarsOptions {
  signal?: AbortSignal;
  /** Send If-None-Match for the first page; returns notModified=true on 304. */
  ifNoneMatch?: string | null;
  onPage?: (page: StarredEntry[], pageNum: number, etag: string | null) => void;
}

export interface FetchStarsResult {
  entries: StarredEntry[];
  notModified: boolean;
  rootEtag: string | null;
  rateLimit: RateLimitInfo | null;
}

export interface SearchByTopicsOptions {
  limit?: number;
  sort?: "stars" | "forks" | "updated";
  order?: "asc" | "desc";
  signal?: AbortSignal;
}

export class GitHubClient {
  constructor(private readonly token: string) {
    if (!token) throw new AuthError("(no request)", "Empty token provided to GitHubClient");
  }

  /** Verify token works; returns the authenticated user login. */
  async whoami(signal?: AbortSignal): Promise<string> {
    const url = `${BASE}/user`;
    const res = await this.request(url, { signal });
    const data = (await res.json()) as { login: string };
    return data.login;
  }

  async fetchAllStars(opts: FetchStarsOptions = {}): Promise<FetchStarsResult> {
    const out: StarredEntry[] = [];
    let url: string | null = `${BASE}/user/starred?per_page=100`;
    let pageNum = 0;
    let rootEtag: string | null = null;
    let rateLimit: RateLimitInfo | null = null;

    while (url) {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.star+json",
      };
      if (pageNum === 0 && opts.ifNoneMatch) {
        headers["If-None-Match"] = opts.ifNoneMatch;
      }
      const res = await this.request(url, { headers, signal: opts.signal });
      rateLimit = parseRateLimit(res);

      if (res.status === 304) {
        return {
          entries: [],
          notModified: true,
          rootEtag: opts.ifNoneMatch ?? null,
          rateLimit,
        };
      }

      const page = (await res.json()) as StarredEntry[];
      pageNum++;
      const etag = res.headers.get("ETag");
      if (pageNum === 1) rootEtag = etag;
      out.push(...page);
      opts.onPage?.(page, pageNum, etag);
      url = parseNextLink(res.headers.get("Link"));
    }

    return { entries: out, notModified: false, rootEtag, rateLimit };
  }

  async searchByTopics(topics: string[], opts: SearchByTopicsOptions = {}): Promise<SearchResponse> {
    if (topics.length === 0) throw new Error("At least one topic required");
    const limit = Math.min(opts.limit ?? 30, 100);
    const q = topics.map((t) => `topic:${t}`).join(" ");
    const params = new URLSearchParams({
      q,
      sort: opts.sort ?? "stars",
      order: opts.order ?? "desc",
      per_page: String(limit),
    });
    const url = `${BASE}/search/repositories?${params.toString()}`;
    const res = await this.request(url, { signal: opts.signal });
    const data = (await res.json()) as Omit<SearchResponse, "rate_limit">;
    return { ...data, rate_limit: parseRateLimit(res) };
  }

  private async request(
    url: string,
    init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    };
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: init.signal });
    } catch (e) {
      if (isAbortError(e)) throw new AbortError();
      throw e;
    }
    if (res.ok || res.status === 304) return res;

    const body = await safeText(res);
    if (res.status === 401) throw new AuthError(url, body);
    if (isRateLimited(res)) throw rateLimitError(url, body, res);
    throw new GitHubApiError(res.status, url, body);
  }
}

function safeText(res: Response): Promise<string> {
  return res.text().catch(() => "");
}

function isRateLimited(res: Response): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  const remaining = res.headers.get("x-ratelimit-remaining");
  return remaining === "0" || res.status === 429;
}

function rateLimitError(url: string, body: string, res: Response): RateLimitError {
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? "0");
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "0");
  const limit = Number(res.headers.get("x-ratelimit-limit") ?? "0");
  const resource = (res.headers.get("x-ratelimit-resource") ?? "unknown") as
    | "core"
    | "search"
    | "graphql"
    | "unknown";
  return new RateLimitError({
    url,
    body,
    resetAt: new Date(reset * 1000),
    remaining,
    limit,
    resource,
  });
}

function parseRateLimit(res: Response): RateLimitInfo | null {
  const limit = res.headers.get("x-ratelimit-limit");
  if (limit == null) return null;
  return {
    limit: Number(limit),
    remaining: Number(res.headers.get("x-ratelimit-remaining") ?? "0"),
    used: Number(res.headers.get("x-ratelimit-used") ?? "0"),
    resetAt: new Date(Number(res.headers.get("x-ratelimit-reset") ?? "0") * 1000).toISOString(),
    resource: (res.headers.get("x-ratelimit-resource") ?? "unknown") as
      | "core"
      | "search"
      | "graphql"
      | "unknown",
  };
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}
