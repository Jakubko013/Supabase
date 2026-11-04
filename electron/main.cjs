const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('node:path');

const ALLOWED_HOSTS = new Set(['www.cvf.cz', 'cvf.cz']);

// Stažení stránky z cvf.cz v hlavním procesu (bez CORS). Povolen je jen cvf.cz přes HTTPS.
ipcMain.handle('fetch-text', async (_event, url) => {
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('Nepovolená adresa');
  }
  // Přesměrování se nesleduje (mohlo by vést mimo cvf.cz), limit 15 s proti zaseknutí při slabém signálu.
  const res = await net.fetch(parsed.toString(), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`cvf.cz vrátil chybu ${res.status}`);
  return res.text();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Externí odkazy otevírat v prohlížeči, ne v aplikaci.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
