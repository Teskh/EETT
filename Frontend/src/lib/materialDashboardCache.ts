const MATERIAL_DASHBOARD_CACHE_DB = "spec-sheets-material-dashboard";
const MATERIAL_DASHBOARD_CACHE_STORE = "entries";
const MATERIAL_DASHBOARD_CACHE_VERSION = 1;

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
  return record?.value ?? null;
}

export async function setMaterialDashboardCacheValue<T>(key: string, value: T): Promise<void> {
  const record: MaterialDashboardCacheRecord<T> = {
    key,
    value,
    cachedAt: new Date().toISOString(),
  };
  await withStore("readwrite", (store) => store.put(record));
}
