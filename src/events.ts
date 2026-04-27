import type {
  DiscoverResult,
  RepoRecord,
  SyncChanges,
  SyncResult,
} from "./types.js";

export type UpdateKind = "tags" | "note" | "hide" | "unhide" | "remove";

export interface StoreEventMap {
  synced: { result: SyncResult; changes: SyncChanges };
  discovered: { topics: string[]; result: DiscoverResult };
  imported: { count: number };
  updated: { full_name: string; kind: UpdateKind; record: RepoRecord | null };
  cleared: undefined;
  error: { error: Error; op: string };
}

export type EventName = keyof StoreEventMap;
export type Listener<K extends EventName> = (payload: StoreEventMap[K]) => void;
export type Unsubscribe = () => void;

export class TypedEmitter {
  private listeners = new Map<EventName, Set<Listener<EventName>>>();

  on<K extends EventName>(event: K, fn: Listener<K>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<EventName>);
    return () => {
      set!.delete(fn as Listener<EventName>);
    };
  }

  off<K extends EventName>(event: K, fn: Listener<K>): void {
    this.listeners.get(event)?.delete(fn as Listener<EventName>);
  }

  once<K extends EventName>(event: K, fn: Listener<K>): Unsubscribe {
    const off = this.on(event, ((payload: StoreEventMap[K]) => {
      off();
      fn(payload);
    }) as Listener<K>);
    return off;
  }

  emit<K extends EventName>(event: K, payload: StoreEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<K>)(payload);
      } catch {
        // listener errors don't break the emit chain
      }
    }
  }

  removeAll(event?: EventName): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}
