// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { CaptureTuning } from '../../shared/types';
import { IframeDefaultStyles } from './defaults';
import { STYLE_PROPERTIES } from './styleProps';
import { fakeDefaults, makeCaptureEnv } from './testEnv';
import { captureDom } from './walker';
import type { CaptureEnv } from './walker';

const budgets = { maxNodes: 1000, maxCaptureTimeMs: 5000, maxTextLength: 40 };
const tuning: Pick<CaptureTuning, 'chunkTimeMs' | 'overlayMinZIndex' | 'overlayMinViewportCoverage'> = {
  chunkTimeMs: 1000,
  overlayMinZIndex: 100,
  overlayMinViewportCoverage: 0.25,
};

const capture = (env: CaptureEnv, b = budgets) => captureDom(env, b, tuning, fakeDefaults());

beforeEach(() => {
  document.head.innerHTML = '<title>t</title><meta charset="utf-8">';
  document.body.innerHTML = '';
});

describe('captureDom: structure', () => {
  it('records a tree with ids equal to indexes, parents, children and depth', async () => {
    document.body.innerHTML = '<main><h1>Title</h1><p>Body</p></main>';
    const out = await capture(makeCaptureEnv(document));

    expect(out.nodes.map((n) => n.tag)).toEqual(['html', 'body', 'main', 'h1', 'p']);
    out.nodes.forEach((node, index) => expect(node.id).toBe(index));
    const [html, body, main, h1, p] = out.nodes;
    expect(html?.parentId).toBeNull();
    expect(html?.childIds).toEqual([1]); // <head> is skipped
    expect(body?.parentId).toBe(0);
    expect(main?.childIds).toEqual([3, 4]);
    expect([h1?.parentId, p?.parentId]).toEqual([2, 2]);
    expect(out.nodes.map((n) => n.depth)).toEqual([0, 1, 2, 3, 3]);
  });

  it('records only an element’s own direct text, trimmed and capped', async () => {
    document.body.innerHTML = `<p>  Hello <b>bold</b>   world  </p><p>${'x'.repeat(100)}</p><div><span></span></div>`;
    const out = await capture(makeCaptureEnv(document));
    const [p1, , p2, div] = [out.nodes[2], out.nodes[3], out.nodes[4], out.nodes[5]];
    expect(p1?.text).toBe('Hello world');
    expect(out.nodes[3]?.text).toBe('bold');
    expect(p2?.text).toHaveLength(40);
    expect(p2?.text?.endsWith('…')).toBe(true);
    expect(div?.text).toBeUndefined();
  });

  it('records allow-listed attributes with absolute URLs, and never class names', async () => {
    document.body.innerHTML =
      '<a id="x" class="css-abc123" href="/pricing" data-extra="1">Pricing</a><img src="logo.png" alt="Logo">';
    const out = await capture(makeCaptureEnv(document));
    const a = out.nodes.find((n) => n.tag === 'a');
    const img = out.nodes.find((n) => n.tag === 'img');
    expect(a?.attrs).toEqual({ id: 'x', href: new URL('/pricing', document.baseURI).href });
    expect(img?.attrs?.src?.startsWith('http')).toBe(true);
    expect(img?.attrs?.alt).toBe('Logo');
    expect(JSON.stringify(out)).not.toContain('css-abc123');
  });

  it('records document coordinates (viewport rect + scroll offset)', async () => {
    document.body.innerHTML = '<p>x</p>';
    const out = await capture(
      makeCaptureEnv(document, {
        getRect: () => ({ left: 10, top: 20, width: 30.126, height: 40 }),
        getScroll: () => ({ x: 5, y: 100 }),
      }),
    );
    expect(out.nodes[2]?.rect).toEqual({ x: 15, y: 120, width: 30.13, height: 40 });
  });
});

