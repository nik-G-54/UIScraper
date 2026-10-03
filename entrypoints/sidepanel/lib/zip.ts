import JSZip from 'jszip';

export interface PackFile {
  /** Path inside the zip, e.g. `assets/images/01-hero.jpg`. */
  path: string;
  data: string | Uint8Array;
}

/** Already-compressed formats are stored as is; everything else is deflated. */
const STORED = /\.(jpe?g|png|webp|gif|avif|zip)$/i;

/** Build the design pack zip in memory. */
export async function buildZip(files: readonly PackFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.data, { compression: STORED.test(file.path) ? 'STORE' : 'DEFLATE' });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
