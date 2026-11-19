export interface Money {
  amount: string
  currency: string
}

export interface Rate {
  value: string
  unit: 'percent' | 'per-mille'
  basis: 'sum-insured'
  peril: string
}

export interface PremiumLine {
  id: string
  peril: string
  included: boolean
  basis: Money
  rate: Rate
  recordedPremium: Money | null
}

export const PREMIUM_ROUNDING = 'Ilustrasi: setiap baris premi dibulatkan HALF_UP ke 2 angka desimal.'

const MAX_INTEGER_DIGITS = 24
const MAX_SCALE = 8

export function isDecimal(value: unknown, options: { maxIntegerDigits?: number; maxScale?: number } = {}): value is string {
  if (typeof value !== 'string' || value.length > MAX_INTEGER_DIGITS + MAX_SCALE + 1) return false
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return false
  const [integer, fraction = ''] = value.split('.')
  return integer.length <= (options.maxIntegerDigits ?? MAX_INTEGER_DIGITS)
    && fraction.length <= (options.maxScale ?? MAX_SCALE)
}

function parts(value: string): { coefficient: bigint; scale: number } {
  if (!isDecimal(value)) throw new RangeError('Nilai desimal tidak valid atau melampaui batas 24 digit bulat / 8 desimal.')
  const [integer, fraction = ''] = value.split('.')
  return { coefficient: BigInt(integer + fraction), scale: fraction.length }
}

function decimalString(coefficient: bigint, scale: number, fixed = false): string {
  const digits = coefficient.toString().padStart(scale + 1, '0')
  const raw = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  const result = fixed || scale === 0 ? raw : raw.replace(/\.?0+$/, '')
  if (!isDecimal(result)) throw new RangeError('Hasil desimal melampaui batas penyimpanan.')
  return result
}

export function addDecimals(values: string[]): string {
  const parsed = values.map(parts)
  const scale = parsed.reduce((maximum, item) => Math.max(maximum, item.scale), 0)
  const total = parsed.reduce((sum, item) => sum + item.coefficient * 10n ** BigInt(scale - item.scale), 0n)
  return decimalString(total, scale)
}

export function validMoney(value: unknown): value is Money {
  if (!value || typeof value !== 'object') return false
  const money = value as Money
  return isDecimal(money.amount) && typeof money.currency === 'string' && /^[A-Z]{3}$/.test(money.currency)
}

export function validRate(value: unknown): value is Rate {
  if (!value || typeof value !== 'object') return false
  const rate = value as Rate
  return isDecimal(rate.value) && (rate.unit === 'percent' || rate.unit === 'per-mille')
    && rate.basis === 'sum-insured' && typeof rate.peril === 'string' && rate.peril.trim().length > 0 && rate.peril.length <= 128
}

export function validPremiumLine(value: unknown): value is PremiumLine {
  if (!value || typeof value !== 'object') return false
  const line = value as PremiumLine
  return typeof line.id === 'string' && line.id.trim().length > 0 && line.id.length <= 128
    && typeof line.included === 'boolean' && validMoney(line.basis) && validRate(line.rate)
    && line.peril === line.rate.peril
    && (line.recordedPremium === null || (validMoney(line.recordedPremium) && line.recordedPremium.currency === line.basis.currency))
}

export function calculatePremium(line: PremiumLine): Money | null {
  if (!validPremiumLine(line)) throw new RangeError('Baris premi tidak valid.')
  if (!line.included) return null
  const basis = parts(line.basis.amount)
  const rate = parts(line.rate.value)
  const numerator = basis.coefficient * rate.coefficient * 100n
  const denominator = 10n ** BigInt(basis.scale + rate.scale) * (line.rate.unit === 'percent' ? 100n : 1000n)
  const cents = numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n)
  return { amount: decimalString(cents, 2, true), currency: line.basis.currency }
}

export function formatDecimal(value: string, minFractionDigits = 0): string {
  parts(value)
  if (!Number.isInteger(minFractionDigits) || minFractionDigits < 0 || minFractionDigits > MAX_SCALE) {
    throw new RangeError('Jumlah angka desimal tampilan tidak valid.')
  }
  const [integer, fraction = ''] = value.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const displayedFraction = fraction.padEnd(minFractionDigits, '0')
  return displayedFraction ? `${grouped},${displayedFraction}` : grouped
}
