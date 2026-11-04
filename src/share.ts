const isNative = () => !!window.Capacitor?.isNativePlatform?.();

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Umí zařízení sdílet soubory systémovým dialogem (iPad/iPhone, Android, Windows prohlížeč, Android aplikace)? */
export function canShareFiles(): boolean {
  if (isNative()) return true;
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'statistika.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** Uživatel sdílení zavřel – nejde o chybu. */
export const isShareCancel = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /cancel/i.test(e.message));

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export async function shareFile(blob: Blob, fileName: string, title: string): Promise<void> {
  if (isNative()) {
    // Android: WebView neumí Web Share – soubor se uloží do cache a sdílí nativně.
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const { uri } = await Filesystem.writeFile({ path: fileName, data: await toBase64(blob), directory: Directory.Cache });
    await Share.share({ title, files: [uri] });
    return;
  }
  await navigator.share({ title, files: [new File([blob], fileName, { type: blob.type })] });
}
