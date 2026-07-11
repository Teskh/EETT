const MATERIAL_DASHBOARD_CACHE_DB = "spec-sheets-material-dashboard";
const MATERIAL_DASHBOARD_CACHE_STORE = "entries";
const MATERIAL_DASHBOARD_CACHE_VERSION = 1;
const MATERIAL_DASHBOARD_CACHE_TTL_MS = 15 * 60 * 1000;
const MATERIAL_DASHBOARD_CACHE_MAX_ENTRIES = 100;
const MATERIAL_DASHBOARD_CACHE_PRUNE_INTERVAL_MS = 60 * 1000;
let lastPrunedAt = 0;

type MaterialDashboardCacheRecord<T> = {
  key: string;
  value: T;
  cachedAt: string;
};

function supportsIndexedDb() {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openMaterialDashboardCache() {
  if (!supportsIndexedDb()) {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(MATERIAL_DASHBOARD_CACHE_DB, MATERIAL_DASHBOARD_CACHE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MATERIAL_DASHBOARD_CACHE_STORE)) {
        database.createObjectStore(MATERIAL_DASHBOARD_CACHE_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openMaterialDashboardCache();
  if (!database) {
    return null;
  }

  return new Promise<T | null>((resolve) => {
    const transaction = database.transaction(MATERIAL_DASHBOARD_CACHE_STORE, mode);
    const store = transaction.objectStore(MATERIAL_DASHBOARD_CACHE_STORE);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);

    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

export async function getMaterialDashboardCacheValue<T>(key: string): Promise<T | null> {
  const record = await withStore<MaterialDashboardCacheRecord<T>>("readonly", (store) => store.get(key));
  if (!record) {
    return null;
  }
  const cachedAt = Date.parse(record.cachedAt);
  if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > MATERIAL_DASHBOARD_CACHE_TTL_MS) {
    void withStore("readwrite", (store) => store.delete(key));
    return null;
  }
  return record?.value ?? null;
}

async function pruneMaterialDashboardCache(): Promise<void> {
  if (Date.now() - lastPrunedAt < MATERIAL_DASHBOARD_CACHE_PRUNE_INTERVAL_MS) {
    return;
  }
  lastPrunedAt = Date.now();
  const database = await openMaterialDashboardCache();
  if (!database) {
    return;
  }
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(MATERIAL_DASHBOARD_CACHE_STORE, "readwrite");
    const store = transaction.objectStore(MATERIAL_DASHBOARD_CACHE_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = (request.result as MaterialDashboardCacheRecord<unknown>[]).sort(
        (left, right) => Date.parse(right.cachedAt) - Date.parse(left.cachedAt),
      );
      const now = Date.now();
      records.forEach((record, index) => {
        const cachedAt = Date.parse(record.cachedAt);
        if (index >= MATERIAL_DASHBOARD_CACHE_MAX_ENTRIES || !Number.isFinite(cachedAt) || now - cachedAt > MATERIAL_DASHBOARD_CACHE_TTL_MS) {
          store.delete(record.key);
        }
      });
    };
    request.onerror = () => resolve();
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}

export async function setMaterialDashboardCacheValue<T>(key: string, value: T): Promise<void> {
  const record: MaterialDashboardCacheRecord<T> = {
    key,
    value,
    cachedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record));
  await pruneMaterialDashboardCache();
}
