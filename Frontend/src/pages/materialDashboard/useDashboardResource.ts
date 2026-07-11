import { useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import { getMaterialDashboardCacheValue, setMaterialDashboardCacheValue } from "../../lib/materialDashboardCache";

const MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMORY_CACHE_MAX_ENTRIES = 40;

type MemoryCacheEntry = { value: unknown; cachedAt: number };
const memoryCache = new Map<string, MemoryCacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getMemoryCacheValue<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry || Date.now() - entry.cachedAt > MEMORY_CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  // Refresh insertion order so the map also acts as a small LRU cache.
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value as T;
}

function setMemoryCacheValue<T>(key: string, value: T) {
  memoryCache.delete(key);
  memoryCache.set(key, { value, cachedAt: Date.now() });
  while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    memoryCache.delete(oldestKey);
  }
}

function getSharedRequest<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const request = fetcher().finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, request);
  return request;
}

type DashboardResourceOptions<T> = {
  /** Cache key for both the in-memory and persistent caches. `null` disables the resource. */
  cacheKey: string | null;
  enabled?: boolean;
  /** Bumping this forces a refetch that bypasses caches (once per nonce value). */
  refreshNonce?: number;
  fetcher: (forceRefresh: boolean) => Promise<T>;
  /** Fallback message when the request fails without a structured ApiError. */
  errorMessage: string;
  /** Called with cached and fresh data alike, e.g. to sync the current selection. */
  onData?: (data: T) => void;
  onError?: () => void;
};

export type DashboardResource<T> = {
  data: T | null;
  /** True while fetching without anything to show yet. */
  loading: boolean;
  /** True while revalidating data that is already on screen. */
  refreshing: boolean;
  error: string | null;
};

/**
 * Stale-while-revalidate loader shared by every dashboard endpoint: serve the
 * in-memory or IndexedDB cache immediately when available, then fetch in the
 * background and persist the response. Errors only surface when there was no
 * cached value to fall back on.
 */
export function useDashboardResource<T>({
  cacheKey,
  enabled = true,
  refreshNonce = 0,
  fetcher,
  errorMessage,
  onData,
  onError,
}: DashboardResourceOptions<T>): DashboardResource<T> {
  const [current, setCurrent] = useState<{ key: string; value: T } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledRefreshNonceRef = useRef(0);
  // Callbacks are kept in refs so a new closure each render doesn't retrigger the effect.
  const callbacksRef = useRef({ fetcher, errorMessage, onData, onError });
  callbacksRef.current = { fetcher, errorMessage, onData, onError };

  useEffect(() => {
    if (!enabled || !cacheKey) {
      setError(null);
      setLoading(false);
      return;
    }
    const key = cacheKey;
    let cancelled = false;

    async function load() {
      const forceRefresh = refreshNonce > 0 && handledRefreshNonceRef.current !== refreshNonce;
      if (forceRefresh) {
        handledRefreshNonceRef.current = refreshNonce;
      }
      let hasCached = false;
      setError(null);
      setLoading(true);
      if (!forceRefresh) {
        const cached = getMemoryCacheValue<T>(key) ?? (await getMaterialDashboardCacheValue<T>(key));
        if (cancelled) {
          return;
        }
        if (cached !== null && cached !== undefined) {
          hasCached = true;
          setMemoryCacheValue(key, cached);
          setCurrent({ key, value: cached });
          callbacksRef.current.onData?.(cached);
        }
      }
      try {
        const response = forceRefresh
          ? await callbacksRef.current.fetcher(true)
          : await getSharedRequest(key, () => callbacksRef.current.fetcher(false));
        if (cancelled) {
          return;
        }
        setMemoryCacheValue(key, response);
        setCurrent({ key, value: response });
        callbacksRef.current.onData?.(response);
        void setMaterialDashboardCacheValue(key, response);
      } catch (err) {
        if (!cancelled && !hasCached) {
          setError(err instanceof ApiError ? err.message : callbacksRef.current.errorMessage);
          callbacksRef.current.onError?.();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, refreshNonce]);

  const data = enabled && cacheKey
    ? current?.key === cacheKey
      ? current.value
      : getMemoryCacheValue<T>(cacheKey)
    : null;
  return { data, loading, refreshing: loading && data !== null, error };
}
