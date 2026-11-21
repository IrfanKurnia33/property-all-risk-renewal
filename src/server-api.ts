import type { CaseAction, RenewalCase } from './domain.ts';
import type { clientView } from '../supabase/functions/_shared/api-contract.ts';

export type ClientCase = ReturnType<typeof clientView> & { role: 'client' };
export type CaseView = { role: 'broker'; state: RenewalCase } | ClientCase;
export interface CaseSummary { caseId: string; clientName: string; role: 'broker' | 'client'; lockVersion: number }
export class RequestError extends Error {
  status: number;
  code: string;
  constructor(status:number,code:string,message:string) { super(message);this.status=status;this.code=code; }
}
export function commandEnvelope(caseId:string,expectedVersion:number,action:CaseAction) {
  const {type,...payload}=action;
  return {caseId,expectedVersion,idempotencyKey:crypto.randomUUID(),type,payload};
}
const messages:Record<string,string>={
  AUTH_REQUIRED:'Masuk kembali untuk melanjutkan.',INVALID_SESSION:'Sesi berakhir. Masuk kembali.',
  VERSION_CONFLICT:'Kasus berubah di sesi lain. Isian Anda tetap tersedia. Muat ulang versi terbaru, lalu tinjau sebelum menyimpan kembali.',
  IDEMPOTENCY_CONFLICT:'Identitas permintaan sudah dipakai. Muat ulang dan periksa aktivitas sebelum mencoba lagi.',
  SOURCE_FILE_REQUIRED:'Unggah dan finalisasi berkas sumber yang dirujuk sebelum melanjutkan.',
  UPLOAD_ALREADY_RESERVED:'Versi ini sudah memiliki reservasi unggahan lain. Gunakan versi dokumen baru.',
  UPLOAD_EXPIRED:'Reservasi unggahan berakhir. Catat versi sumber baru, lalu unggah kembali.',
  UPLOAD_HASH_MISMATCH:'Berkas pada penyimpanan berbeda dari berkas yang dipilih. Gunakan versi sumber baru.',
  NOT_FOUND:'Kasus atau dokumen tidak tersedia untuk akun ini.',BROKER_REQUIRED:'Tindakan ini tersedia untuk broker.',
  EXPORT_TEMPLATE_UNAVAILABLE:'Template ekspor ini belum tersedia.',
  PROPOSAL_DOCUMENT_REQUIRED:'Broker belum menyiapkan Word untuk proposal yang dipublikasikan ini.',
  ASSIGNMENT_HAS_EVIDENCE:'Akun ini telah memberikan bukti atau keputusan. Perubahan akses memerlukan peninjauan pengelola.',
  WORKSPACE_SUPERADMIN_REQUIRED:'Hanya Superadmin workspace yang dapat mengubah akses anggota.',
  STANDARD_TERMS_PERMISSION_REQUIRED:'Anda tidak memiliki izin untuk mengelola Standard T&C.',
  LAST_WORKSPACE_SUPERADMIN:'Workspace harus memiliki setidaknya satu Superadmin.',
  MEMBERSHIP_HAS_CASE_HISTORY:'Peran akun dengan penugasan atau aktivitas kasus tidak dapat diubah.',
  SELF_PERMISSION_CHANGE:'Anda tidak dapat mengubah peran atau izin akun sendiri.',
  INVALID_WORKSPACE_MEMBERS:'Periksa kembali perubahan anggota workspace.',
  WORKSPACE_TERMS_UPLOAD_EXPIRED:'Reservasi unggahan Standard T&C berakhir. Mulai versi baru.',
  WORKSPACE_TERMS_UPLOAD_INCOMPLETE:'Unggahan Standard T&C belum lengkap.',
  WORKSPACE_TERMS_FINALIZED:'Versi Standard T&C ini sudah difinalisasi dan tidak dapat diubah.',
  INVALID_STANDARD_TERMS_UPLOAD:'Gunakan file PDF atau DOCX, maksimum 10 MiB.',
  CASE_ALREADY_EXISTS:'ID kasus sudah dipakai. Pilih ID lain.',
  INVALID_PERIOD:'Periksa tanggal awal dan akhir. Periode historis harus berakhir sebelum periode renewal dimulai.',
  INVALID_HISTORICAL_LOCATIONS:'Isi nama, alamat, dan sum insured positif dalam IDR untuk setiap lokasi historis. Gunakan desimal titik tanpa pemisah ribuan.',
  DUPLICATE_HISTORICAL_LOCATION:'Ada lokasi historis yang dicatat dua kali dengan nilai sama. Hapus baris duplikat.',
  INVALID_HISTORICAL_TOTAL:'Total nilai historis melampaui rentang angka yang didukung. Periksa setiap sum insured.',
  INVALID_CLIENTS:'Pilih paling banyak 20 akun klien yang berbeda dari workspace ini.',
  INVALID_CASE:'Isi ID kasus, nama klien fiktif, dan data awal yang valid.',
  BINDING_COMPLETE:'Binding kasus ini sudah lengkap. Perubahan akses memerlukan peninjauan pengelola.',
  INVALID_FIELDS:'Isian permintaan belum sesuai. Periksa formulir dan coba kembali.',
  UNSUPPORTED_FILE:'Berkas tidak didukung atau dilindungi sandi. Konversi ke PDF, DOCX, XLSX, JPEG, PNG atau WebP tanpa enkripsi/makro, maksimum 10 MiB.',
};
export async function apiRequest<T>(options:{url:string;publishableKey:string;token:string;path:string;input?:unknown;signal?:AbortSignal;fetcher?:typeof fetch}):Promise<T> {
  let response:Response;
  try {
    response=await (options.fetcher??fetch)(options.url+'/functions/v1/renewal-api/'+options.path,{
      method:options.input===undefined?'GET':'POST',headers:{apikey:options.publishableKey,Authorization:'Bearer '+options.token,
        ...(options.input===undefined?{}:{'Content-Type':'application/json'})},
      body:options.input===undefined?undefined:JSON.stringify(options.input),
      signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000),
      cache:'no-store',
    });
  } catch(error) {
    if(options.signal?.aborted)throw error;
    throw new RequestError(0,'NETWORK_ERROR','Koneksi terputus. Status penyimpanan belum diketahui; coba ulang tindakan yang sama dengan tombol di bawah.');
  }
  let result;
  try{result=await response.json();}catch{throw new RequestError(0,'INVALID_RESPONSE','Respons belum dapat dibaca. Coba ulang tindakan yang sama.');}
  if(!response.ok)throw new RequestError(response.status,result.error?.code??'REQUEST_FAILED',messages[result.error?.code]
    ?? (response.status===422?result.error?.message:undefined) ?? 'Permintaan belum berhasil. Coba kembali.');
  return result as T;
}
