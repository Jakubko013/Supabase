import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { requestPersistentStorage } from './storage';
import './styles.css';

declare const __APP_VERSION__: string;

requestPersistentStorage();

/** Žádná offline cache aplikace: případný dříve uložený service worker a jeho cache odstraníme. */
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
  if ('caches' in window) void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
}

/**
 * Zařízení může mít uloženou starou verzi aplikace (service worker). Ta by s novou databází nemusela ukládat data,
 * proto při spuštění a návratu do aplikace porovnáme verzi se serverem a starou verzi nahradíme.
 */
async function ensureLatestVersion() {
  try {
    const res = await fetch('/app/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = (await res.json()) as { version?: string };
    if (!version || version === __APP_VERSION__ || sessionStorage.getItem('vs:reloadedFor') === version) return;
    sessionStorage.setItem('vs:reloadedFor', version); // pojistka proti nekonečnému obnovování
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    window.location.reload();
  } catch {
    // offline nebo nedostupný server – zkusíme příště
  }
}

if (import.meta.env.PROD && import.meta.env.MODE !== 'native' && !window.Capacitor?.isNativePlatform?.()) {
  void ensureLatestVersion();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void ensureLatestVersion());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
