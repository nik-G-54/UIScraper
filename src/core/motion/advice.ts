import type { MotionLibrary, RevealPreset } from '../../shared/types';

export interface LibraryAdvice {
  /** npm packages for a Next.js (App Router) build. */
  packages: string;
  note: string;
}

/** What to use in Next.js for each detected library. Keys match `MotionLibrary.name`. */
export const LIBRARY_ADVICE: Record<string, LibraryAdvice> = {
  'GSAP / ScrollTrigger': { packages: 'gsap @gsap/react', note: 'Register ScrollTrigger inside `useGSAP` in a client component; use it for pins, scrubbed timelines and staggers.' },
  'Framer Motion': { packages: 'motion', note: 'Use `motion/react` (`motion.div`, `whileInView`, `useScroll`, `useTransform`) in client components.' },
  'Motion One': { packages: 'motion', note: 'Use `animate` / `scroll` from `motion`, or `motion/react` components.' },
  Swiper: { packages: 'swiper', note: 'Use `swiper/react` (`Swiper`, `SwiperSlide`) with the Autoplay/Navigation/Pagination modules matching section 8.' },
  Splide: { packages: '@splidejs/react-splide', note: 'Or Embla (`embla-carousel-react` + `embla-carousel-autoplay`) for a lighter build.' },
  Embla: { packages: 'embla-carousel-react embla-carousel-autoplay', note: 'Wrap the viewport/container/slides in a client component.' },
  Slick: { packages: 'embla-carousel-react embla-carousel-autoplay', note: 'Slick needs jQuery; Embla (or Swiper) reproduces it without.' },
  'Keen Slider': { packages: 'keen-slider', note: 'Use `keen-slider/react` (`useKeenSlider`).' },
  Lottie: { packages: 'lottie-react', note: 'Or `@lottiefiles/dotlottie-react` for .lottie files. The animation JSON is not in the pack: use a placeholder box or a free Lottie of the same kind.' },
  Rive: { packages: '@rive-app/react-canvas', note: 'The .riv file is not in the pack: use a placeholder or a CSS/SVG stand-in.' },
  AOS: { packages: 'motion', note: 'Replace `data-aos` with `whileInView` reveals (presets below), or install `aos` and call `AOS.init` in a client component.' },
  Lenis: { packages: 'lenis', note: 'Use `ReactLenis root` in a client component at the top of the layout for smooth scrolling.' },
  'Locomotive Scroll': { packages: 'lenis', note: 'Lenis gives the same smooth scrolling with far less setup; parallax via `motion` `useScroll`.' },
  'Three.js': { packages: 'three @react-three/fiber @react-three/drei', note: 'The scene is not in the pack: recreate a simple version or use a placeholder canvas with the same size.' },
  Barba: { packages: 'motion', note: 'Page transitions: `AnimatePresence` with a template.tsx, or the View Transitions API.' },
  'anime.js': { packages: 'animejs', note: 'Call `animate` from a client component effect; or use `motion` for the same result.' },
};

const FALLBACK: LibraryAdvice = { packages: 'motion', note: 'Use `motion/react` for the animation.' };

export const adviceFor = (name: string): LibraryAdvice => LIBRARY_ADVICE[name] ?? FALLBACK;

/** Packages to install for the detected libraries (deduplicated). Always includes `motion` for reveals. */
export function suggestedPackages(libraries: readonly MotionLibrary[], hasReveals: boolean): string[] {
  const set = new Set<string>();
  for (const lib of libraries) for (const pkg of adviceFor(lib.name).packages.split(' ')) set.add(pkg);
  if (hasReveals) set.add('motion');
  return [...set];
}

/** `fade-up 40px` -> motion props; null when the preset is not a plain fade/slide. */
export function revealSnippet(preset: Pick<RevealPreset, 'name' | 'durationMs' | 'easing' | 'staggerMs'>): string | null {
  const m = /^(fade|slide)(?:-(up|down|left|right) (\d+)px)?(?: \+.*)?$/.exec(preset.name);
  if (!m) return null;
  const from: string[] = [];
  const to: string[] = [];
  if (m[1] === 'fade') {
    from.push('opacity: 0');
    to.push('opacity: 1');
  }
  if (m[2] && m[3]) {
    const axis = m[2] === 'up' || m[2] === 'down' ? 'y' : 'x';
    const sign = m[2] === 'up' || m[2] === 'left' ? '' : '-';
    from.push(`${axis}: ${sign}${m[3]}`);
    to.push(`${axis}: 0`);
  }
  if (from.length === 0) return null;
  const ease = preset.easing && /^ease/.test(preset.easing) ? `'${preset.easing === 'ease' ? 'easeInOut' : preset.easing.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}'` : null;
  const parts = [preset.durationMs ? `duration: ${preset.durationMs / 1000}` : null, ease ? `ease: ${ease}` : null].filter(Boolean).join(', ');
  const stagger = preset.staggerMs ? `; stagger children by ${preset.staggerMs / 1000}s (delay: index * ${preset.staggerMs / 1000})` : '';
  return `initial={{ ${from.join(', ')} }} whileInView={{ ${to.join(', ')} }} viewport={{ once: true }} transition={{ ${parts} }}${stagger}`;
}
