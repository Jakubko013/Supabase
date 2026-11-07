import { useEffect, useRef } from 'react';

/** Veřejný klíč Cloudflare Turnstile (není tajný). Bez něj se ochrana proti robotům nezobrazí. */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile se nepodařilo načíst.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Neviditelná ochrana proti robotům (Cloudflare Turnstile). Token je jednorázový:
 * po každém pokusu zvyšte `resetKey`, widget vydá nový.
 */
export function Turnstile({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let alive = true;
    loadScript()
      .then(() => {
        if (!alive || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: 'cs',
          appearance: 'interaction-only',
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(null),
          'error-callback': () => tokenCb.current(null),
        });
      })
      .catch(() => tokenCb.current(null));
    return () => {
      alive = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey && widget.current) {
      tokenCb.current(null);
      window.turnstile?.reset(widget.current);
    }
  }, [resetKey]);

  return TURNSTILE_SITE_KEY ? <div ref={box} className="turnstile" /> : null;
}
