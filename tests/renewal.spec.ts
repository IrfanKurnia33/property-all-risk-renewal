import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CASE_STORAGE_KEY } from '../src/persistence.ts';
import type { RenewalCase, Role } from '../src/domain.ts';
import { exportReadyCase, partialResponseCase } from './fixtures.ts';

async function seed(page: Page, state?: RenewalCase) {
  await page.addInitScript(({ key, data }) => {
    localStorage.setItem('ruang-renewal.tour.v1', 'seen');
    if (data && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, { key: CASE_STORAGE_KEY, data: state });
}
async function stage(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 800) {
    const menu = page.locator('.mobile-stage-nav');
    if (!await menu.evaluate(el => (el as HTMLDetailsElement).open)) await menu.locator('summary').click();
  }
  await page.locator('.stage-link:visible').filter({ hasText: label }).click();
}
const role = (page: Page, value: Role) => page.getByLabel('Peran simulasi').selectOption(value);
const saved = (page: Page): Promise<RenewalCase> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CASE_STORAGE_KEY);

test('first visit tour is dismissible, keyboard accessible, replayable, and changes no case data', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Satu kasus, dari quotation sampai binding' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#tour-title')).toBeFocused();
  await page.getByRole('button', { name: 'Lanjut', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ikuti tahap, bolak-balik bila perlu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour-dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bahan renewal', exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), CASE_STORAGE_KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('.tour-dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Ulangi tur', exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Lewati tur' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), CASE_STORAGE_KEY)).toBeNull();
});

test('whole renewal journey through negotiation, clarification, Word export, consent, and binding', async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#role-select option[value="client"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Lihat dokumen', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Final slip 2026' })).toContainText('Automatic Reinstatement');
  await page.keyboard.press('Escape');
  await page.getByTestId('send-quote').click();
  await role(page, 'insurer');
  await page.getByRole('button', { name: 'Ubah T&C', exact: true }).click();
  await page.getByLabel('Rate dalam persen').fill('0.14');
  await page.getByLabel('Alasan perubahan T&C').fill('Penyesuaian risiko dalam simulasi.');
  await page.getByRole('button', { name: 'Kirim counter terms', exact: true }).click();
  await role(page, 'broker');
  await page.getByRole('button', { name: 'Ubah T&C', exact: true }).click();
  await page.getByLabel('Rate dalam persen').fill('0.11');
  await page.getByLabel('Alasan perubahan T&C').fill('Negosiasi berdasarkan nihil klaim.');
  await page.getByRole('button', { name: 'Simpan usulan T&C' }).click();
  await page.getByLabel('Isi usulan amandemen', { exact: true }).fill('Perluasan biaya pemadaman sampai Rp50.000.000 (fiktif).');
  await page.getByRole('button', { name: 'Ajukan amandemen', exact: true }).click();
  await page.getByTestId('send-quote').click();
  await role(page, 'insurer');
  await page.getByLabel('Catatan tanggapan asuransi').fill('Diterima untuk contoh renewal ini.');
  await page.getByRole('button', { name: 'Terima amandemen', exact: true }).click();
  await role(page, 'broker');
  await page.getByTestId('send-quote').click();
  await role(page, 'insurer');
  await page.getByTestId('insurer-agree').click();
  await role(page, 'broker');
  await stage(page, 'Proposal klien');
  await page.getByTestId('send-proposal').click();
  await expect(page.locator('#client-name-bekasi')).toHaveCount(0);
  await role(page, 'client');
  await page.getByTestId('sample-response').click();
  await page.getByTestId('client-submit').click();
  expect((await saved(page)).insurerAgreement).toBeNull();
  await role(page, 'broker');
  await stage(page, 'Rekonsiliasi data');
  await page.getByTestId('match-bekasi').click();
  await page.getByTestId('match-tangerang').click();
  await expect(page.getByTestId('match-cikarang')).toBeDisabled();
  const cikarang = page.locator('#location-cikarang');
  await expect(cikarang).toContainText('1.500.000.000');
  await expect(cikarang).toContainText('1.800.000.000');
  await cikarang.getByRole('button', { name: 'Minta klarifikasi' }).click();
  await cikarang.getByLabel('Rincian yang perlu diklarifikasi').fill('Pastikan alamat Cikarang Baru dan apakah depot lama yang berganti nama.');
  await cikarang.getByRole('button', { name: 'Kirim permintaan klarifikasi' }).click();
  await stage(page, 'Final review');
  await expect(page.getByTestId('export-docx')).toBeDisabled();
  await role(page, 'client');
  await page.getByTestId('sample-clarification').click();
  await page.getByTestId('client-submit').click();
  await role(page, 'broker');
  await stage(page, 'Rekonsiliasi data');
  await page.getByTestId('match-cikarang').click();
  expect((await saved(page)).locations.every(location => location.review === 'matched')).toBe(true);
  await stage(page, 'Review asuransi');
  await page.getByTestId('send-quote').click();
  await role(page, 'insurer');
  await page.getByTestId('insurer-agree').click();
  await role(page, 'broker');
  await stage(page, 'Proposal klien');
  await page.getByTestId('send-proposal').click();
  await stage(page, 'Final review');
  for (const key of ['identity', 'period', 'rate', 'deductible', 'clauses']) await page.getByTestId(`check-${key}`).check();
  const wordDownload = page.waitForEvent('download');
  await page.getByTestId('export-docx').click();
  const word = await wordDownload;
  expect(word.suggestedFilename()).toMatch(/draft-renewal\.docx$/);
  expect((await readFile((await word.path())!)).length).toBeGreaterThan(1000);
  await expect(page.getByTestId('request-binding')).toBeDisabled();
  await role(page, 'client');
  await page.getByTestId('client-agree').click();
  await role(page, 'broker');
  await page.getByTestId('request-binding').click();
  await role(page, 'insurer');
  await page.getByTestId('acknowledge-binding').click();
  const completed = await saved(page);
  expect(completed.bindingAcknowledgment?.revision).toBe(completed.revision);
  expect(completed.terms.rateBps).toBe(11);
  await page.getByLabel('Hal yang mudah, membingungkan, atau perlu diubah').fill('Cikarang perlu sumber yang jelas; alur dapat diselesaikan.');
  const summaryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Unduh ringkasan sesi', exact: true }).click();
  const summary = await summaryDownload;
  const text = await readFile((await summary.path())!, 'utf8');
  expect(text).toContain('Cikarang perlu sumber yang jelas');
  expect(text).toContain('Penghambat binding');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.cache/qa/binding-desktop.png', fullPage: true });
  await page.reload();
  expect((await saved(page)).bindingAcknowledgment).toEqual(completed.bindingAcknowledgment);
  await page.getByRole('button', { name: 'Ulangi tur', exact: true }).first().click();
  await page.getByRole('button', { name: 'Lewati tur' }).click();
  expect((await saved(page)).revision).toBe(completed.revision);
  expect(browserErrors).toEqual([]);
});

