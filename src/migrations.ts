import { MigrationError } from "./errors.js";
import { STORE_VERSION, type StoreData } from "./types.js";

type Migrator = (data: any) => any;

const migrators: Record<number, Migrator> = {
  // 0 = legacy bare-array stars.json → v1
  0: (data: unknown) => {
    if (Array.isArray(data)) {
      return { version: 1, stars: data, last_synced_at: null };
    }
    return { version: 1, stars: [], last_synced_at: null };
  },
  // v1 → v2: add user annotations + sync_state
  1: (data: any) => ({
    version: 2,
    stars: (data.stars ?? []).map((r: any) => ({
      tags: [],
      note: null,
      hidden: false,
      etag: null,
      ...r,
    })),
    last_synced_at: data.last_synced_at ?? null,
    last_full_sync_at: data.last_synced_at ?? null,
    sync_etag: null,
  }),
};

export function migrate(data: unknown): StoreData {
  if (data == null) {
    return emptyStore();
  }

  let v = detectVersion(data);
  let working: any = data;

  while (v < STORE_VERSION) {
    const m = migrators[v];
    if (!m) {
      throw new MigrationError(v, STORE_VERSION, `No migration registered from v${v}`);
    }
    try {
      working = m(working);
    } catch (e) {
      throw new MigrationError(v, v + 1, (e as Error).message);
    }
    if (working?.version === v) {
      throw new MigrationError(v, v + 1, "Migrator did not bump version");
    }
    v = working.version;
  }

  if (v > STORE_VERSION) {
    throw new MigrationError(
      v,
      STORE_VERSION,
      `Store is from a newer version (v${v}); cannot downgrade to v${STORE_VERSION}`,
    );
  }

  return working as StoreData;
}

function detectVersion(data: unknown): number {
  if (Array.isArray(data)) return 0;
  if (data && typeof data === "object" && typeof (data as any).version === "number") {
    return (data as any).version;
  }
  return 0;
}

export function emptyStore(): StoreData {
  return {
    version: STORE_VERSION,
    stars: [],
    last_synced_at: null,
    last_full_sync_at: null,
    sync_etag: null,
  };
}