describe('captureDom: skip and visibility rules', () => {
  it('skips script/style/noscript/template/link/meta and does not count them as nodes', async () => {
    document.body.innerHTML =
      '<script>1</script><style>a{}</style><noscript>n</noscript><template><p>t</p></template><link rel="x"><meta name="y"><p>kept</p>';
    const out = await capture(makeCaptureEnv(document));
    expect(out.nodes.map((n) => n.tag)).toEqual(['html', 'body', 'p']);
    expect(out.counts.skipped['ignored-tag']).toBeGreaterThanOrEqual(6);
  });

  it('skips display:none elements and does not descend into them', async () => {
    document.body.innerHTML = '<div style="display:none"><p>secret</p><p>more</p></div><p>shown</p>';
    const out = await capture(makeCaptureEnv(document));
    expect(out.nodes.map((n) => n.tag)).toEqual(['html', 'body', 'p']);
    expect(out.counts.skipped['display-none']).toBe(1); // children never visited
    expect(JSON.stringify(out.nodes)).not.toContain('secret');
  });

  it('marks visibility:hidden, opacity:0 and zero-size elements hidden, with no styles', async () => {
    document.body.innerHTML =
      '<p id="v" style="visibility:hidden">a</p><p id="o" style="opacity:0">b</p><p id="z">c</p><p id="ok">d</p>';
    const out = await capture(
      makeCaptureEnv(document, {
        getRect: (el) => (el.id === 'z' ? { left: 0, top: 0, width: 0, height: 0 } : { left: 0, top: 0, width: 50, height: 10 }),
      }),
    );
    const byId = (id: string) => out.nodes.find((n) => n.attrs?.id === id);
    expect(byId('v')).toMatchObject({ hidden: 'visibility-hidden', styleId: null });
    expect(byId('o')).toMatchObject({ hidden: 'opacity-0', styleId: null });
    expect(byId('z')).toMatchObject({ hidden: 'zero-size', styleId: null });
    expect(byId('ok')?.hidden).toBeUndefined();
    expect(byId('ok')?.styleId).not.toBeNull();
    expect(out.counts.hidden).toBe(3);
  });

  it('marks descendants of an opacity:0 element hidden as well', async () => {
    document.body.innerHTML = '<div style="opacity:0"><p>child</p></div>';
    const out = await capture(makeCaptureEnv(document));
    expect(out.nodes.find((n) => n.tag === 'p')).toMatchObject({ hidden: 'ancestor-opacity-0', styleId: null });
  });

  it('still records the rect of hidden elements', async () => {
    document.body.innerHTML = '<p style="visibility:hidden">a</p>';
    const out = await capture(makeCaptureEnv(document));
    expect(out.nodes[2]?.rect).toEqual({ x: 0, y: 0, width: 100, height: 20 });
  });
});

