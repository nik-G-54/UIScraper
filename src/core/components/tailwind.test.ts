import { describe, expect, it } from 'vitest';
import { DEFAULT_TAILWIND_CONTEXT, declarationsToTailwind, styleToTailwind } from './tailwind';

const ctx = DEFAULT_TAILWIND_CONTEXT;
const tw = (style: Record<string, string>, c = ctx) => styleToTailwind(style, c);

describe('styleToTailwind', () => {
  it('maps spacing to the scale and falls back to arbitrary values', () => {
    expect(tw({ 'padding-top': '16px', 'padding-right': '16px', 'padding-bottom': '16px', 'padding-left': '16px' })).toEqual(['p-4']);
    expect(tw({ 'padding-top': '8px', 'padding-right': '16px', 'padding-bottom': '8px', 'padding-left': '16px' })).toEqual(['px-4', 'py-2']);
    expect(tw({ 'padding-top': '13px', 'padding-right': '13px', 'padding-bottom': '13px', 'padding-left': '13px' })).toEqual(['p-[13px]']);
    expect(tw({ 'margin-top': '-8px' })).toEqual(['-mt-2']);
    expect(tw({ 'margin-left': 'auto', 'margin-right': 'auto' })).toEqual(['mx-auto']);
  });

  it('follows the page spacing unit', () => {
    const eight = { ...ctx, spacingUnitPx: 8 };
    expect(tw({ 'padding-top': '16px' }, eight)).toEqual(['pt-2']);
    expect(tw({ 'padding-top': '12px' }, eight)).toEqual(['pt-1.5']);
  });

  it('maps type, colour, layout, border and effects', () => {
    expect(tw({ 'font-size': '14px', 'font-weight': '600', 'line-height': '21px' })).toEqual(['text-sm', 'font-semibold', 'leading-normal']);
    expect(tw({ 'font-size': '15px' })).toEqual(['text-[15px]']);
    expect(tw({ color: 'rgb(255, 0, 0)' })).toEqual(['text-[#ff0000]']);
    expect(tw({ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'column-gap': '24px', 'row-gap': '24px' })).toEqual([
      'flex', 'justify-between', 'items-center', 'gap-6',
    ]);
    expect(tw({ display: 'grid', 'grid-template-columns': '300px 300px 300px' })).toContain('grid-cols-3');
    expect(tw({ 'border-top-left-radius': '8px', 'border-top-right-radius': '8px', 'border-bottom-right-radius': '8px', 'border-bottom-left-radius': '8px' })).toEqual(['rounded-lg']);
    expect(tw({ 'border-top-left-radius': '10px', 'border-top-right-radius': '10px', 'border-bottom-right-radius': '10px', 'border-bottom-left-radius': '10px' })).toEqual(['rounded-[10px]']);
    expect(tw({ opacity: '0.5', cursor: 'pointer' })).toEqual(['opacity-50', 'cursor-pointer']);
    expect(tw({ 'box-shadow': 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px' })).toEqual(['shadow-[rgba(0,_0,_0,_0.1)_0px_1px_3px_0px]']);
  });

  it('uses theme colour names when the context has them', () => {
    const named = { ...ctx, colors: [{ hex: '#ff0000', name: 'primary' }] };
    expect(tw({ 'background-color': 'rgb(255, 1, 0)', color: 'rgb(255, 0, 0)' }, named)).toEqual(['text-primary', 'bg-primary']);
  });
});

describe('declarationsToTailwind', () => {
  it('prefixes state declarations, including shorthands and transforms', () => {
    expect(declarationsToTailwind({ background: '#000', transform: 'translateY(-2px)' }, 'hover:')).toEqual([
      'hover:bg-[#000000]',
      'hover:-translate-y-0.5',
    ]);
    expect(declarationsToTailwind({ color: 'var(--accent)', 'text-decoration': 'underline' }, 'focus:')).toEqual([
      'focus:underline',
      'focus:text-[var(--accent)]',
    ]);
  });
});
