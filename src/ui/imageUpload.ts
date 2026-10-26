// Image upload, paste, drag-and-drop, and client-side compression helper.
// Converts dropped/pasted/selected image files into compact data URLs so they stay self-contained in IndexedDB,
// JSON exports, and Markdown zip exports without needing an external server.

export interface ProcessedImage {
  name: string;
  dataUrl: string;
  markdown: string;
}

/** Clean filename without extension for use as default alt text. */
export function cleanImageAlt(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base || 'image';
}

/**
 * Reads an image File/Blob, scales it down if wider/taller than `maxDim` (default 960px), and encodes as WebP/JPEG
 * (or keeps SVG/small PNGs as-is) so embedded Markdown images remain lightweight.
 */
export async function fileToImageMarkdown(file: File, maxDim = 960): Promise<ProcessedImage> {
  const alt = cleanImageAlt(file.name);
  const rawUrl = await readFileAsDataUrl(file);
  if (file.type === 'image/svg+xml' || rawUrl.length < 48_000) {
    return { name: alt, dataUrl: rawUrl, markdown: `![${alt}](${rawUrl})` };
  }
  try {
    const compressed = await resizeDataUrl(rawUrl, maxDim, 0.82);
    return { name: alt, dataUrl: compressed, markdown: `![${alt}](${compressed})` };
  } catch {
    return { name: alt, dataUrl: rawUrl, markdown: `![${alt}](${rawUrl})` };
  }
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function resizeDataUrl(dataUrl: string, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/webp', quality);
      resolve(out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Invalid image'));
    img.src = dataUrl;
  });
}

/** Opens a native file picker for an image and resolves with the processed image (or null if cancelled). */
export function pickImageFile(maxDim = 960): Promise<ProcessedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const processed = await fileToImageMarkdown(file, maxDim);
      resolve(processed);
    };
    input.click();
  });
}