describe('captureDom: styles', () => {
  it('stores only values that differ from the defaults, and deduplicates identical styles', async () => {
    document.body.innerHTML = '<p style="color: red">a</p><p style="color: red">b</p><p style="color: blue">c</p>';
    const defaults = fakeDefaults();
    defaults.forElement = () => ({ display: 'block' });
    const out = await captureDom(makeCaptureEnv(document), budgets, tuning, defaults);

    const ps = out.nodes.filter((n) => n.tag === 'p');
    expect(ps[0]?.styleId).toBe(ps[1]?.styleId);
    expect(ps[2]?.styleId).not.toBe(ps[0]?.styleId);
    const style = out.styleTable[ps[0]?.styleId as number];
    expect(style?.color).toBe('rgb(255, 0, 0)');
    expect(style).not.toHaveProperty('display'); // equals the default
    expect(style).not.toHaveProperty('not-a-whitelisted-property');
  });

  it('captures ::before/::after only when content is not none, with their own style ids', async () => {
    document.body.innerHTML = '<p id="a">a</p><p id="b">b</p>';
    const fakePseudo = (content: string, color: string) =>
      ({ content, display: 'inline', getPropertyValue: (p: string) => (p === 'color' ? color : '') }) as unknown as CSSStyleDeclaration;
    const env = makeCaptureEnv(document, {
      getComputedStyle: (el, pseudo) => {
        if (!pseudo) return (document.defaultView as Window).getComputedStyle(el);
        if (el.id === 'a' && pseudo === '::before') return fakePseudo('"→"', 'green');
        if (el.id === 'a' && pseudo === '::after') return fakePseudo('none', 'x');
        return fakePseudo('normal', 'x');
      },
    });
    const out = await capture(env);
    const a = out.nodes.find((n) => n.attrs?.id === 'a');
    const b = out.nodes.find((n) => n.attrs?.id === 'b');
    expect(a?.pseudo?.before?.content).toBe('"→"');
    expect(a?.pseudo?.after).toBeUndefined();
    expect(out.styleTable[a?.pseudo?.before?.styleId as number]).toEqual({ color: 'green' });
    expect(b?.pseudo).toBeUndefined();
    expect(out.counts.pseudoElements).toBe(1);
  });

  it('never captures the temporary defaults iframe it creates, and removes it afterwards', async () => {
    document.body.innerHTML = '<p>a</p><iframe src="/real"></iframe>';
    const defaults = new IframeDefaultStyles(document, STYLE_PROPERTIES);
    const out = await captureDom(makeCaptureEnv(document), budgets, tuning, defaults);
    const iframeNodes = out.nodes.filter((n) => n.tag === 'iframe');
    expect(iframeNodes).toHaveLength(1); // only the page's own iframe
    expect(out.placeholders).toHaveLength(1);
    expect(out.styleTable.some((s) => s.display === 'block')).toBe(false); // real UA defaults were diffed away
    defaults.dispose();
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('does not store border colours for elements without a border', async () => {
    document.body.innerHTML = '<p style="color: red">a</p>';
    const defaults = { ...fakeDefaults(), forElement: () => ({ 'border-top-style': 'none' }) };
    const out = await captureDom(makeCaptureEnv(document), budgets, tuning, defaults);
    for (const style of out.styleTable) expect(style).not.toHaveProperty('border-top-color');
  });

  it('surfaces a warning when default styles could not be computed', async () => {
    document.body.innerHTML = '<p>a</p>';
    const defaults = { ...fakeDefaults(), problem: 'no iframe' };
    const out = await captureDom(makeCaptureEnv(document), budgets, tuning, defaults);
    expect(out.warnings).toEqual([{ code: 'default-styles-unavailable', message: 'no iframe' }]);
  });
});

describe('captureDom: special elements', () => {
  it('records svg as a single node and does not walk into it', async () => {
    document.body.innerHTML = '<svg viewBox="0 0 10 10"><g><path d="M0 0"/><circle r="1"/></g></svg>';
    const out = await capture(makeCaptureEnv(document));
    const svg = out.nodes.find((n) => n.tag === 'svg');
    expect(svg?.svg).toBe(true);
    expect(svg?.childIds).toEqual([]);
    expect(out.nodes.map((n) => n.tag)).toEqual(['html', 'body', 'svg']);
  });

  it('records iframe/canvas/video/embed as placeholders without traversing them', async () => {
    document.body.innerHTML =
      '<iframe src="https://other.test/embed"></iframe><iframe src="/local"></iframe><canvas></canvas><video src="v.mp4"><source src="x.webm"></video><embed src="e.swf">';
    const out = await capture(makeCaptureEnv(document));

    expect(out.placeholders.map((p) => p.tag)).toEqual(['iframe', 'iframe', 'canvas', 'video', 'embed']);
    expect(out.placeholders[0]).toMatchObject({ src: 'https://other.test/embed', sameOrigin: false });
    expect(out.placeholders[1]?.sameOrigin).toBe(true);
    expect(out.placeholders[2]).toMatchObject({ src: null, sameOrigin: null });
    expect(out.placeholders[3]?.src?.endsWith('/v.mp4')).toBe(true);
    expect(out.nodes.filter((n) => n.placeholder)).toHaveLength(5);
    expect(out.nodes.some((n) => n.tag === 'source')).toBe(false);
    for (const placeholder of out.placeholders) {
      expect(out.nodes[placeholder.nodeId]?.tag).toBe(placeholder.tag);
      expect(placeholder.rect).toEqual(out.nodes[placeholder.nodeId]?.rect);
    }
  });

  it('walks open shadow roots, flagging hosts and shadow-tree nodes', async () => {
    document.body.innerHTML = '<my-card></my-card>';
    const host = document.querySelector('my-card') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>inside</p>';
    const out = await capture(makeCaptureEnv(document));

    const hostNode = out.nodes.find((n) => n.tag === 'my-card');
    const inner = out.nodes.find((n) => n.tag === 'p');
    expect(hostNode?.shadowHost).toBe(true);
    expect(inner?.inShadow).toBe(true);
    expect(inner?.parentId).toBe(hostNode?.id);
    expect(out.nodes.find((n) => n.tag === 'body')?.inShadow).toBe(false);
    expect(out.counts.shadowRoots).toBe(1);
  });

  it('places slotted light-DOM children under their <slot> (flat tree)', async () => {
    document.body.innerHTML = '<my-box><span>slotted</span></my-box>';
    const host = document.querySelector('my-box') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = '<div><slot></slot></div>';
    const out = await capture(makeCaptureEnv(document));

    const slot = out.nodes.find((n) => n.tag === 'slot');
    const span = out.nodes.find((n) => n.tag === 'span');
    expect(span?.parentId).toBe(slot?.id);
    expect(span?.inShadow).toBe(false);
  });

  it('records closed shadow hosts as opaque', async () => {
    document.body.innerHTML = '<div id="closed"><p>light child</p></div>';
    const out = await capture(
      makeCaptureEnv(document, { getShadow: (el) => (el.id === 'closed' ? { kind: 'closed' } : null) }),
    );
    const host = out.nodes.find((n) => n.attrs?.id === 'closed');
    expect(host?.closedShadowHost).toBe(true);
    expect(host?.childIds).toEqual([]);
    expect(out.nodes.some((n) => n.tag === 'p')).toBe(false);
    expect(out.counts.closedShadowHosts).toBe(1);
  });

  it('flags possible overlays from geometry and computed style, without removing them', async () => {
    document.body.innerHTML =
      '<div id="modal" style="position:fixed;z-index:1000">m</div><div id="header" style="position:fixed;z-index:1000">h</div><p id="plain">p</p>';
    const env = makeCaptureEnv(document, {
      getRect: (el) =>
        el.id === 'modal'
          ? { left: 0, top: 0, width: 1000, height: 800 }
          : el.id === 'header'
            ? { left: 0, top: 0, width: 1000, height: 60 }
            : { left: 0, top: 0, width: 50, height: 10 },
    });
    const out = await capture(env);
    const flagged = out.nodes.filter((n) => n.possibleOverlay).map((n) => n.attrs?.id);
    expect(flagged).toEqual(['modal']);
    expect(out.counts.overlays).toBe(1);
    expect(document.getElementById('modal')).not.toBeNull();
  });
});

describe('captureDom: budgets', () => {
  const manyParagraphs = (n: number) => {
    document.body.innerHTML = Array.from({ length: n }, (_, i) => `<p>${i}</p>`).join('');
  };

  it('stops at maxNodes, reports it, and counts what was left behind', async () => {
    manyParagraphs(50);
    const out = await capture(makeCaptureEnv(document), { ...budgets, maxNodes: 10 });
    expect(out.nodes).toHaveLength(10);
    expect(out.truncated).toBe('maxNodes');
    expect(out.counts.skipped['budget-truncated']).toBeGreaterThan(0);
  });

  it('is not truncated when everything fits exactly', async () => {
    manyParagraphs(3); // html, body, 3 p = 5 nodes
    const out = await capture(makeCaptureEnv(document), { ...budgets, maxNodes: 5 });
    expect(out.nodes).toHaveLength(5);
    expect(out.truncated).toBeNull();
  });

  it('stops at the capture time budget', async () => {
    manyParagraphs(50);
    let clock = 0;
    const env = makeCaptureEnv(document, { now: () => (clock += 10) });
    const out = await capture(env, { ...budgets, maxCaptureTimeMs: 100 });
    expect(out.truncated).toBe('maxCaptureTimeMs');
    expect(out.nodes.length).toBeGreaterThan(0);
    expect(out.nodes.length).toBeLessThan(52);
  });

  it('keeps the parent/child links of a truncated tree consistent', async () => {
    manyParagraphs(20);
    const out = await capture(makeCaptureEnv(document), { ...budgets, maxNodes: 7 });
    for (const node of out.nodes) {
      for (const child of node.childIds) expect(out.nodes[child]?.parentId).toBe(node.id);
    }
  });

  it('yields to the event loop in chunks', async () => {
    manyParagraphs(30);
    let yields = 0;
    let clock = 0;
    const env = makeCaptureEnv(document, {
      now: () => (clock += 1),
      yieldNow: async () => {
        yields++;
      },
    });
    await captureDom(env, budgets, { ...tuning, chunkTimeMs: 5 }, fakeDefaults());
    expect(yields).toBeGreaterThan(3);
  });

  it('can be aborted mid-walk', async () => {
    manyParagraphs(30);
    const controller = new AbortController();
    const env = makeCaptureEnv(document, {
      signal: controller.signal,
      getRect: () => {
        controller.abort();
        return { left: 0, top: 0, width: 1, height: 1 };
      },
    });
    await expect(capture(env)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not modify the page', async () => {
    document.body.innerHTML = '<div><p>a</p><svg><g/></svg></div>';
    const before = document.documentElement.outerHTML;
    await capture(makeCaptureEnv(document));
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
