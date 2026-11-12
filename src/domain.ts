export type Role = 'broker' | 'insurer' | 'client'
export type Stage = 'materials' | 'insurer' | 'proposal' | 'reconciliation' | 'final'

export interface Terms {
  occupation: string
  periodStart: string
  periodEnd: string
  rateBps: number
  deductible: string
  additionalCoverage: string
  lossHistory: string
}

export interface LocationValues {
  name: string
  address: string
  sumInsured: number
}

export interface ClientLocationInput extends LocationValues {
  locationId: string
  confirmed: boolean
  evidence: string
}

export interface ClientEvidence {
  confirmed: boolean
  source: string
  confirmedBy: string
  at: string
}

export interface RenewalLocation {
  id: string
  prior: LocationValues
  proposed: LocationValues | null
  confirmation: ClientEvidence | null
  review: 'unreviewed' | 'matched' | 'followup'
  reviewNote: string
}

export interface Amendment {
  id: string
  text: string
  status: 'pending' | 'accepted' | 'rejected'
  proposedBy: Role
  note: string
}

export const BROKER_CHECKS = {
  identity: 'Nama, alamat, nilai, dan sumber konfirmasi sesuai',
  period: 'Periode pertanggungan sudah diperiksa',
  rate: 'Rate dan perhitungan premi sudah diperiksa',
  deductible: 'Deductible dan perluasan sudah diperiksa',
  clauses: 'Klausul asli utuh; amandemen dicatat terpisah',
} as const

export type CheckKey = keyof typeof BROKER_CHECKS

export interface RenewalCase {
  schemaVersion: 1
  id: string
  clientName: string
  revision: number
  priorTerms: Terms
  standardTerms: Terms
  terms: Terms
  originalClauses: string[]
  amendments: Amendment[]
  locations: RenewalLocation[]
  quoteRevision: number | null
  insurerAgreement: { revision: number; at: string; note: string } | null
  proposals: { version: number; revision: number; sentAt: string; note: string }[]
  clientAgreement: { revision: number; proposalVersion: number; at: string; evidence: string } | null
  checks: Record<CheckKey, boolean>
  bindingRequest: { revision: number; at: string } | null
  bindingAcknowledgment: { revision: number; at: string; reference: string } | null
  termsRevisions: { revision: number; terms: Terms; author: Role; at: string; note: string }[]
  activity: { id: string; at: string; role: Role; label: string; revision: number }[]
  notes: string
}

export type CaseAction =
  | { type: 'reviseTerms'; terms: Terms; note: string }
  | { type: 'sendQuote'; note?: string }
  | { type: 'insurerAgree'; note: string }
  | { type: 'sendProposal'; note?: string }
  | { type: 'submitLocations'; locations: ClientLocationInput[]; note?: string }
  | { type: 'reviewLocation'; locationId: string; result: 'matched' | 'followup'; note: string }
  | { type: 'proposeAmendment'; text: string }
  | { type: 'resolveAmendment'; amendmentId: string; status: 'accepted' | 'rejected'; note: string }
  | { type: 'setCheck'; check: CheckKey; checked: boolean }
  | { type: 'clientAgree'; evidence: string }
  | { type: 'requestBinding' }
  | { type: 'acknowledgeBinding'; reference: string }
  | { type: 'saveNotes'; notes: string }
  | { type: 'recordExport' }

export interface Blocker {
  id: string
  label: string
  stage: Stage
  locationId?: string
}

const originalClauses = [
  'Property All Risks wording as per Munich Re standard wording.',
  'Automatic Reinstatement of Sum Insured Clause.',
  '72 Hours Clause.',
  'Appraisement Clause — 5% of Total Sum Insured.',
]

const priorTerms: Terms = {
  occupation: 'Pabrik komponen logam dan gudang barang jadi',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  rateBps: 12,
  deductible: 'Rp10.000.000 setiap kejadian; banjir 10% dari klaim, minimum Rp25.000.000.',
  additionalCoverage: 'Banjir, angin topan, dan kerusakan akibat air sesuai wording PAR.',
  lossHistory: 'Nihil klaim selama periode 2026 (contoh fiktif).',
}

const standardTerms: Terms = {
  ...priorTerms,
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  rateBps: 10,
  deductible: 'Rp10.000.000 setiap kejadian; banjir 10% dari klaim, minimum Rp20.000.000.',
}

