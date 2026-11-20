import { useRef } from 'react';
import type { ReactNode } from 'react';
import { t } from './i18n.ts';

export interface RenewalSection { id: string; label: string; verbatim?: boolean }

export function RenewalSectionTabs({ scope, sections, selected, onSelect, label = 'Bagian tahap renewal' }: {
  scope: string; sections: RenewalSection[]; selected: string; onSelect: (id: string) => void; label?: string;
}) {
  const tabs = useRef<HTMLDivElement>(null);
  return <div className="section-tabs" role="tablist" aria-label={t(label)} ref={tabs}>
    {sections.map((section, index) => <button key={section.id} type="button" role="tab"
      className="section-tab" id={`${scope}-tab-${section.id}`} aria-controls={`${scope}-panel-${section.id}`}
      aria-selected={selected === section.id} tabIndex={selected === section.id ? 0 : -1}
      data-testid={'section-tab-' + section.id} onClick={() => onSelect(section.id)}
      onKeyDown={event => {
        const target = event.key === 'ArrowRight' ? (index + 1) % sections.length
          : event.key === 'ArrowLeft' ? (index - 1 + sections.length) % sections.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1;
        if (target < 0) return;
        event.preventDefault();
        onSelect(sections[target].id);
        tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
      }}>{section.verbatim ? section.label : t(section.label)}</button>)}
  </div>;
}

export function RenewalSectionPanel({ scope, id, selected, children }: {
  scope: string; id: string; selected: string; children: ReactNode;
}) {
  return <div className="section-panel" id={`${scope}-panel-${id}`} role="tabpanel"
    aria-labelledby={`${scope}-tab-${id}`} hidden={id !== selected} tabIndex={0}>
    {children}
  </div>;
}
