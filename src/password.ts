export const MIN_PASSWORD_LENGTH = 12;

/** Vrátí text chyby, nebo null, když je heslo v pořádku (lokální pravidla). */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků.`;
  if (password.length > 128) return 'Heslo je příliš dlouhé (nejvýše 128 znaků).';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) return 'Heslo nesmí obsahovat váš e-mail.';
  if (/^(.)\1+$/.test(password)) return 'Heslo je příliš jednoduché.';
  return null;
}

/** Kontrola uniklých hesel přes HIBP (k-anonymita: ven jde jen prvních 5 znaků SHA-1). Při chybě sítě neblokuje. */
export async function isPwned(password: string): Promise<boolean> {
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hex.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' } });
    if (!res.ok) return false;
    const suffix = hex.slice(5);
    return (await res.text()).split('\n').some((l) => {
      const [h, n] = l.trim().split(':');
      return h === suffix && Number(n) > 0;
    });
  } catch {
    return false;
  }
}
