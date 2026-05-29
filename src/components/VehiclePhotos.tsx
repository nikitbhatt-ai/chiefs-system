"use client";

import { upload } from "@vercel/blob/client";
import { useState, useTransition } from "react";
import {
  addVehiclePhoto,
  removeVehiclePhoto,
} from "@/lib/vehiclePhotoActions";

type UploadingItem = {
  name: string;
  progress: number;
  error?: string;
};

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
    }));
    setUploading((u) => [...u, ...items]);

    await Promise.all(
      Array.from(files).map(async (file, idx) => {
        try {
          const blob = await upload(
            `vehicles/${vehicleId}/${file.name}`,
            file,
            {
              access: "public",
              handleUploadUrl: "/api/blob/upload",
              onUploadProgress: (e) => {
                setUploading((u) => {
                  const copy = [...u];
                  const target = copy.find((x) => x.name === items[idx].name);
                  if (target) target.progress = e.percentage;
                  return copy;
                });
              },
            }
          );
          await addVehiclePhoto(vehicleId, blob.url);
          setPhotos((p) => (p.includes(blob.url) ? p : [...p, blob.url]));
        } catch (err) {
          setUploading((u) => {
            const copy = [...u];
            const target = copy.find((x) => x.name === items[idx].name);
            if (target) target.error = (err as Error).message;
            return copy;
          });
          return;
        }
        setUploading((u) => u.filter((x) => x.name !== items[idx].name));
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
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {photos.length === 0 && uploading.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No photos yet. Required before publishing to Shopify.
        </p>
      ) : null}

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {photos.map((url) => (
          <div
            key={url}
            className="relative group aspect-square bg-black/40 border border-white/5 rounded overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => handleRemove(url)}
              className="absolute top-1 right-1 text-[10px] bg-black/70 hover:bg-red-600 text-white rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Remove
            </button>
          </div>
        ))}
        {uploading.map((u) => (
          <div
            key={u.name}
            className="aspect-square bg-black/40 border border-white/10 border-dashed rounded flex flex-col items-center justify-center text-[10px] text-zinc-400 p-2 text-center"
          >
            {u.error ? (
              <span className="text-red-400">{u.error}</span>
            ) : (
              <>
                <span className="truncate w-full">{u.name}</span>
                <span className="mt-1">{Math.round(u.progress)}%</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
