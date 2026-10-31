import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Per-viewer UI preferences; storage can be unavailable (private mode), so every access is guarded.
export function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem('relay-dash:' + key) ?? initial; } catch { return initial; }
  });
  const set = useCallback(next => {
    setValue(next);
    try { localStorage.setItem('relay-dash:' + key, next); } catch {}
  }, [key]);
  return [value, set];
}

export function useSummary(project = '', intervalMs = 5000) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let alive = true, busy = false, timer;
    // Chained timeouts never overlap a slow request, and hidden tabs skip polling until they are shown again.
    const tick = async () => {
      if (document.hidden) { timer = setTimeout(tick, intervalMs); return; }
      busy = true;
      try {
        const r = await fetch(project ? `/api/summary?project=${encodeURIComponent(project)}` : '/api/summary', { cache: 'no-store' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
        const data = await r.json();
        if (alive) setState({ data, error: null, at: Date.now() });
      } catch (e) {
        if (alive) setState(s => ({ data: s.data, error: e.message }));
      }
      busy = false;
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    const onVisible = () => { if (!document.hidden && !busy) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [project, intervalMs]);
  return state;
}

export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
