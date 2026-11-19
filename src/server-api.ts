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
