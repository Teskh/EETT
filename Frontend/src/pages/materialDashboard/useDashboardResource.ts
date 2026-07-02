import { useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import { getMaterialDashboardCacheValue, setMaterialDashboardCacheValue } from "../../lib/materialDashboardCache";

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
  const [cache, setCache] = useState<Record<string, T>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledRefreshNonceRef = useRef(0);
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
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
      if (!forceRefresh) {
        const cached = cacheRef.current[key] ?? (await getMaterialDashboardCacheValue<T>(key));
        if (cancelled) {
          return;
        }
        if (cached !== null && cached !== undefined) {
          hasCached = true;
          setCache((current) => (current[key] ? current : { ...current, [key]: cached }));
          callbacksRef.current.onData?.(cached);
          setLoading(false);
        }
      }
      if (!hasCached) {
        setLoading(true);
      }
      try {
        const response = await callbacksRef.current.fetcher(forceRefresh);
        if (cancelled) {
          return;
        }
        setCache((current) => ({ ...current, [key]: response }));
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

  const data = enabled && cacheKey ? cache[cacheKey] ?? null : null;
  return { data, loading, refreshing: loading && data !== null, error };
}
