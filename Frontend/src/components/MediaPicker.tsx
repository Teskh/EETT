import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { toAppPath } from "../lib/basePath";
import type { MediaAsset } from "../lib/types";

type MediaPickerProps = {
  value: MediaAsset | null;
  onChange: (asset: MediaAsset | null) => void;
  compact?: boolean;
  /** A large preview with the gallery and actions below it, in the catalog's flat style. */
  tile?: boolean;
};

export function MediaPicker({ value, onChange, compact = false, tile = false }: MediaPickerProps) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getMediaAssets()
      .then((response) => {
        if (!cancelled) {
          setAssets(response.assets);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la galería.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedAsset = useMemo(() => {
    if (!value) {
      return null;
    }
    return assets.find((asset) => asset.id === value.id) || value;
  }, [assets, value]);

  async function handleUpload(file: File | undefined) {
    if (!file) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const asset = await api.uploadMediaAsset(file);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      onChange(asset);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  }

  if (tile) {
    const src = selectedAsset ? toAppPath(selectedAsset.uri) : null;
    return (
      <div className="flex flex-col gap-1.5">
        {src ? (
          <a href={src} target="_blank" rel="noreferrer" title="Abrir imagen en tamaño completo"
            className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden border border-black/10 bg-white hover:border-black/30 dark:border-white/10 dark:bg-zinc-950 dark:hover:border-white/30">
            <img src={src} alt={selectedAsset?.original_filename || "Imagen"} className="h-full w-full object-contain" />
          </a>
        ) : (
          <label className="flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-black/15 text-xs text-zinc-400 hover:border-black/40 hover:text-zinc-600 dark:border-white/15 dark:hover:border-white/40 dark:hover:text-zinc-300">
            <i className="ph ph-image text-3xl" aria-hidden="true" />
            {uploading ? "Subiendo…" : "Subir imagen"}
            <input type="file" accept="image/png,image/jpeg,image/gif" className="hidden" disabled={uploading} onChange={(event) => void handleUpload(event.target.files?.[0])} />
          </label>
        )}
        <select
          value={selectedAsset?.id || ""}
          onChange={(event) => {
            const id = Number(event.target.value);
            onChange(assets.find((asset) => asset.id === id) || null);
          }}
          disabled={loading}
          aria-label="Imagen de la galería"
          className="h-7 w-full border border-black/10 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="">{loading ? "Cargando galería…" : "Sin imagen"}</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.original_filename || `Imagen ${asset.id}`}
            </option>
          ))}
        </select>
        {selectedAsset ? (
          <div className="flex gap-3 text-[10px] text-zinc-500">
            <label className="cursor-pointer hover:text-zinc-950 dark:hover:text-white">
              <i className="ph-bold ph-upload-simple mr-1" aria-hidden="true" />{uploading ? "Subiendo…" : "Subir otra"}
              <input type="file" accept="image/png,image/jpeg,image/gif" className="hidden" disabled={uploading} onChange={(event) => void handleUpload(event.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => onChange(null)} className="hover:text-red-700 dark:hover:text-red-400">
              <i className="ph-bold ph-x mr-1" aria-hidden="true" />Quitar
            </button>
          </div>
        ) : null}
        {error ? <div className="text-[11px] text-red-600 dark:text-red-400">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="border border-black/10 dark:border-white/10 rounded-lg bg-white dark:bg-black/30 p-3 flex flex-col gap-3">
      <div className={compact ? "flex gap-3" : "grid grid-cols-[112px_1fr] gap-3"}>
        <div className="w-28 aspect-[4/3] rounded bg-zinc-100 dark:bg-white/5 border border-black/10 dark:border-white/10 overflow-hidden flex items-center justify-center text-zinc-400">
          {selectedAsset ? (
            <img src={toAppPath(selectedAsset.uri)} alt={selectedAsset.original_filename || "Imagen"} className="w-full h-full object-contain" />
          ) : (
            <i className="ph-bold ph-image text-2xl" />
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <select
            value={selectedAsset?.id || ""}
            onChange={(event) => {
              const id = Number(event.target.value);
              onChange(assets.find((asset) => asset.id === id) || null);
            }}
            disabled={loading}
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded p-2 text-xs text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-accent-500/50 font-mono"
          >
            <option value="">{loading ? "Cargando galería..." : "Sin imagen"}</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.original_filename || `Imagen ${asset.id}`}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <label className="px-2.5 py-1.5 bg-zinc-50 dark:bg-white/5 hover:bg-zinc-100 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 rounded text-xs font-semibold cursor-pointer text-zinc-800 dark:text-zinc-200">
              <i className="ph-bold ph-upload-simple mr-1" /> {uploading ? "Subiendo..." : "Subir"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="px-2.5 py-1.5 bg-white dark:bg-black/20 hover:bg-zinc-50 dark:hover:bg-white/5 border border-black/10 dark:border-white/10 rounded text-xs font-semibold text-zinc-700 dark:text-zinc-300"
            >
              <i className="ph-bold ph-x mr-1" /> Quitar
            </button>
          </div>
          {selectedAsset ? (
            <div className="truncate text-[10px] font-mono text-zinc-500">{selectedAsset.original_filename || selectedAsset.uri}</div>
          ) : null}
        </div>
      </div>
      {error ? <div className="text-[11px] text-red-600 dark:text-red-400 font-mono">{error}</div> : null}
    </div>
  );
}
