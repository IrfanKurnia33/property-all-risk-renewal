import { useEffect, useRef, useState } from 'react';
import type { Stage } from './domain.ts';

const TOUR_KEY = 'ruang-renewal.tour.v1';
const steps: { title: string; text: string; stage: Stage; detail: string }[] = [
  { title: 'Satu kasus, dari quotation sampai binding', text: 'Selamat datang di Rekonvia. Anda akan mencoba renewal Property All Risks PT Arunika dengan data fiktif. Semua pengiriman dan tanggapan berlangsung di dalam simulasi ini.', stage: 'materials', detail: 'Mulai dari final slip tahun lalu dan Standard T&C. Tombol langkah berikutnya akan membantu Anda melanjutkan.' },
  { title: 'Ikuti tahap, bolak-balik bila perlu', text: 'Lima tahap di sisi kiri menjaga konteks pekerjaan. Anda boleh membuka tahap lain untuk melihat isinya; tindakan tetap mengikuti prasyarat renewal.', stage: 'insurer', detail: 'Asuransi meninjau quotation. Broker bisa bernegosiasi kembali sebelum mengirim proposal ke klien.' },
  { title: 'Broker mencatat, klien mengonfirmasi', text: 'Broker mencatat balasan insurer dari komunikasi eksternal. Setelah proposal dipublikasikan, gunakan peran klien untuk mengirim data dan keputusan.', stage: 'proposal', detail: 'Insurer tidak memiliki peran portal. Lokasi dan sum insured periode berjalan memerlukan konfirmasi klien.' },
  { title: 'Bandingkan nilai beserta buktinya', text: 'Buka setiap lokasi untuk memeriksa nilai historis, usulan periode berjalan, dan sumber konfirmasinya. Perubahan dan data yang tetap perlu ditinjau.', stage: 'reconciliation', detail: 'Broker mencocokkan bukti tanpa memberikan approval formal. Data yang belum jelas tetap terlihat untuk follow-up.' },
  { title: 'Selesaikan penghambat sebelum mengunduh', text: 'Final review menjelaskan setiap rincian yang belum selesai. Perubahan data klien membuka kembali review asuransi. Persetujuan klien atas proposal terbaru diperlukan sebelum permintaan binding.', stage: 'final', detail: 'Progres tersimpan di browser ini. Unduh ringkasan untuk membagikan hasil uji, atau buka “Ulangi tur” kapan saja.' },
];

export function useTour() {
  const [tourOpen, setTourOpen] = useState(() => {
    try { return localStorage.getItem(TOUR_KEY) !== 'seen'; } catch { return true; }
  });
  function closeTour() {
    try { localStorage.setItem(TOUR_KEY, 'seen'); } catch { /* The tour can still close without persistent storage. */ }
    setTourOpen(false);
  }
  return { tourOpen, openTour: () => setTourOpen(true), closeTour };
}

export function Tour({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate?: (stage: Stage) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (open) {
      setStep(0);
      dialog.current?.showModal();
      heading.current?.focus();
    } else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (open) {
      onNavigate?.(steps[step].stage);
      heading.current?.focus();
    }
    // Navigation is only an orientation aid; it never changes case data.
  }, [step, open]);
  return <dialog ref={dialog} className="tour-dialog rounded-xl border border-border-subtle bg-surface px-4 py-5 text-text-primary sm:p-7" aria-labelledby="tour-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="tour-top"><span className="eyebrow text-[13px] text-text-secondary">Tur singkat · {step + 1} / {steps.length}</span><button type="button" className="button-ghost inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={onClose} aria-label="Tutup tur">✕</button></div>
    <div className="tour-progress" aria-label={`Langkah ${step + 1} dari ${steps.length}`}>{steps.map((_, i) => <span key={i} className={i <= step ? 'is-current bg-action-primary' : 'bg-border-subtle'} />)}</div>
    <h2 id="tour-title" className="font-heading text-2xl font-semibold leading-snug" ref={heading} tabIndex={-1}>{steps[step].title}</h2>
    <p className="text-sm leading-relaxed text-text-secondary">{steps[step].text}</p><div className="tour-detail rounded-lg border border-border-subtle bg-surface-selected p-4 text-[13px] leading-relaxed text-text-secondary">{steps[step].detail}</div>
    <div className="tour-actions"><button type="button" className="button-ghost min-h-11 rounded-md px-3.5 py-2.5 text-sm leading-snug font-medium text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={onClose}>Lewati tur</button><div><button type="button" className="button-secondary min-h-11 rounded-md border border-border-control bg-surface px-3.5 py-2.5 text-sm leading-snug font-medium text-text-primary transition-colors enabled:hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" onClick={() => setStep(step - 1)} disabled={step === 0}>Kembali</button><button type="button" className="button-primary min-h-11 rounded-md border border-action-primary bg-action-primary px-3.5 py-2.5 text-sm leading-snug font-medium text-action-primary-text transition-colors hover:border-action-primary-hover hover:bg-action-primary-hover active:bg-action-primary-active focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)}>{step === steps.length - 1 ? 'Mulai mencoba' : 'Lanjut'}</button></div></div>
  </dialog>;
}