test('saved state recovery and reset preserve the old payload until confirmed', async ({ page }) => {
  await seed(page);
  await page.addInitScript(key => { if (!localStorage.getItem(key)) localStorage.setItem(key, '{broken'); }, CASE_STORAGE_KEY);
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Data lama belum ditimpa');
  await page.getByTestId('send-quote').click();
  expect(await page.evaluate(key => localStorage.getItem(key), CASE_STORAGE_KEY)).toBe('{broken');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Unduh cadangan data lama' }).click();
  const backup = await backupDownload;
  expect(await readFile((await backup.path())!, 'utf8')).toBe('{broken');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByTestId('reset-case').click();
  expect(await page.evaluate(key => localStorage.getItem(key), CASE_STORAGE_KEY)).toBe('{broken');
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('reset-case').click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await saved(page)).revision).toBe(1);
  await page.reload();
  await expect(page.locator('.tour-dialog')).not.toBeVisible();
});

test('quota and download errors remain visible while memory-only work can continue', async ({ page }) => {
  await seed(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) {
      if (key === 'ruang-renewal.case.v1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    URL.createObjectURL = () => { throw new Error('Download blocked'); };
  });
  await page.goto('/');
  await page.getByTestId('send-quote').click();
  await expect(page.getByRole('alert')).toContainText('Progres belum berhasil disimpan');
  await expect(page.getByRole('heading', { name: 'Review asuransi', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ringkasan sesi', exact: true }).first().click();
  await expect(page.getByRole('alert').last()).toContainText('Unduhan tidak dapat dimulai');
});

test('desktop, tablet, and phone views keep long comparison data inside the viewport', async ({ page }) => {
  const partial = partialResponseCase();
  partial.locations[2].proposed!.name = `Cikarang Baru ${'A'.repeat(140)}`;
  partial.locations[2].confirmation!.source += ` Referensi-${'B'.repeat(160)}`;
  await seed(page, partial);
  await page.goto('/');
  const sizes = [[1440, 900], [1366, 768], [1024, 768], [820, 1180], [768, 1024], [390, 844], [320, 844]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const label of ['Bahan renewal', 'Review asuransi', 'Rekonsiliasi data']) {
      await stage(page, label);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${label} at ${width}px`).toBeLessThanOrEqual(1);
      if (label === 'Rekonsiliasi data') {
        const clipped = await page.locator('.location-version p, .location-evidence p').evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).length);
        expect(clipped, `Readable client text at ${width}px`).toBe(0);
      }
    }
    if ([1440, 390].includes(width)) await page.screenshot({ path: `.cache/qa/reconciliation-${width}.png`, fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await role(page, 'client');
  await expect(page.getByTestId('client-submit')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('Word generation and direct download errors do not clear readiness', async ({ page }) => {
  await seed(page, exportReadyCase());
  await page.addInitScript(() => { URL.createObjectURL = () => { throw new Error('Download denied'); }; });
  await page.goto('/');
  await stage(page, 'Final review');
  await expect(page.getByTestId('export-docx')).toBeEnabled();
  await page.getByTestId('export-docx').click();
  await expect(page.getByRole('alert')).toContainText('Unduhan tidak dapat dimulai');
  await expect(page.getByTestId('export-docx')).toBeEnabled();
  expect((await saved(page)).bindingRequest).toBeNull();
});

test('unsent client changes block approval and survive tour or canceled navigation', async ({ page }) => {
  await seed(page, exportReadyCase());
  await page.goto('/');
  await role(page, 'client');
  await expect(page.getByTestId('client-agree')).toBeEnabled();
  await page.locator('#client-value-bekasi').fill('4300000000');
  await expect(page.getByTestId('client-agree')).toBeDisabled();
  await expect(page.getByText('Kirim tanggapan klien, simpan perubahan T&C, atau ajukan amandemen terlebih dahulu agar perubahan masuk ke proposal.')).toBeVisible();
  await page.getByRole('button', { name: 'Ulangi tur', exact: true }).first().click();
  await page.getByRole('button', { name: 'Lanjut', exact: true }).click();
  await page.getByRole('button', { name: 'Lewati tur' }).click();
  await expect(page.locator('#client-value-bekasi')).toHaveValue('4300000000');
  page.once('dialog', dialog => dialog.dismiss());
  await stage(page, 'Rekonsiliasi data');
  await expect(page.locator('#client-value-bekasi')).toHaveValue('4300000000');
  await page.locator('#client-value-bekasi').fill('4200000000');
  await expect(page.getByTestId('client-agree')).toBeEnabled();
  await page.getByText('Ajukan perubahan T&C sebagai klien', { exact: true }).click();
  await page.getByRole('button', { name: 'Ubah T&C', exact: true }).click();
  await page.getByLabel('Rate dalam persen').fill('0.11');
  await expect(page.getByTestId('client-agree')).toBeDisabled();
  await page.locator('#client-value-bekasi').fill('4300000000');
  await page.getByLabel('Alasan perubahan T&C').fill('Usulan yang belum dikirim.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Simpan usulan T&C' }).click();
  expect((await saved(page)).terms.rateBps).toBe(12);
  await expect(page.locator('#client-value-bekasi')).toHaveValue('4300000000');
  await expect(page.getByLabel('Rate dalam persen')).toHaveValue('0.11');
  await page.getByRole('button', { name: 'Batalkan perubahan', exact: true }).click();
  await page.getByLabel('Isi usulan amandemen', { exact: true }).fill('Usulan yang belum dikirim.');
  await expect(page.getByTestId('client-agree')).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Ajukan amandemen', exact: true }).click();
  expect((await saved(page)).amendments).toHaveLength(0);
  await expect(page.locator('#client-value-bekasi')).toHaveValue('4300000000');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Ajukan amandemen', exact: true }).click();
  expect((await saved(page)).amendments).toHaveLength(1);
  await expect(page.locator('#client-value-bekasi')).toHaveValue('4200000000');
});

test('keyboard skip link, source dialogs, and stage navigation retain useful focus', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Langsung ke workspace' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  const sourceButton = page.getByRole('button', { name: 'Lihat dokumen', exact: true }).first();
  await sourceButton.click();
  await expect(page.getByRole('button', { name: 'Tutup dokumen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sourceButton).toBeFocused();
  await stage(page, 'Rekonsiliasi data');
  await expect(page.getByRole('heading', { name: 'PT Arunika Manufaktur Indonesia', exact: true })).toBeFocused();
  await expect(page.getByLabel('Peran simulasi')).toBeVisible();
});

test('broker terms drafts are protected when another form is submitted', async ({ page }) => {
  await seed(page, exportReadyCase());
  await page.goto('/');
  await stage(page, 'Review asuransi');
  await page.getByRole('button', { name: 'Ubah T&C', exact: true }).click();
  await page.getByLabel('Rate dalam persen').fill('0.11');
  await page.getByLabel('Alasan perubahan T&C').fill('Draft negosiasi belum dikirim.');
  await page.getByLabel('Isi usulan amandemen', { exact: true }).fill('Draft amandemen lain.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Ajukan amandemen', exact: true }).click();
  expect((await saved(page)).amendments).toHaveLength(0);
  await expect(page.getByLabel('Rate dalam persen')).toHaveValue('0.11');
  expect((await saved(page)).terms.rateBps).toBe(12);
});
