import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialCase } from './domain.ts';
import { CASE_STORAGE_KEY, readStoredCase, writeStoredCase } from './persistence.ts';

function memoryStorage(initial: string | null = null) {
  let raw = initial;
  let writes = 0;
  return {
    getItem: (_key: string) => raw,
    setItem: (_key: string, value: string) => { raw = value; writes += 1; },
    get raw() { return raw; },
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
  assert.equal(CASE_STORAGE_KEY, 'ruang-renewal.case.v1');
});

test('corrupt or incompatible data is preserved for recovery', () => {
  for (const raw of ['{not-json', '{"schemaVersion":1}', '{"schemaVersion":2}']) {
    const storage = memoryStorage(raw);
    const loaded = readStoredCase(storage);
    assert.equal(loaded.recoveryRequired, true);
    assert.ok(loaded.storageError);
    assert.equal(storage.raw, raw);
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
