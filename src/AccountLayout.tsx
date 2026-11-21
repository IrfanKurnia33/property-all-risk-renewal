import type { ReactNode } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { AccountMenu, BrandLockup } from './WorkspaceChrome.tsx';
import { t } from './i18n.ts';
import { Tour, useTour } from './Tour.tsx';

/** Shared account chrome for the case list and the client's limited workspace. */
export function AccountLayout({ email, role, title, onBack, onWorkspaceSettings, onLogout, children }: {
  email: string; role?: 'broker' | 'client'; title: string; onBack?: () => void;
  onWorkspaceSettings?: () => void; onLogout: () => void; children: ReactNode;
}) {
  const { tourOpen, openTour, closeTour } = useTour(role === 'client' ? 'client' : 'broker');
  const footer = <div className="sidebar-footer mt-auto border-t border-border-subtle pt-5 text-xs leading-relaxed text-text-secondary">{t('Property All Risks · pilot fiktif')}</div>;
  return <div className="account-shell min-h-screen bg-canvas text-text-primary">
    <a className="skip-link" href="#account-main">{t('Langsung ke workspace')}</a>
    <aside className="sidebar account-sidebar">
      <BrandLockup />
      <div className="mt-9"><p className="eyebrow">{t('Workspace renewal Property All Risks')}</p><div className="account-navigation-current" aria-current="page">{t(title)}</div></div>
      {footer}
      <AccountMenu email={email} role={role} onBack={onBack} onWorkspaceSettings={onWorkspaceSettings} onReplayTour={openTour} onLogout={onLogout} />
    </aside>
    <div className="min-w-0">
      <header className="topbar flex min-h-19 items-center justify-between gap-4 border-b border-border-subtle bg-surface px-6 min-[1101px]:px-9 max-[560px]:px-4">
        <div className="header-breadcrumb text-sm text-text-secondary">{t(title)}</div><BrandLockup className="mobile-brand" /><LanguageSwitcher />
      </header>
      <details className="mobile-stage-nav border-b border-border-subtle bg-surface px-4 min-[801px]:hidden">
        <summary className="min-h-12 cursor-pointer py-3 text-sm font-medium">{t('Menu akun')}</summary>
        <div className="mobile-account-content pb-5">{footer}<AccountMenu email={email} role={role} onBack={onBack} onWorkspaceSettings={onWorkspaceSettings} onReplayTour={openTour} onLogout={onLogout} /></div>
      </details>
      {children}
    </div>
    <Tour open={tourOpen} onClose={closeTour} role={role === 'client' ? 'client' : 'broker'} />
  </div>;
}
