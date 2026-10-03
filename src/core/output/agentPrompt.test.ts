import { describe, expect, it } from 'vitest';
import { buildAssetIndex } from '../assets';
import { analyzeLayout, buildTree } from '../components';
import { pageOf } from '../components/fixtures';
import { generateThemeCss, generateTokens } from '../tokens';
import { CSS_LIMITS } from '../../shared/config';
import type { MotionData, MotionTarget } from '../../shared/types';
import { parseCss } from '../css';
import { buildChecklist, CHECKLIST_RULE, generateAgentPrompt, withSiteNotes } from './agentPrompt';
import { generateDesignMd } from './designMd';

const target = (index: number, y: number, tag = 'h2', label: string | null = 'Pricing'): MotionTarget => ({ index, nodeId: null, tag, rect: { x: 0, y, width: 600, height: 100 }, label });

const motion: MotionData = {
  schemaVersion: 1,
  libraries: [{ name: 'GSAP / ScrollTrigger', evidence: ['script src https://cdn/gsap.min.js'] }, { name: 'Swiper', evidence: ['DOM marker .swiper-wrapper'] }],
  animations: [{ target: target(1, 100, 'div', null), type: 'css-animation', animationName: 'spin', transitionProperty: null, pseudoElement: null, keyframes: [{ offset: 0, transform: 'rotate(0)' }, { offset: 1, transform: 'rotate(360deg)' }], durationMs: 8000, delayMs: 0, easing: 'linear', iterations: null, direction: 'normal', fill: 'none' }],
  reveals: [{ target: target(2, 700), changes: [], durationMs: 600, delayMs: 0, easing: 'ease-out', preset: 'fade-up 40px' }],
  revealPresets: [{ description: 'fade-up 40px, 600ms, ease-out, stagger 100ms', name: 'fade-up 40px', count: 6, durationMs: 600, easing: 'ease-out', staggerMs: 100, targets: [2] }],
  scrollEffects: [{ kind: 'pinned', target: target(3, 650, 'div', null), startPx: 600, endPx: 1500, ratio: null, properties: [], description: 'pinned at 0px from the viewport top' }],
  carousels: [{ target: target(4, 200, 'div', 'Logos'), slideCount: 5, direction: 'horizontal', autoplayIntervalMs: 3000, transitionMs: 500, controls: { arrows: false, dots: true }, moves: 3 }],
  videos: [],
  warnings: [],
  stats: { durationMs: 10, truncated: false, scrollSamples: 8 },
};

function fixture() {
  const capture = pageOf({
    tag: 'html',
    rect: [0, 0, 1440, 1500],
    children: [
      {
        tag: 'body',
        rect: [0, 0, 1440, 1500],
        children: [
          { tag: 'header', rect: [0, 0, 1440, 72] },
          { tag: 'section', rect: [0, 72, 1440, 500], children: [{ tag: 'h1', rect: [100, 100, 600, 60], text: 'Hello', style: { 'font-size': '48px' } }, { tag: 'canvas', rect: [700, 100, 600, 400] }] },
          { tag: 'section', rect: [0, 572, 1440, 400], children: [{ tag: 'h2', rect: [100, 600, 600, 40], text: 'Pricing', style: { 'font-size': '32px' } }] },
          { tag: 'section', rect: [0, 972, 1440, 300], children: [{ tag: 'p', rect: [100, 1000, 600, 40], text: 'Contact us for a quote today please' }] },
          { tag: 'footer', rect: [0, 1300, 1440, 200] },
        ],
      },
    ],
  });
  const css = parseCss([], CSS_LIMITS);
  const tokens = generateTokens(capture, css);
  const layout = analyzeLayout(capture, tokens);
  const assets = buildAssetIndex(buildTree(capture), layout.sections, null, css);
  const screens = { fullPage: null, sections: layout.sections.map((s, i) => ({ name: s.name, path: `assets/screens/0${i + 1}-${s.name}.jpg` })), warnings: [] };
  return { capture, tokens, themeCss: generateThemeCss(tokens), css, layout, assets, screens, warnings: [] };
}

