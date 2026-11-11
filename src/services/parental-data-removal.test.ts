// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  openPersistenceDb,
  requestResult,
  USER_DATA_STORES,
  USER_META_STORE,
} from './idb-database';
import { DB_NAME } from './idb-schema';
import { StorageService } from './storage-service';

// What a version with parental controls left behind: a v7 database with the
// parental-control store, and its localStorage keys.
function createV7WithParentalStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 7);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [...USER_DATA_STORES, 'parental-control']) {
        db.createObjectStore(name, { keyPath: 'key' });
      }
      db.createObjectStore(USER_META_STORE, { keyPath: 'key' });
      const tx = req.transaction!;
      tx.objectStore('parental-control').put({
        key: 'config',
        value: { enabled: true, concealMode: 'hide-locked', groupRules: { g1: 'protect' } },
      });
      tx.objectStore('favorites').put({ key: 'favorite:ch1', value: 'ch1' });
      tx.objectStore(USER_META_STORE).put({ key: 'migration:favorites', migratedAt: 1 });
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe('parental controls data removal', () => {
  it('drops the stored parental data on boot and keeps the rest', async () => {
    await createV7WithParentalStore();
    const config = JSON.stringify({ enabled: true, concealMode: 'hide-locked' });
    localStorage.setItem('iptv_parental_control', config);
    localStorage.setItem('iptv_parental_throttle', '{"failures":5,"lockouts":1,"blockedUntil":1}');
    localStorage.setItem('iptv_fb_parental-control', `{"r":{"config":{"v":{"key":"config","value":${config}},"t":1}},"d":{}}`);
    localStorage.setItem('iptv_theme', '"light"');

    await StorageService.init();

    expect(localStorage.getItem('iptv_parental_control')).toBeNull();
    expect(localStorage.getItem('iptv_parental_throttle')).toBeNull();
    expect(localStorage.getItem('iptv_fb_parental-control')).toBeNull();
    expect(localStorage.getItem('iptv_theme')).toBe('"light"');
    const db = (await openPersistenceDb())!;
    expect(db.version).toBe(8);
    expect(db.objectStoreNames.contains('parental-control')).toBe(false);
    expect(StorageService.getFavorites()).toEqual(['ch1']);
    const tx = db.transaction('favorites');
    expect(await requestResult(tx.objectStore('favorites').get('favorite:ch1')))
      .toEqual({ key: 'favorite:ch1', value: 'ch1' });
  });
});
