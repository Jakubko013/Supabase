import { useEffect, useState, type ReactNode } from 'react';

interface Props {
  onConfirm: () => void;
  children: ReactNode;
  confirmText?: string;
  className?: string;
  'aria-label'?: string;
}

/** Tlačítko pro nevratné akce: první klepnutí se zeptá, druhé (do 3 s) potvrdí. Bez systémového dialogu. */
export function ConfirmButton({ onConfirm, children, confirmText = 'Opravdu? Klepněte znovu', className = 'btn', ...rest }: Props) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={armed ? `${className} btn-bad` : className}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      {...rest}
    >
      {armed ? confirmText : children}
    </button>
  );
}
