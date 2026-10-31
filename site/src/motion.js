import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

// Smooth scrolling and scroll-linked motion, only when the viewer allows motion. Returns a cleanup function.
export function startMotion(root) {
  const mm = gsap.matchMedia();
  let lenis = null;
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Lenis does the smoothing (no CSS scroll-behavior), and glides to #anchors too.
    lenis = new Lenis({ lerp: 0.2, wheelMultiplier: 1.15, anchors: { offset: -72 } });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = time => lenis.raf(time * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    gsap.from(root.querySelectorAll('.hero .reveal-line > span'), { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.12 });
    gsap.from(root.querySelectorAll('.hero .eyebrow, .hero .sub'), { autoAlpha: 0, y: 16, duration: 0.9, ease: 'power3.out', delay: 0.35, stagger: 0.1 });
    gsap.from(root.querySelector('.stage .app'), { y: 90, scale: 0.94, ease: 'none', scrollTrigger: { trigger: root.querySelector('.stage'), start: 'top bottom', end: 'top 30%', scrub: true } });
    gsap.from(root.querySelectorAll('.mini .track i'), { width: 0, duration: 1.2, ease: 'power3.out', stagger: 0.15, scrollTrigger: { trigger: root.querySelector('.mini'), start: 'top 75%' } });
    return () => { gsap.ticker.remove(tick); lenis.destroy(); lenis = null; };
  });
  // The terminal pins and plays line by line on wide screens; elsewhere it's shown in full.
  mm.add('(prefers-reduced-motion: no-preference) and (min-width: 901px)', () => {
    const lines = root.querySelectorAll('.term p'), steps = root.querySelectorAll('.steps li');
    gsap.set(lines, { autoAlpha: 0, y: 6 });
    const tl = gsap.timeline({ scrollTrigger: { trigger: root.querySelector('.play'), start: 'top top+=72', end: '+=150%', pin: root.querySelector('.play .stick'), scrub: 0.3 } });
    lines.forEach((line, i) => {
      tl.to(line, { autoAlpha: 1, y: 0, duration: 1 }, i);
      const step = Number(line.dataset.step);
      if (!Number.isNaN(step)) tl.to(steps[step], { color: 'var(--ink)', duration: 1 }, i);
    });
  });
  return () => mm.revert();
}
