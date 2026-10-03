import { describe, expect, it } from 'vitest';
import { buildCaptureFileName, getPageRestriction } from './url';

describe('getPageRestriction', () => {
  it.each([
    ['chrome://settings', 'browser-page'],
    ['chrome://extensions/', 'browser-page'],
    ['edge://settings', 'browser-page'],
    ['about:blank', 'browser-page'],
    ['about:srcdoc', 'browser-page'],
    ['view-source:https://example.com/', 'browser-page'],
    ['devtools://devtools/bundled/inspector.html', 'browser-page'],
    ['chrome-untrusted://terminal/', 'browser-page'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/page.html', 'extension-page'],
    ['chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'extension-page'],
    ['https://chromewebstore.google.com/', 'web-store'],
    ['https://chromewebstore.google.com/detail/some-ext/abc', 'web-store'],
    ['https://chrome.google.com/webstore', 'web-store'],
    ['https://chrome.google.com/webstore/category/extensions', 'web-store'],
    ['file:///C:/Users/me/index.html', 'local-file'],
    ['file:///home/me/page.html', 'local-file'],
    ['https://example.com/docs/spec.pdf', 'pdf-viewer'],
    ['http://example.com/SPEC.PDF', 'pdf-viewer'],
    ['ftp://example.com/', 'unsupported-protocol'],
    ['data:text/html,<p>hi</p>', 'unsupported-protocol'],
  ])('restricts %s', (url, kind) => {
    const result = getPageRestriction(url);
    expect(result.restricted).toBe(true);
    if (result.restricted) {
      expect(result.kind).toBe(kind);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it.each([undefined, null, '', 'not a url'])('restricts missing or invalid URL %j', (url) => {
    expect(getPageRestriction(url).restricted).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://example.com/path?q=1#hash',
    'https://sub.example.co.uk/a/b',
    'http://localhost:3000/',
    // Look-alikes that must NOT be treated as the Web Store or a PDF.
    'https://chrome.google.com/webstorefoo',
    'https://chrome.google.com/',
    'https://chrome.google.com/intl/en/chrome/',
    'https://notchromewebstore.google.com/',
    'https://example.com/chromewebstore.google.com',
    'https://example.com/pdf',
    'https://example.com/report.pdf.html',
  ])('allows %s', (url) => {
    expect(getPageRestriction(url)).toEqual({ restricted: false });
  });
});

describe('buildCaptureFileName', () => {
  const when = new Date(2026, 2, 5, 9, 7, 3); // local time: 2026-03-05 09:07:03

  it('uses designlens-<hostname>-<timestamp>.json', () => {
    expect(buildCaptureFileName('https://www.example.com/a/b?q=1', when)).toBe(
      'designlens-www.example.com-20260305-090703.json',
    );
  });

  it('sanitizes the hostname for any filesystem', () => {
    expect(buildCaptureFileName('http://[::1]:3000/', when)).toBe('designlens-1-20260305-090703.json');
    expect(buildCaptureFileName('https://münchen.example/', when)).toMatch(/^designlens-[a-z0-9.-]+-20260305-090703\.json$/);
    expect(buildCaptureFileName('http://EXAMPLE.com./x', when)).toBe('designlens-example.com-20260305-090703.json');
  });

  it('never contains path separators or odd characters', () => {
    const name = buildCaptureFileName('https://a.b/../../etc/passwd', when);
    expect(name).toMatch(/^designlens-[a-z0-9.-]+-\d{8}-\d{6}\.json$/);
  });

  it('falls back to "page" when there is no usable hostname', () => {
    expect(buildCaptureFileName('not a url', when)).toBe('designlens-page-20260305-090703.json');
    expect(buildCaptureFileName('file:///C:/x.html', when)).toBe('designlens-page-20260305-090703.json');
  });
});
