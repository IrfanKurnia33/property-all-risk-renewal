import { t } from './i18n.ts';
import { useEffect, useRef, useState } from 'react';
import type { Stage } from './domain.ts';

const TOUR_KEY = 'ruang-renewal.tour.v1';
export type TourRole = 'broker' | 'client' | 'simulation';

const brokerSteps: { title: string; text: string; stage: Stage; detail: string }[] = [
  { title: 'Mulai dari bahan renewal', text: 'Siapkan slip periode lalu dan referensi Standard T&C. Unggah dokumen sumber agar setiap tindak lanjut memiliki versi dan bukti yang jelas.', stage: 'materials', detail: 'Tahap ini belum memerlukan persetujuan klien. Broker meninjau, membandingkan, dan menyiapkan QS.' },
  { title: 'Koordinasikan dengan insurer', text: 'Catat balasan, revisi, dan bukti dari komunikasi insurer eksternal. Rekonvia menjaga proposal dan insurer tetap berada pada versi yang sama.', stage: 'insurer', detail: 'Insurer tidak masuk sebagai pengguna portal. Hanya broker yang mencatat respons dan klausa hasil negosiasi.' },
  { title: 'Publikasikan proposal untuk klien', text: 'Setelah panel mendukung opsi yang dipilih, publikasikan proposal. Klien dapat meninjau proposal dan memberi catatan pada workspace-nya.', stage: 'proposal', detail: 'Proposal yang diterbitkan mengambil snapshot data dan wording pada saat tersebut.' },
  { title: 'Ikuti konfirmasi data klien', text: 'Lokasi lama dan sum insured bersifat historis sampai klien mengonfirmasi periode berjalan beserta sumbernya.', stage: 'reconciliation', detail: 'Broker mencocokkan bukti. Tidak ada lokasi atau nilai baru yang boleh ditetapkan broker atas nama klien.' },
  { title: 'Selesaikan final review dan binding', text: 'Gunakan ringkasan perubahan, selesaikan penghambat yang terlihat, unduh DFS, lalu catat acknowledgment dari insurer secara eksternal.', stage: 'final', detail: 'Klien menyetujui renewal dan memberi instruksi. Broker tidak memberikan approval formal atas nama klien.' },
];
const clientSteps: { title: string; text: string; stage: Stage; detail: string }[] = [
  { title: 'Mulai dari proposal Anda', text: 'Buka proposal renewal yang telah dipublikasikan broker. Proposal ini hanya memuat versi yang boleh ditinjau di akun Anda.', stage: 'proposal', detail: 'Proposal lama tetap tersimpan jika broker memperbarui terms atau data renewal.' },
  { title: 'Periksa lokasi dan sum insured', text: 'Bandingkan lokasi periode lalu dengan data periode berjalan, lalu konfirmasi nama, alamat, nilai, dan sumber yang benar.', stage: 'reconciliation', detail: 'Konfirmasi data merupakan tanggung jawab klien. Broker mencocokkan bukti, bukan menetapkan nilai atas nama klien.' },
  { title: 'Berikan catatan kepada broker', text: 'Gunakan bagian tanggapan untuk menjelaskan koreksi, pertanyaan mengenai premi, atau instruksi tambahan.', stage: 'proposal', detail: 'Catatan klien kembali menjadi item review broker; catatan tidak langsung mengubah proposal.' },
  { title: 'Setujui proposal dan beri instruksi', text: 'Setelah data lokasi tersimpan, setujui versi proposal terbaru dan beri instruksi renewal secara terpisah.', stage: 'final', detail: 'Persetujuan dan instruksi selalu merujuk proposal beserta revisinya.' },
];
const simulationSteps: { title: string; text: string; stage: Stage; detail: string }[] = [
  { title: 'Satu kasus, dari quotation sampai binding', text: 'Selamat datang di Rekonvia. Anda akan mencoba renewal Property All Risks PT Arunika dengan data fiktif. Semua pengiriman dan tanggapan berlangsung di dalam simulasi ini.', stage: 'materials', detail: 'Mulai dari final slip tahun lalu dan Standard T&C. Tombol langkah berikutnya akan membantu Anda melanjutkan.' },
  { title: 'Ikuti tahap, bolak-balik bila perlu', text: 'Lima tahap di sisi kiri menjaga konteks pekerjaan. Anda boleh membuka tahap lain untuk melihat isinya; tindakan tetap mengikuti prasyarat renewal.', stage: 'insurer', detail: 'Asuransi meninjau quotation. Broker bisa bernegosiasi kembali sebelum mengirim proposal ke klien.' },
  { title: 'Broker mencatat, klien mengonfirmasi', text: 'Broker mencatat balasan insurer dari komunikasi eksternal. Setelah proposal dipublikasikan, gunakan peran klien untuk mengirim data dan keputusan.', stage: 'proposal', detail: 'Insurer tidak memiliki peran portal. Lokasi dan sum insured periode berjalan memerlukan konfirmasi klien.' },
  { title: 'Bandingkan nilai beserta buktinya', text: 'Buka setiap lokasi untuk memeriksa nilai historis, usulan periode berjalan, dan sumber konfirmasinya. Perubahan dan data yang tetap perlu ditinjau.', stage: 'reconciliation', detail: 'Broker mencocokkan bukti tanpa memberikan approval formal. Data yang belum jelas tetap terlihat untuk follow-up.' },
  { title: 'Selesaikan penghambat sebelum mengunduh', text: 'Final review menjelaskan setiap rincian yang belum selesai. Perubahan data klien membuka kembali review asuransi. Persetujuan klien atas proposal terbaru diperlukan sebelum permintaan binding.', stage: 'final', detail: 'Progres tersimpan di browser ini. Unduh ringkasan untuk membagikan hasil uji, atau buka “Ulangi tur” kapan saja.' },
];

