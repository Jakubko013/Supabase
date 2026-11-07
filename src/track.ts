declare global {
  interface Window {
    vsTrack?: (event: string, params?: Record<string, unknown>) => void;
  }
}

/** Konverze pro Google Ads (public/consent.js). Bez souhlasu s cookies se nic neodešle. */
export function track(event: 'sign_up' | 'purchase', params?: Record<string, unknown>) {
  try {
    window.vsTrack?.(event, params);
  } catch {
    /* měření nesmí rozbít aplikaci */
  }
}
