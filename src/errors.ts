export class GitHubApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  constructor(status: number, url: string, body: string, message?: string) {
    super(message ?? `GitHub API ${status} on ${url}: ${body.slice(0, 200)}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class AuthError extends GitHubApiError {
  constructor(url: string, body: string) {
    super(401, url, body, "GitHub authentication failed; check your token");
    this.name = "AuthError";
  }
}

export class RateLimitError extends GitHubApiError {
  readonly resetAt: Date;
  readonly remaining: number;
  readonly limit: number;
  readonly resource: "core" | "search" | "graphql" | "unknown";
  constructor(opts: {
    url: string;
    body: string;
    resetAt: Date;
    remaining: number;
    limit: number;
    resource: "core" | "search" | "graphql" | "unknown";
  }) {
    super(
      403,
      opts.url,
      opts.body,
      `GitHub rate limit exceeded (${opts.resource}); resets at ${opts.resetAt.toISOString()}`,
    );
    this.name = "RateLimitError";
    this.resetAt = opts.resetAt;
    this.remaining = opts.remaining;
    this.limit = opts.limit;
    this.resource = opts.resource;
  }
}

export class AbortError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class StorageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "StorageError";
  }
}

export class MigrationError extends Error {
  constructor(readonly fromVersion: number, readonly toVersion: number, message?: string) {
    super(message ?? `Failed migrating store from v${fromVersion} to v${toVersion}`);
    this.name = "MigrationError";
  }
}

export function isAbortError(e: unknown): e is AbortError | DOMException {
  if (e instanceof AbortError) return true;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return false;
}
