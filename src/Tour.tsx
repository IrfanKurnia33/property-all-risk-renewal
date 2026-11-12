import { useEffect, useRef, useState } from 'react';
import type { Stage } from './domain.ts';

const TOUR_KEY = 'ruang-renewal.tour.v1';
const steps: { title: string; text: string; stage: Stage; detail: string }[] = [
  { title: 'Satu kasus, dari quotation sampai binding', text: 'Selamat datang di Ruang Renewal. Anda akan mencoba renewal Property All Risks PT Arunika dengan data fiktif. Semua pengiriman dan tanggapan berlangsung di dalam simulasi ini.', stage: 'materials', detail: 'Mulai dari final slip tahun lalu dan Standard T&C. Tombol langkah berikutnya akan membantu Anda melanjutkan.' },
  { title: 'Ikuti tahap, bolak-balik bila perlu', text: 'Lima tahap di sisi kiri menjaga konteks pekerjaan. Anda boleh membuka tahap lain untuk melihat isinya; tindakan tetap mengikuti prasyarat renewal.', stage: 'insurer', detail: 'Asuransi meninjau quotation. Broker bisa bernegosiasi kembali sebelum mengirim proposal ke klien.' },
  { title: 'Coba peran asuransi dan klien', text: 'Gunakan pilihan peran di bagian atas untuk membalas sebagai asuransi atau klien. Peran klien baru tersedia setelah proposal pertama dikirim.', stage: 'proposal', detail: 'Broker meninjau data. Lokasi dan sum insured hanya dapat diisi serta dikonfirmasi dalam peran klien.' },
  { title: 'Bandingkan nilai beserta buktinya', text: 'Bekasi berubah, Tangerang tetap, dan pembaruan Cikarang perlu klarifikasi. Buka detail lokasi untuk memeriksa nilai lama, usulan terbaru, dan sumber konfirmasinya.', stage: 'reconciliation', detail: 'Nilai yang tetap pun perlu konfirmasi. Usulan yang belum jelas ditahan sambil nilai historis tetap terlihat.' },
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
  return <dialog ref={dialog} className="tour-dialog" aria-labelledby="tour-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="tour-top"><span className="eyebrow">TUR SINGKAT · {step + 1} / {steps.length}</span><button type="button" className="button-ghost" onClick={onClose} aria-label="Tutup tur">✕</button></div>
    <div className="tour-progress" aria-label={`Langkah ${step + 1} dari ${steps.length}`}>{steps.map((_, i) => <span key={i} className={i <= step ? 'is-current' : ''} />)}</div>
    <h2 id="tour-title" ref={heading} tabIndex={-1}>{steps[step].title}</h2>
    <p>{steps[step].text}</p><div className="tour-detail">{steps[step].detail}</div>
    <div className="tour-actions"><button type="button" className="button-ghost" onClick={onClose}>Lewati tur</button><div><button type="button" className="button-secondary" onClick={() => setStep(step - 1)} disabled={step === 0}>Kembali</button><button type="button" className="button-primary" onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)}>{step === steps.length - 1 ? 'Mulai mencoba' : 'Lanjut'}</button></div></div>
  </dialog>;
}