export function useTour(role: TourRole = 'simulation') {
  const key = role === 'simulation' ? TOUR_KEY : `${TOUR_KEY}.${role}`;
  const [tourOpen, setTourOpen] = useState(() => {
    try { return localStorage.getItem(key) !== 'seen'; } catch { return true; }
  });
  function closeTour() {
    try { localStorage.setItem(key, 'seen'); } catch { /* The tour can still close without persistent storage. */ }
    setTourOpen(false);
  }
  return { tourOpen, openTour: () => setTourOpen(true), closeTour };
}

export function Tour({ open, onClose, onNavigate, role = 'simulation' }: { open: boolean; onClose: () => void; onNavigate?: (stage: Stage) => void; role?: TourRole }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0);
  const steps = role === 'client' ? clientSteps : role === 'simulation' ? simulationSteps : brokerSteps;
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
    <div className="tour-top"><span className="eyebrow text-[13px] text-text-secondary">{t("Tur singkat ·")}{' '}{step + 1} / {steps.length}</span><button type="button" className="button-ghost inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={onClose} aria-label={t("Tutup tur")}>✕</button></div>
    <div className="tour-progress" aria-label={t(`Langkah ${step + 1} dari ${steps.length}`)}>{steps.map((_, i) => <span key={i} className={i <= step ? 'is-current bg-action-primary' : 'bg-border-subtle'} />)}</div>
    <h2 id="tour-title" className="font-heading text-2xl font-semibold leading-snug" ref={heading} tabIndex={-1}>{t(steps[step].title)}</h2>
    <p className="text-sm leading-relaxed text-text-secondary">{t(steps[step].text)}</p><div className="tour-detail rounded-lg border border-border-subtle bg-surface-selected p-4 text-[13px] leading-relaxed text-text-secondary">{t(steps[step].detail)}</div>
    <div className="tour-actions"><button type="button" className="button-ghost min-h-11 rounded-md px-3.5 py-2.5 text-sm leading-snug font-medium text-text-secondary transition-colors hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={onClose}>{t("Lewati tur")}</button><div><button type="button" className="button-secondary min-h-11 rounded-md border border-border-control bg-surface px-3.5 py-2.5 text-sm leading-snug font-medium text-text-primary transition-colors enabled:hover:bg-surface-subtle focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" onClick={() => setStep(step - 1)} disabled={step === 0}>{t("Kembali")}</button><button type="button" className="button-primary min-h-11 rounded-md border border-action-primary bg-action-primary px-3.5 py-2.5 text-sm leading-snug font-medium text-action-primary-text transition-colors hover:border-action-primary-hover hover:bg-action-primary-hover active:bg-action-primary-active focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none" onClick={() => step === steps.length - 1 ? onClose() : setStep(step + 1)}>{step === steps.length - 1 ? t('Mulai mencoba') : t('Lanjut')}</button></div></div>
  </dialog>;
}
