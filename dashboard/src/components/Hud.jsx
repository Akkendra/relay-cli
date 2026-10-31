import { useEffect, useRef, useState } from 'react';

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const pad = n => String(n).padStart(2, '0');
  return (
    <div className="clock" aria-label={now.toLocaleTimeString()}>
      <span>{pad(now.getHours())}:{pad(now.getMinutes())}<small>:{pad(now.getSeconds())}</small></span>
      <em>{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</em>
    </div>
  );
}

// Points on a sphere, joined to near neighbours, rotating faster while an agent is working.
const N = 260, pts = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = Math.PI * (3 - Math.sqrt(5)) * i;
  return [Math.cos(t) * r, y, Math.sin(t) * r];
});
const links = [];
for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]) < 0.2) links.push([i, j]);

export function Core({ live }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let angle = 0.6, frame;
    const draw = () => {
      const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#59d0ff';
      const R = Math.min(w, h) * 0.42, cos = Math.cos(angle), sin = Math.sin(angle);
      const p = pts.map(([x, y, z]) => { const rx = x * cos - z * sin, rz = x * sin + z * cos; return [w / 2 + rx * R, h / 2 + y * R, rz]; });
      ctx.strokeStyle = accent; ctx.lineWidth = 0.5;
      for (const [i, j] of links) { ctx.globalAlpha = 0.08 + 0.18 * ((p[i][2] + p[j][2]) / 4 + 0.5); ctx.beginPath(); ctx.moveTo(p[i][0], p[i][1]); ctx.lineTo(p[j][0], p[j][1]); ctx.stroke(); }
      ctx.fillStyle = accent;
      for (const [x, y, z] of p) { ctx.globalAlpha = 0.25 + 0.75 * (z / 2 + 0.5); ctx.beginPath(); ctx.arc(x, y, 0.6 + 1.2 * (z / 2 + 0.5), 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      angle += live ? 0.004 : 0.0012;
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [live]);
  return (
    <section className="card core" aria-label={live ? `Working: ${live} live session${live === 1 ? '' : 's'}` : 'Idle'}>
      <canvas ref={ref} aria-hidden="true" />
      <div className="core-label"><b>{live ? 'Working' : 'Idle'}</b><span>{live ? `${live} live session${live === 1 ? '' : 's'}` : 'no live sessions'}</span></div>
    </section>
  );
}
