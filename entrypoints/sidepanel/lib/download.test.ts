import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validResult } from '@/src/core/extract/fixtures';
import { downloadCaptureJson } from './download';

type DeltaListener = (delta: { id: number; state?: { current: string }; error?: { current: string } }) => void;

let listeners: Set<DeltaListener>;
let download: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;
let blobs: Blob[];

beforeEach(() => {
  listeners = new Set();
  blobs = [];
  download = vi.fn(async () => 42);
  search = vi.fn(async () => []);
  vi.stubGlobal('chrome', {
    downloads: {
      download,
      search,
      onChanged: {
        addListener: (l: DeltaListener) => listeners.add(l),
        removeListener: (l: DeltaListener) => listeners.delete(l),
      },
    },
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:chrome-extension://abc/123';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const finishWith = (state: string, error?: string) =>
  setTimeout(() => listeners.forEach((l) => l({ id: 42, state: { current: state }, ...(error ? { error: { current: error } } : {}) })), 0);

describe('downloadCaptureJson', () => {
  it('saves compact JSON through chrome.downloads using a blob URL, and returns the file name', async () => {
    const result = validResult();
    finishWith('complete');
    const filename = await downloadCaptureJson(result);

    expect(filename).toMatch(/^designlens-example\.com-\d{8}-\d{6}\.json$/);
    expect(download).toHaveBeenCalledWith({
      url: 'blob:chrome-extension://abc/123',
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(blobs[0]?.type).toBe('application/json');
    expect(await blobs[0]?.text()).toBe(JSON.stringify(result)); // compact, round-trips
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:chrome-extension://abc/123');
    expect(listeners.size).toBe(0);
  });

  it('works when the download had already finished before we started listening', async () => {
    search.mockResolvedValueOnce([{ id: 42, state: 'complete' }]);
    await expect(downloadCaptureJson(validResult())).resolves.toMatch(/\.json$/);
  });

  it('reports a cancelled download readably', async () => {
    finishWith('interrupted', 'USER_CANCELED');
    await expect(downloadCaptureJson(validResult())).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
      message: expect.stringContaining('cancelled') as string,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('reports an interrupted download with Chrome’s reason', async () => {
    finishWith('interrupted', 'FILE_ACCESS_DENIED');
    await expect(downloadCaptureJson(validResult())).rejects.toThrow(/FILE_ACCESS_DENIED/);
  });

  it('reports chrome.downloads.download itself failing', async () => {
    download.mockRejectedValueOnce(new Error('Invalid filename'));
    await expect(downloadCaptureJson(validResult())).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
      message: expect.stringContaining('Invalid filename') as string,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('gives up if Chrome never finishes', async () => {
    vi.useFakeTimers();
    const promise = downloadCaptureJson(validResult());
    const assertion = expect(promise).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(121_000);
    await assertion;
    expect(listeners.size).toBe(0);
  });
});
