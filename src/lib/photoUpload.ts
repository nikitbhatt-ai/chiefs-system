"use client";

// Browser-side photo upload helpers, shared by the vehicle photo gallery and
// the lot check-in form. Extracted from VehiclePhotos so both paths shrink,
// name and upload files identically — a phone photo that is too big for one
// screen is too big for the other.

// Replace anything outside printable ASCII so the file name is safe to stuff
// into the Content-Disposition header that XHR builds for us. Non-ASCII chars
// (e.g. →, é, smart quotes) trip the browser's ByteString check and the whole
// upload throws before sending.
export function safeFilename(name: string): string {
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

// Re-encode any image down to maxDim on the longest side, JPEG ~quality, so
// 5-8 MB phone photos become ~500 KB and slip under the serverless request
// limit. Returns a new File; falls back to the original if the browser fails
// to decode the source (e.g. an unusual format).
export async function shrinkImage(
  file: File,
  maxDim = 2048,
  quality = 0.85,
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
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
  );
  if (!blob) return file;
  const baseName = safeFilename(file.name.replace(/\.[^.]+$/, ""));
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

// XHR rather than fetch, because fetch gives no upload progress and on a lot
// with one bar the progress is the only sign it has not died.
export function uploadOne(
  file: File,
  pathname: string,
  onProgress: (pct: number) => void,
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

// Shrink, sanitise and upload in one step — what both callers actually want.
export async function prepareAndUpload(
  file: File,
  pathnamePrefix: string,
  onProgress: (pct: number) => void = () => {},
): Promise<{ url: string }> {
  const shrunk = await shrinkImage(file);
  const safeName = safeFilename(shrunk.name);
  const toUpload =
    safeName === shrunk.name ? shrunk : new File([shrunk], safeName, { type: shrunk.type });
  return uploadOne(toUpload, `${pathnamePrefix}/${safeName}`, onProgress);
}
