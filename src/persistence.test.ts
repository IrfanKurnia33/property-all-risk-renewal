import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialCase, isRenewalCase } from './domain.ts';
import { CASE_STORAGE_KEY, LEGACY_CASE_STORAGE_KEY, readStoredCase, writeStoredCase } from './persistence.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); writes += 1; },
    get writes() { return writes; },
  };
}

test('a fresh browser opens a fictional case without writing over storage', () => {
  const storage = memoryStorage();
  const loaded = readStoredCase(storage);
  assert.equal(loaded.recoveryRequired, false);
  assert.equal(loaded.state.id, createInitialCase().id);
  assert.equal(storage.writes, 0);
});

test('saved progress and test notes round-trip', () => {
  const state = createInitialCase();
  state.notes = 'Bahas lagi konfirmasi Cikarang dengan Falih.';
  const storage = memoryStorage();
  assert.equal(writeStoredCase(storage, state), '');
  const loaded = readStoredCase(storage);
  assert.deepEqual(loaded.state, state);
  assert.equal(loaded.recoveryRequired, false);
  assert.equal(isRenewalCase(loaded.state), true);
  assert.equal(CASE_STORAGE_KEY, 'rekonvia.case.v2');
  assert.notEqual(CASE_STORAGE_KEY, LEGACY_CASE_STORAGE_KEY);
});

test('legacy data remains byte-exact and blocks changes until explicit recovery', () => {
  const legacy = '{ "schemaVersion": 1, "notes": "Preserve my prior notes exactly.\\n" }';
  const storage = memoryStorage({ [LEGACY_CASE_STORAGE_KEY]: legacy });
  const loaded = readStoredCase(storage);
  assert.equal(loaded.recoveryRequired, true);
  assert.match(loaded.storageError, /Unduh cadangannya/);
  assert.equal(storage.getItem(LEGACY_CASE_STORAGE_KEY), legacy);
  assert.equal(storage.getItem(CASE_STORAGE_KEY), null);
  assert.equal(storage.writes, 0);
  // Explicitly saving the new case uses a separate key and retains the backup.
  assert.equal(writeStoredCase(storage, loaded.state), '');
  assert.equal(storage.getItem(LEGACY_CASE_STORAGE_KEY), legacy);
  assert.equal(readStoredCase(storage).recoveryRequired, false);
});

test('generic fictional case identities and locations round-trip without fixture assumptions', () => {
  const state = createInitialCase();
  state.id = 'PAR-SYNTHETIC-892';
  state.clientName = 'PT Klien Pengujian Lain';
  state.locations = state.locations.map((location, index) => ({
    ...location,
    id: 'custom-location-' + index,
    prior: { name: 'Gedung ' + index, address: 'Alamat pengujian ' + index, sumInsured: { amount: '123456789.12', currency: 'IDR' } },
  }));
  assert.equal(isRenewalCase(state), true);
  const storage = memoryStorage();
  assert.equal(writeStoredCase(storage, state), '');
  const loaded = readStoredCase(storage);
  assert.equal(loaded.recoveryRequired, false);
  assert.deepEqual(loaded.state, state);
});

test('corrupt or incompatible data is preserved for recovery', () => {
  for (const raw of ['{not-json', '{"schemaVersion":1}', '{"schemaVersion":2}']) {
    const storage = memoryStorage({ [CASE_STORAGE_KEY]: raw });
    const loaded = readStoredCase(storage);
    assert.equal(loaded.recoveryRequired, true);
    assert.ok(loaded.storageError);
    assert.equal(storage.getItem(CASE_STORAGE_KEY), raw);
    assert.equal(storage.writes, 0);
  }
});

test('unavailable storage leaves an explicit memory-only mode', () => {
  const loaded = readStoredCase(null);
  assert.equal(loaded.recoveryRequired, false);
  assert.match(loaded.storageError, /selama halaman ini terbuka/);
  assert.match(writeStoredCase(null, loaded.state), /belum berhasil disimpan/);
});

test('quota and access errors are reported instead of thrown away', () => {
  const storage = {
    getItem: () => { throw new Error('Access denied'); },
    setItem: () => { throw new Error('Quota exceeded'); },
  };
  assert.equal(readStoredCase(storage).recoveryRequired, true);
  assert.match(writeStoredCase(storage, createInitialCase()), /unduh ringkasan/);
});