describe('build checklist', () => {
  it('lists every section with its screenshot, even when design.md lists fewer', () => {
    const input = fixture();
    expect(input.layout.sections.length).toBeGreaterThanOrEqual(5);
    const md = generateDesignMd({ ...input, motion, motionFrames: null });
    const checklist = md.slice(md.indexOf('## 0. Build checklist'), md.indexOf('## 1. Instructions'));
    expect(md.indexOf('## 0. Build checklist')).toBeLessThan(md.indexOf('## 1. Instructions'));
    expect(checklist).toContain(CHECKLIST_RULE);
    input.layout.sections.forEach((s, i) => expect(checklist).toContain(`${i + 1}. [ ] ${s.name} — screenshot: \`assets/screens/0${i + 1}-${s.name}.jpg\``));
    // Still complete after the generator has had to shrink everything.
    const tight = generateDesignMd({ ...input, motion, motionFrames: null, maxChars: 9_000 });
    for (const s of input.layout.sections) expect(tight).toContain(`[ ] ${s.name} —`);
  });

  it('handles a page without sections', () => {
    expect(buildChecklist([]).join('\n')).toContain('No sections were detected');
  });
});

describe('motion section', () => {
  it('maps libraries to Next.js packages and lists presets, effects, carousels and graphic areas', () => {
    const md = generateDesignMd({ ...fixture(), motion, motionFrames: { frames: [{ path: 'assets/motion/hero-01.jpg', kind: 'hero', description: 'Top of the page, frame 1 of 6' }], loader: { detected: true, visibleForMs: 1200, description: 'Loader: a full-viewport fixed <div>' }, warnings: [] } });
    expect(md).toContain('## 8. Motion & interactions');
    expect(md).toContain('npm i gsap @gsap/react');
    expect(md).toContain('swiper/react');
    expect(md).toContain('`fade-up 40px, 600ms, ease-out, stagger 100ms` — 6 elements');
    expect(md).toContain('initial={{ opacity: 0, y: 40 }}');
    expect(md).toContain('**pinned** on');
    expect(md).toContain('5 slides, horizontal, autoplay every 3000ms');
    expect(md).toContain('spin on');
    expect(md).toContain('### Loader / intro');
    expect(md).toContain('`assets/motion/hero-01.jpg`');
    expect(md).toContain('### Canvas, WebGL, Lottie and Rive areas');
    expect(md).toContain('<canvas>');
  });

  it('says so when motion was not captured', () => {
    expect(generateDesignMd({ ...fixture(), motion: null, motionFrames: null })).toContain('Motion was not captured');
  });
});

describe('generateAgentPrompt', () => {
  const sections = [{ name: 'header', screenshot: 'assets/screens/01-header.jpg' }, { name: 'hero', screenshot: 'assets/screens/02-hero.jpg' }];

  it('tells the agent to read the pack, build every section in one pass, apply motion, compare and verify', () => {
    const prompt = generateAgentPrompt({ title: 'Acme', sections, libraries: motion.libraries, hasMotion: true, hasRevealPresets: true, hasLoader: true });
    expect(prompt).toContain('./design');
    expect(prompt).toContain('Read `./design/design.md` completely');
    expect(prompt).toContain('Next.js App Router + TypeScript + Tailwind CSS v4');
    expect(prompt).toContain('1. header (screenshot: design/assets/screens/01-header.jpg)');
    expect(prompt).toContain('2. hero');
    expect(prompt).toContain('ONE pass');
    expect(prompt).toContain('`gsap`');
    expect(prompt).toContain('`motion`');
    expect(prompt).toContain('page loader');
    expect(prompt).toContain('compare it with its screenshot');
    expect(prompt).toContain('`app/page.tsx` imports and renders every checklist section');
    expect(prompt).toContain('what still differs');
  });

  it('falls back to CSS-only motion and supports site notes', () => {
    const prompt = generateAgentPrompt({ title: 'Acme', sections, libraries: [], hasMotion: false, hasRevealPresets: false, hasLoader: false });
    expect(prompt).toContain('no sampled motion');
    expect(prompt).not.toContain('## Site-specific notes');
    const withNotes = withSiteNotes(prompt, '- The hero video is a placeholder.');
    expect(withNotes).toContain('## Site-specific notes\n\n- The hero video is a placeholder.');
    expect(withSiteNotes(withNotes, '- New notes.').match(/## Site-specific notes/g)).toHaveLength(1);
    expect(withSiteNotes(withNotes, '')).not.toContain('Site-specific');
  });
});
