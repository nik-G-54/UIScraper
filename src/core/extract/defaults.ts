import type { StyleRecord } from '../../shared/types';
import { readAllStyles } from './styles';

/** Browser-default style values for a tag, used to keep only what the page changed. */
export interface DefaultStyleSource {
  forElement(el: Element): StyleRecord;
  /** Defaults for ::before / ::after boxes (inline, like a span). */
  forPseudo(): StyleRecord;
  /** True for elements this source added to the page (they must never be captured). */
  owns(el: Element): boolean;
  /** Remove anything temporary this source added to the page. Safe to call repeatedly. */
  dispose(): void;
  /** Set when defaults could not be computed (every value is then recorded). */
  readonly problem: string | null;
}

const FRAME_STYLE = [
  'position:fixed',
  'left:-10000px',
  'top:0',
  'width:1px',
  'height:1px',
  'border:0',
  'visibility:hidden',
  'pointer-events:none',
]
  .map((rule) => `${rule}!important`)
  .join(';');

/**
 * Computes defaults inside a temporary hidden same-origin about:blank iframe, where no
 * page stylesheet applies. Results are cached per tag. The iframe is removed by `dispose()`.
 */
export class IframeDefaultStyles implements DefaultStyleSource {
  problem: string | null = null;
  private frame: HTMLIFrameElement | null = null;
  private frameDoc: Document | null = null;
  private failed = false;
  private readonly cache = new Map<string, StyleRecord>();

  constructor(
    private readonly doc: Document,
    private readonly props: readonly string[],
  ) {}

  forElement(el: Element): StyleRecord {
    const key = `${el.namespaceURI ?? ''}|${el.localName}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const defaults = this.compute(() => {
      const frameDoc = this.ensureFrame();
      const probe = frameDoc.createElementNS(el.namespaceURI, el.localName);
      (frameDoc.body ?? frameDoc.documentElement).appendChild(probe);
      try {
        return this.readDefaults(frameDoc, probe);
      } finally {
        probe.remove();
      }
    });
    this.cache.set(key, defaults);
    return defaults;
  }

  forPseudo(): StyleRecord {
    const key = '::pseudo';
    const cached = this.cache.get(key);
    if (cached) return cached;
    const defaults = this.compute(() => {
      const frameDoc = this.ensureFrame();
      const probe = frameDoc.createElement('span');
      (frameDoc.body ?? frameDoc.documentElement).appendChild(probe);
      try {
        return this.readDefaults(frameDoc, probe);
      } finally {
        probe.remove();
      }
    });
    this.cache.set(key, defaults);
    return defaults;
  }

  owns(el: Element): boolean {
    return el === this.frame;
  }

  dispose(): void {
    this.frame?.remove();
    this.frameDoc = null;
  }

  private readDefaults(frameDoc: Document, probe: Element): StyleRecord {
    const view = frameDoc.defaultView;
    if (!view) throw new Error('the temporary iframe has no window');
    const style = view.getComputedStyle(probe);
    return readAllStyles((property) => style.getPropertyValue(property), this.props);
  }

  private compute(read: () => StyleRecord): StyleRecord {
    if (this.failed) return {};
    try {
      return read();
    } catch (error) {
      this.failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      this.problem = `Could not compute browser default styles (${detail}); all style values are recorded.`;
      return {};
    }
  }

  private ensureFrame(): Document {
    if (this.frameDoc) return this.frameDoc;
    const frame = this.doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = FRAME_STYLE;
    (this.doc.body ?? this.doc.documentElement).appendChild(frame);
    this.frame = frame;
    const frameDoc = frame.contentDocument;
    if (!frameDoc?.documentElement) throw new Error('the temporary iframe document is not accessible');
    this.frameDoc = frameDoc;
    return frameDoc;
  }
}
