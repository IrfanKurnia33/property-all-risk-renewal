import { useEffect, useId, useRef, useState } from 'react';
import { t } from './i18n.ts';

export function BrandLockup({ className = '' }: { className?: string }) {
  return <span className={'brand-lockup ' + className}>
    <img className="brand-lockup-mark" src="/assets/logos/logomark-gradient.svg" width="160" height="160" alt="" />
    <img className="brand-lockup-type" src="/assets/logos/logotype-light-mode.svg" width="435" height="85" alt="Rekonvia" />
  </span>;
}

export function AccountMenu({ email, role, onBack, onReplayTour, onLogout }: {
  email: string; role?: 'broker' | 'client'; onBack?: () => void; onReplayTour?: () => void; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const roleLabel = role === 'broker' ? 'Broker' : role === 'client' ? t('Klien') : t('Akun');
  const initial = (email.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="account-menu" ref={root} data-testid="account-menu" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button className="account-menu-trigger" type="button" ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} data-testid="account-menu-trigger">
      <span className="account-avatar" aria-hidden="true">{initial}<span /></span>
      <span className="account-identity"><strong title={email}>{email}</strong><span>{roleLabel}</span></span>
      <svg className="account-chevron" width="20" height="24" viewBox="0 0 20 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 4-4 4 4M6 15l4 4 4-4" /></svg>
    </button>
    <div className="account-menu-actions" id={id} role="group" aria-label={t('Akun')} hidden={!open} data-testid="account-menu-actions">
      {onBack && <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); onBack(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1M12 5v15" /></svg>{t('Daftar kasus')}</button>}
      {onReplayTour && <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); onReplayTour(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01"/></svg>{t('Ulangi tur')}</button>}
      <button type="button" onClick={() => { setOpen(false); onLogout(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-13 5 5-5 5M9 12h11" /></svg>{t('Keluar')}</button>
    </div>
  </div>;
}
