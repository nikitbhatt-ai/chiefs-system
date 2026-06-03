"use client";

import { useState, useTransition } from "react";
import {
  addVehiclePhoto,
  removeVehiclePhoto,
  reorderVehiclePhotos,
} from "@/lib/vehiclePhotoActions";

type UploadingItem = {
  name: string;
  progress: number;
  phase: "preparing" | "uploading";
  error?: string;
};

// Replace anything outside printable ASCII so the file name is safe to
// stuff into the Content-Disposition header that XHR builds for us.
// Non-ASCII chars (e.g., →, é, smart quotes) trip the browser's
// ByteString check and the whole upload throws before sending.
function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "photo";
}

// Re-encode any image down to maxDim on the longest side, JPEG ~quality,
// so 5-8 MB phone photos become ~500 KB and slip under the serverless
// request limit. Returns a new File; falls back to the original if the
// browser fails to decode the source (e.g., an unusual format).
async function shrinkImage(
  file: File,
  maxDim = 2048,
  quality = 0.85
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) return file;
  const baseName = safeFilename(file.name.replace(/\.[^.]+$/, ""));
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function uploadOne(
  file: File,
  pathname: string,
  onProgress: (pct: number) => void
): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("pathname", pathname);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/blob/upload");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress((e.loaded / e.total) * 100);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Bad response from server."));
        }
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (body.error) msg = body.error;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(formData);
  });
}

export function VehiclePhotos({
  vehicleId,
  photos: initialPhotos,
}: {
  vehicleId: string;
  photos: string[];
}) {
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [uploading, setUploading] = useState<UploadingItem[]>([]);
  const [, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const items: UploadingItem[] = Array.from(files).map((f) => ({
      name: f.name,
      progress: 0,
      phase: "preparing" as const,
    }));
    setUploading((u) => [...u, ...items]);

    await Promise.all(
      Array.from(files).map(async (file, idx) => {
        const name = items[idx].name;
        try {
          const shrunk = await shrinkImage(file);
          const safeName = safeFilename(shrunk.name);
          const toUpload =
            safeName === shrunk.name
              ? shrunk
              : new File([shrunk], safeName, { type: shrunk.type });
          setUploading((u) =>
            u.map((x) =>
              x.name === name ? { ...x, phase: "uploading", progress: 0 } : x
            )
          );
          const blob = await uploadOne(
            toUpload,
            `vehicles/${vehicleId}/${safeName}`,
            (pct) => {
              setUploading((u) =>
                u.map((x) => (x.name === name ? { ...x, progress: pct } : x))
              );
            }
          );
          await addVehiclePhoto(vehicleId, blob.url);
          setPhotos((p) => (p.includes(blob.url) ? p : [...p, blob.url]));
          setUploading((u) => u.filter((x) => x.name !== name));
        } catch (err) {
          const msg = (err as Error).message || "Upload failed.";
          setUploading((u) =>
            u.map((x) => (x.name === name ? { ...x, error: msg } : x))
          );
        }
      })
    );
  }

  function handleRemove(url: string) {
    setPhotos((p) => p.filter((x) => x !== url));
    startTransition(async () => {
      try {
        await removeVehiclePhoto(vehicleId, url);
      } catch {
        setPhotos((p) => (p.includes(url) ? p : [...p, url]));
      }
    });
  }

  function dismissError(name: string) {
    setUploading((u) => u.filter((x) => x.name !== name));
  }

  // Drag-and-drop reorder. `dragIndex` is the slot the user grabbed;
  // `overIndex` is the slot the pointer is currently over. On drop we
  // splice the dragged item into the new position and persist.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function commitReorder(from: number, to: number) {
    if (from === to) return;
    const before = photos;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPhotos(next);
    startTransition(async () => {
      try {
        await reorderVehiclePhotos(vehicleId, next);
      } catch {
        setPhotos(before);
      }
    });
  }

  return (
    <div className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-body font-semibold text-white uppercase tracking-wider">
          Photos
        </h3>
        <label className="text-xs font-body font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/10 rounded-md px-3 py-1.5 cursor-pointer transition-colors">
          + Add photos
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <p className="text-[11px] text-zinc-500">
        JPEG / PNG / WebP. Photos are auto-resized to 2048px and saved as
        JPEG. HEIC isn't supported — on iPhone, Settings → Camera → Formats
        → Most Compatible. Drag to reorder; the first photo is the cover on
        Shopify.
      </p>

      {photos.length === 0 && uploading.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No photos yet. Required before publishing to Shopify.
        </p>
      ) : null}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {photos.map((url, idx) => {
          const isOver = overIndex === idx && dragIndex !== null && dragIndex !== idx;
          const isDragging = dragIndex === idx;
          return (
            <div
              key={url}
              draggable
              onDragStart={(e) => {
                setDragIndex(idx);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overIndex !== idx) setOverIndex(idx);
              }}
              onDragLeave={() => {
                if (overIndex === idx) setOverIndex(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) commitReorder(dragIndex, idx);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={`relative group aspect-square bg-black/40 border rounded overflow-hidden cursor-grab active:cursor-grabbing transition-opacity ${
                isOver ? "border-amber-400" : "border-white/5"
              } ${isDragging ? "opacity-40" : ""}`}
              title={idx === 0 ? "Cover photo (first on Shopify)" : `Photo #${idx + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
                draggable={false}
              />
              {idx === 0 ? (
                <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-wider bg-amber-500/90 text-black rounded px-1 py-0.5 font-semibold">
                  Cover
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => handleRemove(url)}
                className="absolute top-1 right-1 text-[10px] bg-black/70 hover:bg-red-600 text-white rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Remove
              </button>
            </div>
          );
        })}
        {uploading.map((u) => (
          <div
            key={u.name}
            className="relative aspect-square bg-black/40 border border-white/10 border-dashed rounded flex flex-col items-center justify-center text-[10px] text-zinc-400 p-2 text-center"
          >
            {u.error ? (
              <>
                <span className="text-red-400 break-words">{u.error}</span>
                <button
                  type="button"
                  onClick={() => dismissError(u.name)}
                  className="mt-1 text-[10px] text-zinc-500 hover:text-zinc-200 underline"
                >
                  dismiss
                </button>
              </>
            ) : (
              <>
                <span className="truncate w-full">{u.name}</span>
                <span className="mt-1">
                  {u.phase === "preparing"
                    ? "Resizing…"
                    : `${Math.round(u.progress)}%`}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
