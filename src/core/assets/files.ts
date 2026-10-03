const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
};
const KNOWN_EXTENSIONS = new Set(Object.values(MIME_EXTENSIONS).concat(['jpeg', 'ico']));

/** File extension for a downloaded image: from its content type, else its URL, else `bin`. */
export function imageExtension(mime: string | null, url: string): string {
  const fromMime = mime ? MIME_EXTENSIONS[mime.split(';')[0]?.trim().toLowerCase() ?? ''] : undefined;
  if (fromMime) return fromMime;
  const dataMime = /^data:([^;,]+)/i.exec(url)?.[1];
  if (dataMime && MIME_EXTENSIONS[dataMime.toLowerCase()]) return MIME_EXTENSIONS[dataMime.toLowerCase()] as string;
  try {
    const ext = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
    if (ext && KNOWN_EXTENSIONS.has(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  } catch {
    // not a URL
  }
  return 'bin';
}

/** `hero-banner` from a URL: the file name without extension, lowercased and file-system safe. */
export function slugFromUrl(url: string, fallback: string): string {
  let base = '';
  if (!url.startsWith('data:')) {
    try {
      base = decodeURIComponent((new URL(url).pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, ''));
    } catch {
      base = '';
    }
  }
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

/** `assets/images/03-hero-banner.jpg` */
export function assetPath(folder: 'images' | 'icons' | 'screens', index: number, slug: string, ext: string): string {
  return `assets/${folder}/${String(index).padStart(2, '0')}-${slug}.${ext}`;
}

/** A readable form of a long or `data:` URL for design.md. */
export function shortUrl(url: string, max = 90): string {
  if (url.startsWith('data:')) return `${url.slice(0, url.indexOf(',') > 0 ? Math.min(url.indexOf(','), 40) : 30)}…(inline, ${url.length} chars)`;
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}