const priorLocations = [
  { id: 'bekasi', name: 'Pabrik Bekasi', address: 'Jl. Industri Raya No. 18, Bekasi, Jawa Barat', sumInsured: 3_500_000_000 },
  { id: 'tangerang', name: 'Gudang Tangerang', address: 'Jl. Raya Pasar Kemis No. 7, Tangerang, Banten', sumInsured: 2_000_000_000 },
  { id: 'cikarang', name: 'Depo Cikarang', address: 'Jl. Jababeka VI Blok J No. 12, Cikarang, Jawa Barat', sumInsured: 1_500_000_000 },
]

const freshChecks = (): Record<CheckKey, boolean> => ({ identity: false, period: false, rate: false, deductible: false, clauses: false })
const roleName: Record<Role, string> = { broker: 'Broker', insurer: 'Asuransi', client: 'Klien' }
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const text = (value: unknown): value is string => typeof value === 'string'
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const timestamp = (value: unknown): value is string => nonempty(value) && value.includes('T') && Number.isFinite(Date.parse(value))
const same = (left: unknown, right: unknown) => {
  try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
}
const isRole = (value: unknown): value is Role => value === 'broker' || value === 'insurer' || value === 'client'
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function validTerms(value: unknown): value is Terms {
  return record(value) && nonempty(value.occupation) && validDate(value.periodStart)
    && validDate(value.periodEnd) && value.periodStart <= value.periodEnd
    && positiveInteger(value.rateBps) && value.rateBps <= 10_000
    && nonempty(value.deductible) && nonempty(value.additionalCoverage) && nonempty(value.lossHistory)
}

function validLocation(value: unknown, complete = false): value is LocationValues {
  return record(value) && nonempty(value.name) && text(value.address)
    && (!complete || nonempty(value.address)) && positiveInteger(value.sumInsured)
}

export function createInitialCase(): RenewalCase {
  const terms = { ...priorTerms, periodStart: '2027-01-01', periodEnd: '2027-12-31' }
  return {
    schemaVersion: 1,
    id: 'PAR-2027-014',
    clientName: 'PT Arunika Manufaktur Indonesia',
    revision: 1,
    priorTerms: { ...priorTerms },
    standardTerms: { ...standardTerms },
    terms,
    originalClauses: [...originalClauses],
    amendments: [],
    locations: priorLocations.map(({ id, ...prior }) => ({ id, prior, proposed: null, confirmation: null, review: 'unreviewed', reviewNote: '' })),
    quoteRevision: null,
    insurerAgreement: null,
    proposals: [],
    clientAgreement: null,
    checks: freshChecks(),
    bindingRequest: null,
    bindingAcknowledgment: null,
    termsRevisions: [{ revision: 1, terms: { ...terms }, author: 'broker', at: '2026-11-11T02:00:00.000Z', note: 'Bahan renewal disiapkan dari final slip 2026 dan Standard T&C fiktif.' }],
    activity: [{ id: 'event-1', at: '2026-11-11T02:00:00.000Z', role: 'broker', label: 'Kasus contoh disiapkan. Belum ada pesan yang dikirim ke pihak nyata.', revision: 1 }],
    notes: '',
  }
}

export function sampleClientResponse(state: RenewalCase): ClientLocationInput[] {
  return state.locations.map((location) => ({
    locationId: location.id,
    name: location.id === 'cikarang' ? 'Cikarang Baru' : location.prior.name,
    address: location.id === 'cikarang' ? '' : location.prior.address,
    sumInsured: location.id === 'bekasi' ? 4_200_000_000 : location.id === 'cikarang' ? 1_800_000_000 : 2_000_000_000,
    confirmed: location.id !== 'cikarang',
    evidence: location.id === 'cikarang'
      ? 'Email contoh dari Nadia Putri: Cikarang Baru, nilai Rp1,8 miliar diusulkan; alamat dan kecocokan dengan depo lama masih diperiksa.'
      : `Email contoh dari Nadia Putri: ${location.prior.name}, alamat dan nilai ${location.id === 'bekasi' ? 'Rp4,2 miliar' : 'Rp2 miliar (tetap)'} dikonfirmasi.`,
  }))
}

