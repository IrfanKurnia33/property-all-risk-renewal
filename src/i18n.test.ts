import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOCALE, formatDate, formatNumber, getLocale, LOCALE_KEY, readLocale, setLocale, subscribeLocale, translate } from './i18n.ts';
import { createInitialCase, getExportBlockers, getQsBlockers } from './domain.ts';

test('English is the default and invalid or unavailable storage falls back safely', () => {
  assert.equal(DEFAULT_LOCALE, 'en_US');
  assert.equal(readLocale(), 'en_US');
  for (const value of ['id', 'en-GB', 'garbage', null]) assert.equal(readLocale({ getItem: () => value }), 'en_US');
  assert.equal(readLocale({ getItem: key => key === LOCALE_KEY ? 'id_ID' : null }), 'id_ID');
  assert.equal(readLocale({ getItem: () => { throw new Error('blocked'); } }), 'en_US');
});

test('messages, dynamic readiness and source identifiers translate without changing case data', () => {
  assert.equal(translate('Masuk ke Rekonvia', 'en_US'), 'Sign in to Rekonvia');
  assert.equal(translate('Masuk ke Rekonvia', 'id_ID'), 'Masuk ke Rekonvia');
  assert.equal(translate('Langkah 2 dari 5', 'en_US'), 'Step 2 of 5');
  const state = createInitialCase(), before = JSON.stringify(state);
  for (const blocker of [...getQsBlockers(state), ...getExportBlockers(state)]) {
    const result = translate(blocker.label, 'en_US');
    assert.notEqual(result, blocker.label, blocker.label);
  }
  const source = 'Clause [A]+: unusual wording\nRp 10.000,00';
  assert.equal(translate(source, 'en_US'), source);
  assert.equal(translate(source + ': tinjau wording dan selesaikan pertanyaan QS.', 'en_US'), source + ': review the wording and resolve the QS questions.');
  assert.equal(translate('Klien: tinjau wording dan selesaikan pertanyaan QS.', 'en_US'), 'Klien: review the wording and resolve the QS questions.');
  assert.match(translate('QS belum siap: Klien: tinjau wording dan selesaikan pertanyaan QS.', 'en_US'), /^QS is not ready: Klien:/);
  assert.equal(JSON.stringify(state), before);
});

test('language changes notify subscribers and retain exact decimal precision and Jakarta dates', () => {
  let notifications = 0;
  const unsubscribe = subscribeLocale(() => notifications++);
  try {
    setLocale('en_US');
    assert.equal(getLocale(), 'en_US');
    assert.equal(formatNumber('123456789012345678901234.0100'), '123,456,789,012,345,678,901,234.0100');
    assert.equal(formatDate('2027-01-01', { year: 'numeric', month: 'short', day: 'numeric' }), 'Jan 1, 2027');
    setLocale('id_ID');
    assert.equal(formatNumber('123456789012345678901234.0100'), '123.456.789.012.345.678.901.234,0100');
    assert.equal(formatNumber('3381000', 2), '3.381.000,00');
    assert.match(formatDate('2027-01-01', { year: 'numeric', month: 'short', day: 'numeric' }), /1 Jan 2027/);
    assert.equal(notifications, 2);
  } finally { unsubscribe(); setLocale('en_US'); }
});
