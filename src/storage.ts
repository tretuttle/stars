import { StorageError } from "./errors.js";
import type { StoreData } from "./types.js";

export interface StorageAdapter {
  load(): Promise<unknown>;
  save(data: StoreData): Promise<void>;
  clear(): Promise<void>;
}

/** chrome.storage.local — default for browser extensions (10MB quota in MV3). */
export class ChromeStorageAdapter implements StorageAdapter {
  constructor(private key = "stars_store") {}

  async load(): Promise<unknown> {
    try {
      const r = await chrome.storage.local.get(this.key);
      return (r as Record<string, unknown>)[this.key] ?? null;
    } catch (e) {
      throw new StorageError("chrome.storage.local.get failed", e);
    }
  }

  async save(data: StoreData): Promise<void> {
    try {
      await chrome.storage.local.set({ [this.key]: data });
    } catch (e) {
      throw new StorageError("chrome.storage.local.set failed", e);
    }
  }

  async clear(): Promise<void> {
    try {
      await chrome.storage.local.remove(this.key);
    } catch (e) {
      throw new StorageError("chrome.storage.local.remove failed", e);
    }
  }
}

/** In-memory adapter for tests and transient state. */
export class MemoryAdapter implements StorageAdapter {
  private data: StoreData | null = null;

  async load(): Promise<unknown> {
    return this.data ? structuredClone(this.data) : null;
  }
  async save(data: StoreData): Promise<void> {
    this.data = structuredClone(data);
  }
  async clear(): Promise<void> {
    this.data = null;
  }
}

/** Node fs adapter — useful for CLIs and seeding. Accepts legacy bare-array files. */
export class FileAdapter implements StorageAdapter {
  constructor(private path: string) {}

  async load(): Promise<unknown> {
    const fs = await import("node:fs/promises");
    try {
      const txt = await fs.readFile(this.path, "utf8");
      return JSON.parse(txt);
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw new StorageError(`Failed reading ${this.path}`, e);
    }
  }

  async save(data: StoreData): Promise<void> {
    const fs = await import("node:fs/promises");
    try {
      await fs.writeFile(this.path, JSON.stringify(data, null, 2));
    } catch (e) {
      throw new StorageError(`Failed writing ${this.path}`, e);
    }
  }

  async clear(): Promise<void> {
    const fs = await import("node:fs/promises");
    try {
      await fs.rm(this.path, { force: true });
    } catch (e) {
      throw new StorageError(`Failed removing ${this.path}`, e);
    }
  }
}
