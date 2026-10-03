import type { FrameworkHint } from '../../shared/types';

/** Custom-property prefixes that identify a framework or design system. */
const PREFIXES: { name: string; prefix: string }[] = [
  { name: 'Chakra UI', prefix: '--chakra-' },
  { name: 'Mantine', prefix: '--mantine-' },
  { name: 'Ant Design', prefix: '--ant-' },
  { name: 'MUI', prefix: '--mui-' },
  { name: 'Material Design 3', prefix: '--md-sys-' },
  { name: 'Bulma', prefix: '--bulma-' },
  { name: 'Radix', prefix: '--radix-' },
  { name: 'Ionic', prefix: '--ion-' },
  { name: 'Pico CSS', prefix: '--pico-' },
  { name: 'Docusaurus (Infima)', prefix: '--ifm-' },
  { name: 'VitePress', prefix: '--vp-' },
  { name: 'Carbon', prefix: '--cds-' },
  { name: 'Spectrum', prefix: '--spectrum-' },
];

const SHADCN_NAMES = [
  '--background',
  '--foreground',
  '--primary',
  '--secondary',
  '--muted',
  '--accent',
  '--border',
  '--ring',
  '--radius',
  '--card',
];

/**
 * Obvious framework markers: banner comments and custom-property names. `names` maps every
 * custom property declared anywhere to its declaration count; `banners` are the first characters
 * of each stylesheet. Class names are never used.
 */
export function detectFrameworks(names: ReadonlyMap<string, number>, banners: readonly string[]): FrameworkHint[] {
  const hints: FrameworkHint[] = [];
  const all = [...names.keys()];
  const withPrefix = (prefix: string) => all.filter((n) => n.startsWith(prefix));
  const banner = (re: RegExp) => {
    for (const text of banners) {
      const match = re.exec(text);
      if (match) return match[1];
    }
    return undefined;
  };

  const tw = withPrefix('--tw-');
  const twVersion =
    banner(/tailwindcss v?(\d+\.\d+\.\d+)/i) ?? (names.has('--default-font-family') && tw.length > 0 ? '4' : undefined);
  if (tw.length > 0 || twVersion) {
    hints.push({
      name: 'Tailwind CSS',
      ...(twVersion ? { version: twVersion } : {}),
      evidence: tw.length > 0 ? `${tw.length} --tw-* custom properties` : 'banner comment',
    });
  }

  const bs = withPrefix('--bs-');
  const bsVersion = banner(/Bootstrap v?(\d+\.\d+\.\d+)/i);
  if (bs.length >= 3 || bsVersion) {
    hints.push({
      name: 'Bootstrap',
      ...(bsVersion ? { version: bsVersion } : {}),
      evidence: bs.length >= 3 ? `${bs.length} --bs-* custom properties` : 'banner comment',
    });
  }

  for (const { name, prefix } of PREFIXES) {
    const matches = withPrefix(prefix);
    if (matches.length >= 2) hints.push({ name, evidence: `${matches.length} ${prefix}* custom properties` });
  }

  const shadcn = SHADCN_NAMES.filter((n) => names.has(n));
  if (shadcn.length >= 5) hints.push({ name: 'shadcn/ui-style variables', evidence: shadcn.join(', ') });

  return hints;
}
