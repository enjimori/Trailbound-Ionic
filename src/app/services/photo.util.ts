/**
 * Photo helpers for community posts.
 *
 * Photos are stored inside the Firestore post document as JPEG data URLs, the
 * same way profile avatars are, so no Firebase Storage (paid plan) is needed.
 * A Firestore document is capped at 1 MiB, which is why every photo is shrunk
 * here before it is posted.
 *
 * Re-drawing through a canvas also strips the photo's EXIF metadata — including
 * the GPS position most phones embed — so posting a summit photo never leaks
 * where the hiker lives or parked.
 */

/** Longest side of a posted photo, in pixels. */
const PHOTO_MAX_SIDE = 1280;
/** Size budget per photo (characters of data URL). Four of these fit in one post. */
const PHOTO_MAX_CHARS = 210_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency; without a fill, transparent PNGs turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Shrinks a picked photo until it fits the per-photo budget.
 * Tries lower quality first (barely visible), then smaller dimensions.
 */
export async function compressPhoto(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    let side = PHOTO_MAX_SIDE;
    let quality = 0.8;
    for (let attempt = 0; attempt < 8; attempt++) {
      const out = draw(img, side, quality);
      if (out.length <= PHOTO_MAX_CHARS) return out;
      if (quality > 0.6) quality = Math.round((quality - 0.1) * 100) / 100;
      else side = Math.round(side * 0.8);
    }
    return draw(img, 640, 0.55);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Small square avatar for the public profile shown beside posts and comments. */
export async function makeAvatarThumb(dataUrl: string, size = 128): Promise<string> {
  const img = await loadImage(dataUrl);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** True for files the browser should be able to decode as a photo. */
export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  // Some Android galleries hand over files with an empty type.
  return !file.type && /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name);
}