export function sampleClientClarification(state: RenewalCase): ClientLocationInput[] {
  const location = state.locations.find((item) => item.id === 'cikarang')!
  return [{
    locationId: location.id,
    name: location.proposed?.name ?? 'Cikarang Baru',
    address: location.prior.address,
    sumInsured: location.proposed?.sumInsured ?? 1_800_000_000,
    confirmed: true,
    evidence: 'Email klarifikasi contoh dari Nadia Putri: Cikarang Baru adalah Depo Cikarang yang sama, hanya berganti nama, bukan lokasi baru. Alamat tetap di Jl. Jababeka VI Blok J No. 12, Cikarang, Jawa Barat. Nilai Rp1,8 miliar dikonfirmasi.',
  }]
}

export function getExportBlockers(state: RenewalCase): Blocker[] {
  const blockers: Blocker[] = []
  if (!state.proposals.length) blockers.push({ id: 'proposal-first', label: 'Proposal pertama belum dikirim ke klien.', stage: 'proposal' })
  for (const location of state.locations) {
    const label = location.proposed?.name || location.prior.name
    const add = (id: string, message: string, stage: Stage) => blockers.push({ id: `${id}-${location.id}`, label: `${label}: ${message}`, stage, locationId: location.id })
    if (!location.proposed) add('data', 'belum ada tanggapan klien.', 'proposal')
    else if (!nonempty(location.proposed.address)) add('address', 'alamat lengkap belum jelas.', 'proposal')
    if (!location.confirmation?.confirmed) add('confirmation', 'konfirmasi klien belum lengkap (termasuk data yang tetap).', 'proposal')
    if (!nonempty(location.confirmation?.source)) add('evidence', 'sumber konfirmasi belum dicatat.', 'proposal')
    if (location.review !== 'matched') add('matching', location.review === 'followup' ? 'perlu follow-up dan pencocokan ulang.' : 'belum dicocokkan oleh broker.', 'reconciliation')
  }
  if (state.insurerAgreement?.revision !== state.revision) blockers.push({ id: 'insurer-current', label: `Kesepakatan asuransi belum mencakup revisi ${state.revision}.`, stage: 'insurer' })
  for (const amendment of state.amendments) {
    if (amendment.status === 'pending') blockers.push({ id: `amendment-${amendment.id}`, label: `Usulan amandemen belum diselesaikan: ${amendment.text}`, stage: 'insurer' })
  }
  for (const key of Object.keys(BROKER_CHECKS) as CheckKey[]) {
    if (!state.checks[key]) blockers.push({ id: `check-${key}`, label: BROKER_CHECKS[key], stage: 'final' })
  }
  return blockers
}

export function getBindingBlockers(state: RenewalCase): Blocker[] {
  const blockers = getExportBlockers(state)
  const latest = state.proposals.at(-1)
  if (!latest || latest.revision !== state.revision) blockers.push({ id: 'proposal-current', label: 'Kirim proposal terbaru yang memuat seluruh perubahan.', stage: 'proposal' })
  if (!latest || state.clientAgreement?.revision !== state.revision || state.clientAgreement?.proposalVersion !== latest.version) {
    blockers.push({ id: 'client-agreement', label: 'Klien belum menyetujui versi proposal terbaru.', stage: 'proposal' })
  }
  return blockers
}

