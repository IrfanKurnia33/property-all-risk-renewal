import assert from 'node:assert/strict'
import test from 'node:test'
import { addDecimals, calculatePremium, formatDecimal, isDecimal, PREMIUM_ROUNDING, validMoney, validPremiumLine, validRate } from './decimal.ts'
import type { PremiumLine } from './decimal.ts'

const line: PremiumLine = {
  id: 'par', peril: 'PAR', included: true,
  basis: { amount: '7000000000', currency: 'IDR' },
  rate: { value: '0.0483', unit: 'percent', basis: 'sum-insured', peril: 'PAR' },
  recordedPremium: { amount: '3400000.00', currency: 'IDR' },
}

test('exact percent and per-mille calculations preserve source precision and separate recorded premiums', () => {
  assert.deepEqual(calculatePremium(line), { amount: '3381000.00', currency: 'IDR' })
  assert.deepEqual(calculatePremium({ ...line, rate: { ...line.rate, value: '0.483', unit: 'per-mille' } }), { amount: '3381000.00', currency: 'IDR' })
  assert.equal(line.rate.value, '0.0483')
  assert.equal(line.recordedPremium?.amount, '3400000.00')
  assert.equal(calculatePremium({ ...line, included: false, peril: 'EQ', rate: { ...line.rate, peril: 'EQ' } }), null)
  assert.equal(calculatePremium({ ...line, rate: { ...line.rate, value: '0' } })?.amount, '0.00')
})

test('illustrations round each line half up at two places with an explicit convention', () => {
  const small = { ...line, basis: { amount: '1', currency: 'IDR' } }
  assert.equal(calculatePremium({ ...small, rate: { ...line.rate, value: '0.5' } })?.amount, '0.01')
  assert.equal(calculatePremium({ ...small, rate: { ...line.rate, value: '0.49999999' } })?.amount, '0.00')
  assert.equal(calculatePremium({ ...small, rate: { ...line.rate, value: '1.5' } })?.amount, '0.02')
  assert.equal(addDecimals([calculatePremium({ ...small, rate: { ...line.rate, value: '0.5' } })!.amount, '0.01']), '0.02')
  assert.match(PREMIUM_ROUNDING, /HALF_UP.*2/)
})

test('large amounts, exact addition and Indonesian display never pass money through floating point', () => {
  const large = { ...line, basis: { amount: '900719925474099312345678', currency: 'IDR' } }
  assert.equal(calculatePremium(large)?.amount, '435047724003989967862.96')
  assert.equal(addDecimals(['9007199254740993.12', '0.88', '0.00000001']), '9007199254740994.00000001')
  assert.equal(addDecimals(['0.10', '0.20']), '0.3')
  assert.equal(addDecimals(['0.00']), '0')
  assert.equal(addDecimals([]), '0')
  assert.equal(formatDecimal('900719925474099312345678.12'), '900.719.925.474.099.312.345.678,12')
  assert.equal(formatDecimal('3381000', 2), '3.381.000,00')
  assert.equal(formatDecimal('0.0483'), '0,0483')
})

test('trust-boundary guards reject ambiguous, negative, excessive and inconsistent values', () => {
  for (const value of [1, null, '', ' 1', '1 ', '+1', '-1', '01', '1.', '.1', '1e3', '1,2', 'NaN', '9'.repeat(25), '0.123456789']) assert.equal(isDecimal(value), false)
  for (const value of ['0', '1.00', '0.0483', '9'.repeat(24), '0.12345678']) assert.equal(isDecimal(value), true)
  assert.equal(isDecimal('1.23', { maxScale: 1 }), false)
  assert.equal(isDecimal('123', { maxIntegerDigits: 2 }), false)
  assert.equal(validMoney({ amount: '1', currency: 'idr' }), false)
  assert.equal(validRate({ ...line.rate, unit: 'bps' }), false)
  assert.equal(validRate({ ...line.rate, basis: 'premium' }), false)
  assert.equal(validPremiumLine({ ...line, peril: 'EQ' }), false)
  assert.equal(validPremiumLine({ ...line, recordedPremium: { amount: '1', currency: 'USD' } }), false)
  assert.equal(validPremiumLine(line), true)
  assert.throws(() => calculatePremium({ ...line, rate: { ...line.rate, value: '-1' } }), RangeError)
  assert.throws(() => addDecimals(['9'.repeat(24), '1']), RangeError)
  assert.throws(() => calculatePremium({ ...line, basis: { amount: '9'.repeat(24), currency: 'IDR' }, rate: { ...line.rate, value: '10000' } }), RangeError)
  assert.throws(() => formatDecimal('1e3'), RangeError)
  assert.throws(() => formatDecimal('1', 9), RangeError)
})
