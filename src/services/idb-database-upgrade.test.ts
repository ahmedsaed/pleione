import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  CACHE_META_STORE,
  CACHE_STORES,
  cacheKeyPath,
  PLAYLIST_STORE,
  requestResult,
  SEARCH_INDEX_STORE,
  USER_DATA_STORES,
  USER_META_STORE,
} from './idb-database';
import { DB_NAME, DB_VERSION } from './idb-schema';

const HEALTH_STORE = 'channel-health-cache';

// An older layout: the cache stores of that version plus every user store.
function createOld(
  version: number,
  cacheStores: readonly string[],
  seed: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of cacheStores) {
        const keyPath = name === HEALTH_STORE ? 'key' : cacheKeyPath(name as typeof CACHE_STORES[number]);
        const store = db.createObjectStore(name, { keyPath });
        store.createIndex('expiresAt', 'expiresAt');
        store.createIndex('lastAccessedAt', 'lastAccessedAt');
      }
      db.createObjectStore(CACHE_META_STORE, { keyPath: 'category' });
      for (const name of USER_DATA_STORES) db.createObjectStore(name, { keyPath: 'key' });
      db.createObjectStore(USER_META_STORE, { keyPath: 'key' });
      seed(req.transaction!);
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

async function openFresh(): Promise<IDBDatabase> {
  vi.resetModules();
  const { openPersistenceDb } = await import('./idb-database');
  return (await openPersistenceDb())!;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('persistence database upgrade', () => {
  it('adds the search index cache from v6 and keeps existing records', async () => {
    const v6Stores = [...CACHE_STORES.filter(name => name !== SEARCH_INDEX_STORE), HEALTH_STORE];
    await createOld(6, v6Stores, (tx) => {
      tx.objectStore(PLAYLIST_STORE).put({ key: 'combined', timestamp: 1, data: { channels: [] } });
      tx.objectStore('favorites').put({ key: 'ch1' });
      tx.objectStore(CACHE_META_STORE).put({ category: 'epg', bytes: 10, entries: 1 });
    });

    const db = await openFresh();
    expect(db.version).toBe(8);
    expect(db.objectStoreNames.contains(SEARCH_INDEX_STORE)).toBe(true);
    const tx = db.transaction([SEARCH_INDEX_STORE, PLAYLIST_STORE, 'favorites', CACHE_META_STORE]);
    const search = tx.objectStore(SEARCH_INDEX_STORE);
    expect(search.keyPath).toBe('key');
    expect(Array.from(search.indexNames).sort()).toEqual(['expiresAt', 'lastAccessedAt']);
    expect(await requestResult(tx.objectStore(PLAYLIST_STORE).get('combined')))
      .toMatchObject({ timestamp: 1 });
    expect(await requestResult(tx.objectStore('favorites').get('ch1'))).toEqual({ key: 'ch1' });
    expect(await requestResult(tx.objectStore(CACHE_META_STORE).get('epg')))
      .toMatchObject({ bytes: 10, entries: 1 });
  });

  it('drops the channel health cache and its accounting from v7', async () => {
    await createOld(7, [...CACHE_STORES, HEALTH_STORE], (tx) => {
      tx.objectStore(HEALTH_STORE).put({ key: 'ch1', data: { status: 'suspect' } });
      tx.objectStore('favorites').put({ key: 'ch1' });
      const meta = tx.objectStore(CACHE_META_STORE);
      meta.put({ category: 'health', bytes: 40, entries: 1 });
      meta.put({ category: 'epg', bytes: 10, entries: 1 });
      meta.put({ category: 'total', bytes: 50, entries: 2 });
    });

    const db = await openFresh();
    expect(db.version).toBe(8);
    expect(db.objectStoreNames.contains(HEALTH_STORE)).toBe(false);
    const tx = db.transaction(['favorites', CACHE_META_STORE]);
    const meta = tx.objectStore(CACHE_META_STORE);
    expect(await requestResult(meta.get('health'))).toBeUndefined();
    // The missing total makes the cache accounting rebuild on first use.
    expect(await requestResult(meta.get('total'))).toBeUndefined();
    expect(await requestResult(meta.get('epg'))).toMatchObject({ bytes: 10 });
    expect(await requestResult(tx.objectStore('favorites').get('ch1'))).toEqual({ key: 'ch1' });
  });

  it('keeps the accounting when there is no health cache to drop', async () => {
    await createOld(7, CACHE_STORES, (tx) => {
      tx.objectStore(CACHE_META_STORE).put({ category: 'total', bytes: 10, entries: 1 });
    });

    const db = await openFresh();
    expect(db.version).toBe(8);
    const tx = db.transaction(CACHE_META_STORE);
    expect(await requestResult(tx.objectStore(CACHE_META_STORE).get('total')))
      .toMatchObject({ bytes: 10, entries: 1 });
  });
});