export function getCoverageStatus(state: RenewalCase, now = new Date()): string {
  if (!state.bindingAcknowledgment) return state.bindingRequest ? 'Menunggu konfirmasi binding' : 'Belum binding'
  const start = new Date(`${state.terms.periodStart}T00:00:00+07:00`).getTime()
  const end = new Date(`${state.terms.periodEnd}T23:59:59.999+07:00`).getTime()
  if (now.getTime() < start) return 'Terjadwal'
  return now.getTime() > end ? 'Periode berakhir' : 'Aktif'
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function requireRole(role: Role, allowed: Role[]) {
  ensure(allowed.includes(role), `Tindakan ini hanya tersedia untuk ${allowed.map((item) => roleName[item]).join(' atau ')}.`)
}

function invalidatePolicy(state: RenewalCase) {
  state.revision += 1
  state.quoteRevision = null
  state.insurerAgreement = null
  state.clientAgreement = null
  state.checks = freshChecks()
  state.bindingRequest = null
  state.bindingAcknowledgment = null
}

export function applyAction(state: RenewalCase, role: Role, action: CaseAction, at = new Date().toISOString()): RenewalCase {
  ensure(isRole(role), 'Peran simulasi tidak dikenal.')
  ensure(timestamp(at), 'Waktu aktivitas tidak valid.')
  ensure(isRenewalCase(state), 'Data kasus tidak valid. Pulihkan atau reset contoh melalui pengaturan penyimpanan.')
  ensure(record(action) && nonempty(action.type), 'Tindakan tidak valid.')
  if (state.bindingAcknowledgment && action.type !== 'saveNotes' && action.type !== 'recordExport') {
    throw new Error('Binding sudah dikonfirmasi asuransi. Data renewal dikunci; catatan uji tetap dapat diubah.')
  }
  if (role === 'client' && action.type !== 'saveNotes') ensure(state.proposals.length > 0, 'Klien baru terlibat setelah proposal pertama dikirim.')
  const next = structuredClone(state)
  let label: string

  switch (action.type) {
    case 'reviseTerms': {
      if (role === 'insurer') ensure(state.quoteRevision !== null, 'Quotation perlu dikirim sebelum asuransi memberikan counter terms.')
      ensure(validTerms(action.terms), 'Lengkapi T&C, tanggal yang valid, dan rate positif dalam basis point bulat (maksimum 10.000).')
      ensure(nonempty(action.note), 'Catat alasan perubahan T&C.')
      ensure(!same(state.terms, action.terms), 'Belum ada perubahan T&C untuk disimpan.')
      invalidatePolicy(next)
      next.terms = structuredClone(action.terms)
      if (role === 'insurer') next.quoteRevision = next.revision
      next.termsRevisions.push({ revision: next.revision, terms: structuredClone(action.terms), author: role, at, note: action.note.trim() })
      label = `${roleName[role]} mengajukan perubahan T&C: ${action.note.trim()}`
      break
    }
    case 'sendQuote':
      requireRole(role, ['broker'])
      ensure(action.note === undefined || text(action.note), 'Catatan quotation tidak valid.')
      next.quoteRevision = next.revision
      label = `Broker mengirim quotation revisi ${next.revision} ke asuransi (simulasi).${action.note ? ` ${action.note.trim()}` : ''}`
      break
    case 'insurerAgree':
      requireRole(role, ['insurer'])
      ensure(state.quoteRevision === state.revision, 'Broker perlu mengirim quotation dengan data terbaru terlebih dahulu.')
      ensure(!state.amendments.some((item) => item.status === 'pending'), 'Selesaikan seluruh usulan amandemen sebelum menyepakati quotation.')
      ensure(nonempty(action.note), 'Catat sumber atau rincian kesepakatan asuransi.')
      next.insurerAgreement = { revision: state.revision, at, note: action.note.trim() }
      label = `Asuransi menyepakati quotation revisi ${state.revision}: ${action.note.trim()}`
      break
    case 'sendProposal':
      requireRole(role, ['broker'])
      ensure(state.insurerAgreement?.revision === state.revision, 'Dapatkan kesepakatan asuransi untuk revisi terbaru sebelum mengirim proposal.')
      ensure(action.note === undefined || text(action.note), 'Catatan proposal tidak valid.')
      next.proposals.push({ version: state.proposals.length + 1, revision: state.revision, sentAt: at, note: action.note?.trim() ?? '' })
      next.clientAgreement = null
      next.bindingRequest = null
      label = `Broker mengirim proposal versi ${next.proposals.length}, revisi ${state.revision}, kepada klien (simulasi).`
      break
    case 'submitLocations': {
      requireRole(role, ['client'])
      ensure(Array.isArray(action.locations) && action.locations.length > 0, 'Isi setidaknya satu tanggapan lokasi.')
      ensure(action.locations.every((item) => record(item)), 'Format tanggapan lokasi tidak valid.')
      ensure(action.note === undefined || text(action.note), 'Catatan tanggapan tidak valid.')
      ensure(new Set(action.locations.map((item) => item.locationId)).size === action.locations.length, 'Lokasi yang sama tidak boleh dikirim dua kali dalam satu tanggapan.')
      let changed = false
      for (const input of action.locations) {
        ensure(record(input) && validLocation(input) && typeof input.confirmed === 'boolean' && text(input.evidence), 'Nama lokasi dan nilai pertanggungan harus valid; nilai harus berupa rupiah bulat positif.')
        const location = next.locations.find((item) => item.id === input.locationId)
        ensure(location, 'Lokasi tidak ditemukan dalam kasus ini.')
        ensure(!input.confirmed || (nonempty(input.address) && nonempty(input.evidence)), 'Konfirmasi memerlukan alamat lengkap dan sumber konfirmasi klien.')
        const proposed = { name: input.name.trim(), address: input.address.trim(), sumInsured: input.sumInsured }
        if (!same(location.proposed ?? location.prior, proposed)) changed = true
        location.proposed = proposed
        location.confirmation = { confirmed: input.confirmed, source: input.evidence.trim(), confirmedBy: 'Nadia Putri · Klien (simulasi)', at }
        location.review = 'unreviewed'
        location.reviewNote = ''
      }
      ensure(Number.isSafeInteger(next.locations.reduce((sum, item) => sum + (item.proposed ?? item.prior).sumInsured, 0)), 'Total nilai pertanggungan melampaui batas angka yang dapat diproses.')
      if (changed) invalidatePolicy(next)
      else {
        next.checks.identity = false
        next.bindingRequest = null
        if (action.locations.some((input) => !input.confirmed)) next.clientAgreement = null
      }
      label = `Klien mengirim tanggapan untuk ${action.locations.length} lokasi.${changed ? ' Perubahan data memerlukan review asuransi kembali.' : ''}${action.note ? ` ${action.note.trim()}` : ''}`
      break
    }
    case 'reviewLocation': {
      requireRole(role, ['broker'])
      ensure(action.result === 'matched' || action.result === 'followup', 'Status pencocokan tidak valid.')
      ensure(text(action.note), 'Catatan pencocokan tidak valid.')
      const location = next.locations.find((item) => item.id === action.locationId)
      ensure(location?.proposed, 'Tunggu tanggapan klien sebelum mencocokkan lokasi.')
      if (action.result === 'matched') ensure(location.confirmation?.confirmed && nonempty(location.confirmation.source) && validLocation(location.proposed, true), 'Lokasi hanya dapat dicocokkan setelah alamat, nilai, dan sumbernya dikonfirmasi klien.')
      else ensure(nonempty(action.note), 'Catat detail yang perlu diklarifikasi oleh klien.')
      location.review = action.result
      location.reviewNote = action.note.trim()
      next.checks.identity = false
      next.bindingRequest = null
      label = action.result === 'matched' ? `Broker mencocokkan ${location.proposed.name} dengan konfirmasi klien.` : `Broker meminta klarifikasi ${location.proposed.name}: ${action.note.trim()}`
      break
    }
    case 'proposeAmendment':
      if (role === 'insurer') ensure(state.quoteRevision === state.revision, 'Broker perlu mengirim quotation terbaru sebelum asuransi mengusulkan amandemen.')
      ensure(nonempty(action.text), 'Isi usulan amandemen. Klausul asli tetap utuh.')
      invalidatePolicy(next)
      next.amendments.push({ id: `amendment-${next.amendments.length + 1}`, text: action.text.trim(), status: 'pending', proposedBy: role, note: '' })
      label = `${roleName[role]} mengusulkan amandemen terpisah: ${action.text.trim()}`
      break
    case 'resolveAmendment': {
      requireRole(role, ['insurer'])
      ensure(state.quoteRevision === state.revision, 'Broker perlu mengirim quotation beserta usulan amandemen sebelum asuransi menanggapinya.')
      ensure(action.status === 'accepted' || action.status === 'rejected', 'Keputusan amandemen tidak valid.')
      ensure(nonempty(action.note), 'Catat tanggapan asuransi terhadap amandemen.')
      const amendment = next.amendments.find((item) => item.id === action.amendmentId)
      ensure(amendment?.status === 'pending', 'Usulan amandemen ini tidak ditemukan atau sudah diselesaikan.')
      invalidatePolicy(next)
      amendment.status = action.status
      amendment.note = action.note.trim()
      label = `Asuransi ${action.status === 'accepted' ? 'menerima' : 'menolak'} amandemen: ${amendment.text}`
      break
    }
    case 'setCheck': {
      requireRole(role, ['broker'])
      ensure(Object.hasOwn(BROKER_CHECKS, action.check) && typeof action.checked === 'boolean', 'Checklist tidak dikenal.')
      if (action.checked) {
        const outstanding = getExportBlockers(state).filter((item) => !item.id.startsWith('check-'))
        ensure(!outstanding.length, `Selesaikan data dan review asuransi terlebih dahulu: ${outstanding[0]?.label ?? ''}`)
      }
      next.checks[action.check] = action.checked
      if (!action.checked) next.bindingRequest = null
      label = `Broker ${action.checked ? 'menyelesaikan' : 'membuka kembali'} pemeriksaan: ${BROKER_CHECKS[action.check]}.`
      break
    }
    case 'clientAgree': {
      requireRole(role, ['client'])
      const proposal = state.proposals.at(-1)
      ensure(proposal?.revision === state.revision && state.insurerAgreement?.revision === state.revision, 'Tunggu proposal terbaru setelah seluruh perubahan disepakati asuransi.')
      ensure(state.locations.every((item) => item.proposed && item.confirmation?.confirmed && nonempty(item.confirmation.source) && validLocation(item.proposed, true)), 'Konfirmasikan seluruh lokasi dan nilai terlebih dahulu, termasuk nilai yang tetap.')
      ensure(!state.amendments.some((item) => item.status === 'pending'), 'Usulan amandemen masih perlu diselesaikan.')
      ensure(nonempty(action.evidence), 'Catat sumber persetujuan klien.')
      next.clientAgreement = { revision: state.revision, proposalVersion: proposal.version, at, evidence: action.evidence.trim() }
      label = `Klien menyetujui proposal versi ${proposal.version}, revisi ${state.revision}: ${action.evidence.trim()}`
      break
    }
    case 'requestBinding':
      requireRole(role, ['broker'])
      ensure(!state.bindingRequest, 'Permintaan binding sudah tercatat; tunggu konfirmasi asuransi.')
      ensure(!getBindingBlockers(state).length, `Binding belum siap: ${getBindingBlockers(state)[0]?.label ?? ''}`)
      next.bindingRequest = { revision: state.revision, at }
      label = `Broker meneruskan permintaan binding revisi ${state.revision} ke asuransi (simulasi).`
      break
    case 'acknowledgeBinding':
      requireRole(role, ['insurer'])
      ensure(state.bindingRequest?.revision === state.revision, 'Broker belum meneruskan permintaan binding untuk revisi ini.')
      ensure(!getBindingBlockers(state).length, 'Ada perubahan atau rincian belum lengkap; binding perlu diperiksa kembali.')
      ensure(nonempty(action.reference), 'Catat referensi konfirmasi binding asuransi.')
      next.bindingAcknowledgment = { revision: state.revision, at, reference: action.reference.trim() }
      label = `Asuransi mengonfirmasi binding: ${action.reference.trim()}. Pertanggungan mengikuti periode yang disepakati.`
      break
    case 'saveNotes':
      ensure(text(action.notes), 'Catatan uji tidak valid.')
      next.notes = action.notes
      label = 'Catatan sesi uji diperbarui.'
      break
    case 'recordExport':
      requireRole(role, ['broker'])
      ensure(!getExportBlockers(state).length, 'Draft Word belum dapat diekspor; selesaikan seluruh penghambat.')
      label = `Broker mengunduh draft Word revisi ${state.revision}.`
      break
    default:
      throw new Error('Tindakan simulasi tidak dikenal.')
  }

  next.activity.push({ id: `event-${state.activity.length + 1}`, at, role, label, revision: next.revision })
  ensure(isRenewalCase(next), 'Perubahan belum dapat disimpan karena data kasus tidak konsisten. Progres sebelumnya tetap tersedia.')
  return next
}

/** Saved state is a trust boundary: reject broken structure and impossible workflow combinations. */
export function isRenewalCase(value: unknown): value is RenewalCase {
  if (!record(value) || value.schemaVersion !== 1 || value.id !== 'PAR-2027-014'
    || value.clientName !== 'PT Arunika Manufaktur Indonesia' || !positiveInteger(value.revision)
    || !same(value.priorTerms, priorTerms) || !same(value.standardTerms, standardTerms) || !validTerms(value.terms)
    || !Array.isArray(value.originalClauses) || !same(value.originalClauses, originalClauses)
    || !Array.isArray(value.locations) || value.locations.length !== priorLocations.length
    || !Array.isArray(value.amendments) || !Array.isArray(value.proposals)
    || !Array.isArray(value.termsRevisions) || value.termsRevisions.length === 0
    || !Array.isArray(value.activity) || value.activity.length === 0 || !text(value.notes) || !record(value.checks)) return false

  const revision = value.revision
  const validRevision = (item: unknown): item is number => positiveInteger(item) && item <= revision
  if (value.quoteRevision !== null && value.quoteRevision !== revision) return false
  if (!(Object.keys(BROKER_CHECKS) as CheckKey[]).every((key) => typeof (value.checks as Record<string, unknown>)[key] === 'boolean')) return false

  for (let index = 0; index < value.locations.length; index += 1) {
    const location: unknown = value.locations[index]
    const { id, ...prior } = priorLocations[index]!
    if (!record(location) || location.id !== id || !same(location.prior, prior)
      || (location.proposed !== null && !validLocation(location.proposed))
      || !['unreviewed', 'matched', 'followup'].includes(location.review as string) || !text(location.reviewNote)) return false
    if (location.confirmation !== null && (!record(location.confirmation) || typeof location.confirmation.confirmed !== 'boolean'
      || !text(location.confirmation.source) || !nonempty(location.confirmation.confirmedBy) || !timestamp(location.confirmation.at))) return false
    if ((location.proposed === null) !== (location.confirmation === null)) return false
    const confirmation = location.confirmation as ClientEvidence | null
    if (confirmation?.confirmed && (!nonempty(confirmation.source) || !validLocation(location.proposed, true))) return false
    if (location.review === 'matched' && !confirmation?.confirmed) return false
    if (location.review === 'followup' && !nonempty(location.reviewNote)) return false
  }
  if (!Number.isSafeInteger(value.locations.reduce((sum: number, item: RenewalLocation) => sum + (item.proposed ?? item.prior).sumInsured, 0))) return false
  if (!value.amendments.every((item: unknown, index: number) => record(item) && item.id === `amendment-${index + 1}`
    && nonempty(item.text) && ['pending', 'accepted', 'rejected'].includes(item.status as string)
    && isRole(item.proposedBy) && text(item.note) && (item.status === 'pending' || nonempty(item.note)))) return false
  if (!value.proposals.every((item: unknown, index: number) => record(item) && item.version === index + 1 && validRevision(item.revision) && timestamp(item.sentAt) && text(item.note))) return false
  if (!value.termsRevisions.every((item: unknown) => record(item) && validRevision(item.revision) && validTerms(item.terms) && isRole(item.author) && timestamp(item.at) && nonempty(item.note))) return false
  if (!same((value.termsRevisions.at(-1) as RenewalCase['termsRevisions'][number]).terms, value.terms)) return false
  if (!value.activity.every((item: unknown, index: number) => record(item) && item.id === `event-${index + 1}` && timestamp(item.at) && isRole(item.role) && nonempty(item.label) && validRevision(item.revision))) return false
  if ((value.activity.at(-1) as RenewalCase['activity'][number]).revision !== revision) return false

  const currentEvent = (item: unknown) => record(item) && item.revision === revision && timestamp(item.at)
  if (value.insurerAgreement !== null && (!currentEvent(value.insurerAgreement) || !nonempty((value.insurerAgreement as Record<string, unknown>).note) || value.quoteRevision !== revision)) return false
  if (value.clientAgreement !== null) {
    const agreement = value.clientAgreement
    const latest = value.proposals.at(-1) as RenewalCase['proposals'][number] | undefined
    if (!currentEvent(agreement) || !record(agreement) || !nonempty(agreement.evidence) || agreement.proposalVersion !== latest?.version
      || latest?.revision !== revision || value.insurerAgreement === null) return false
    if (!(value.locations as RenewalLocation[]).every((location) => location.confirmation?.confirmed)) return false
  }
  if (value.bindingRequest !== null && !currentEvent(value.bindingRequest)) return false
  if (value.bindingAcknowledgment !== null && (!currentEvent(value.bindingAcknowledgment)
    || !nonempty((value.bindingAcknowledgment as Record<string, unknown>).reference) || value.bindingRequest === null)) return false

  const state = value as unknown as RenewalCase
  if (state.insurerAgreement && state.amendments.some((item) => item.status === 'pending')) return false
  if ((state.bindingRequest || state.bindingAcknowledgment) && getBindingBlockers(state).length > 0) return false
  return true
}
