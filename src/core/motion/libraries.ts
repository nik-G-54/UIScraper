import type { MotionLibrary } from '../../shared/types';

/** What the page shows about its animation libraries. The isolated world cannot read page globals, so only these signals exist. */
export interface LibrarySignals {
  /** `src` of every script tag. */
  scripts: string[];
  /** `href` of every link tag (stylesheets, preloads). */
  links: string[];
  /** Entries of `LIBRARY_MARKERS` that matched something in the DOM. */
  markers: string[];
}

interface LibraryDef {
  name: string;
  /** Tested against script and link URLs (lower-cased). */
  urls: RegExp[];
  /** CSS selectors; class prefixes appear here ONLY for detection, never to infer design meaning. */
  markers: string[];
}

const SEP = '(?:^|[/@._~-])';
const END = '(?:$|[/@._~?#-])';

const LIBRARIES: LibraryDef[] = [
  { name: 'GSAP / ScrollTrigger', urls: [/gsap|tweenmax|tweenlite|scrolltrigger/], markers: ['.pin-spacer', '[data-gsap]', '.gsap-marker-start'] },
  { name: 'Framer Motion', urls: [/framer-motion|framerusercontent\.com|framer\.com\/m\//], markers: ['[data-framer-appear-id]', '[data-framer-component-type]', '[data-projection-id]'] },
  { name: 'Motion One', urls: [/motion-one|@motionone|motion\.dev|motion\.min/], markers: [] },
  { name: 'Swiper', urls: [/swiper/], markers: ['swiper-container', 'swiper-slide', '.swiper-wrapper', '.swiper-slide'] },
  { name: 'Splide', urls: [/splide/], markers: ['.splide__track', '.splide__slide'] },
  { name: 'Embla', urls: [/embla/], markers: ['.embla__container', '.embla__slide', '[data-embla]'] },
  { name: 'Slick', urls: [/slick(?:\.min)?\.(?:js|css)|slick-carousel/], markers: ['.slick-track', '.slick-slider'] },
  { name: 'Keen Slider', urls: [/keen-slider/], markers: ['.keen-slider', '.keen-slider__slide'] },
  { name: 'Lottie', urls: [/lottie|bodymovin|dotlottie/], markers: ['lottie-player', 'dotlottie-player', 'dotlottie-wc', 'lottie-animation'] },
  { name: 'Rive', urls: [new RegExp(`${SEP}rive${END}|rive-app`)], markers: ['rive-canvas'] },
  { name: 'AOS', urls: [new RegExp(`${SEP}aos${END}|\\baos(?:\\.min)?\\.(?:js|css)`)], markers: ['[data-aos]'] },
  { name: 'Lenis', urls: [/lenis/], markers: ['html.lenis', '.lenis', '[data-lenis-prevent]'] },
  { name: 'Locomotive Scroll', urls: [/locomotive-scroll|locomotivescroll/], markers: ['[data-scroll-container]', '[data-scroll-section]', '.c-scrollbar'] },
  { name: 'Three.js', urls: [new RegExp(`${SEP}three(?:\\.min|\\.module)?(?:\\.js|${END})`)], markers: ['canvas[data-engine]'] },
  { name: 'Barba', urls: [new RegExp(`${SEP}barba${END}|barba(?:\\.min)?\\.js`)], markers: ['[data-barba]', '[data-barba-namespace]'] },
  { name: 'anime.js', urls: [/animejs|anime(?:\.min)?\.js|anime\.es/], markers: [] },
];

/** All selectors the page should be asked about (see `gatherLibrarySignals`). */
export const LIBRARY_MARKERS: readonly string[] = [...new Set(LIBRARIES.flatMap((l) => l.markers))];

const clip = (value: string, max = 90): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Match signals against the known libraries. Each match records its evidence; most evidence first. */
export function detectLibraries(signals: LibrarySignals): MotionLibrary[] {
  const found: MotionLibrary[] = [];
  for (const lib of LIBRARIES) {
    const evidence: string[] = [];
    for (const [kind, urls] of [['script src', signals.scripts], ['link href', signals.links]] as const) {
      for (const url of urls) {
        if (evidence.length >= 6) break;
        if (lib.urls.some((re) => re.test(url.toLowerCase()))) evidence.push(`${kind} ${clip(url)}`);
      }
    }
    for (const marker of lib.markers) if (signals.markers.includes(marker)) evidence.push(`DOM marker ${marker}`);
    if (evidence.length > 0) found.push({ name: lib.name, evidence });
  }
  return found.sort((a, b) => b.evidence.length - a.evidence.length);
}

/** Read the signals from a document (script/link URLs and the marker selectors that match). */
export function gatherLibrarySignals(doc: Document): LibrarySignals {
  const attr = (selector: string, name: string) =>
    [...doc.querySelectorAll(selector)].map((el) => el.getAttribute(name) ?? '').filter(Boolean);
  const markers: string[] = [];
  for (const marker of LIBRARY_MARKERS) {
    try {
      if (doc.querySelector(marker)) markers.push(marker);
    } catch {
      // an unsupported selector is simply not a signal
    }
  }
  return { scripts: attr('script[src]', 'src'), links: attr('link[href]', 'href'), markers };
}
