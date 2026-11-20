import { test, expect } from '@playwright/test';

// Existing workflow assertions exercise the Indonesian locale explicitly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rekonvia.locale.v1', 'id_ID'));
});
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CASE_STORAGE_KEY, LEGACY_CASE_STORAGE_KEY } from '../src/persistence.ts';
import type { RenewalCase, Role } from '../src/domain.ts';
import { exportReadyCase, partialResponseCase, proposalReadyCase, quoteReadyCase } from './fixtures.ts';

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
const section = (page: Page, id: string) => page.getByTestId('section-tab-' + id).click();
async function role(page: Page, value: Role) {
  if ((page.viewportSize()?.width ?? 1440) <= 800) {
    const menu = page.locator('.mobile-stage-nav');
    if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  }
  await page.locator('.role-select:visible').selectOption(value);
}
const saved = (page: Page): Promise<RenewalCase> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), CASE_STORAGE_KEY);

async function addInsurerSource(page: Page, type: 'insurer-reply' | 'binding-evidence', id: string, producer: string) {
  await stage(page, 'Bahan renewal');
  await section(page, 'sources');
  const summary = page.getByText('Catat versi sumber fiktif baru', { exact: true });
  const form = page.locator('#add-document');
  if (!await form.isVisible()) await summary.click();
  await form.locator('#doc-id').fill(id);
  await form.locator('#doc-identity').fill(id);
  await form.locator('#doc-name').fill('Email fiktif ' + id);
  await form.locator('#doc-producer').fill(producer);
  await form.locator('#doc-type').selectOption(type);
  await form.getByRole('button', { name: 'Simpan versi sumber', exact: true }).click();
}

async function insurerResponse(page: Page, id: string, name: string, share: string, source: string, leader = false) {
  await stage(page, 'Review asuransi');
  await section(page, 'response');
  const form = page.locator('#record-response');
  await form.locator('#insurer-id').fill(id);
  await form.locator('#insurer-name').fill(name);
  await form.locator('#external-respondent').fill('Underwriter fiktif ' + id);
  await form.locator('#response-share').fill(share);
  await form.locator('#response-source').selectOption(source);
  await form.locator('#response-evidence').fill('Menyetujui wording dan terms QS pada share ' + share + '% (fiktif).');
  await form.locator('input[name="response-leader"]').setChecked(leader);
  await page.getByTestId('record-response').click();
}

async function reviewWording(page: Page) {
  await section(page, 'wording');
  for (let i = 1; i <= 4; i++) {
    const form = page.locator('#review-clause-' + i);
    await form.getByLabel('Catatan review wording').fill('Baseline dan QS sama, sumber fiktif diperiksa.');
    await form.getByRole('button', { name: 'Simpan review wording', exact: true }).click();
  }
}

test('first visit tour remains keyboard accessible and does not write case evidence', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Satu kasus, dari quotation sampai binding' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#tour-title')).toBeFocused();
  await page.getByRole('button', { name: 'Lanjut', exact: true }).click();
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

test('manual wording review enables an early QS with exact rates and unconfirmed historical risk', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#role-select option[value="insurer"]')).toHaveCount(0);
  await expect(page.locator('#role-select option[value="client"]')).toBeDisabled();
  await expect(page.getByTestId('send-quote')).toBeDisabled();
  await reviewWording(page);
  await section(page, 'qs');
  await page.getByTestId('send-quote').click();
  const state = await saved(page);
  expect(state.quoteSnapshots).toHaveLength(1);
  expect(state.locations.every(location => location.confirmation === null)).toBe(true);
  expect(state.quoteSnapshots[0].locations.every(location => !location.currentConfirmed)).toBe(true);
  expect(state.terms.premiumLines[0].rate.value).toBe('0.0483');
  await stage(page, 'Review asuransi');
  await section(page, 'terms');
  await expect(page.getByText('0,0483%', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('IDR 3.381.000,00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('IDR 3.400.000,00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Tidak dihitung: cover dikecualikan', { exact: true })).toBeVisible();
  await stage(page, 'Bahan renewal');
  await section(page, 'qs');
  const download = page.waitForEvent('download');
  await page.getByTestId('export-qs').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.docx$/);
  expect((await readFile((await file.path())!)).length).toBeGreaterThan(1000);
});

test('a two-insurer panel completes the manual client, DFS and per-member binding journey', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await seed(page, quoteReadyCase());
  await page.goto('/');
  await insurerResponse(page, 'insurer-a', 'Asuransi Fiktif A', '60', 'reply-utama', true);
  await stage(page, 'Proposal klien');
  await expect(page.getByTestId('publish-proposal')).toBeDisabled();
  await addInsurerSource(page, 'insurer-reply', 'reply-b', 'Asuransi Fiktif B');
  await addInsurerSource(page, 'binding-evidence', 'binding-b', 'Asuransi Fiktif B');
  await insurerResponse(page, 'insurer-b', 'Asuransi Fiktif B', '40', 'reply-b');
  await stage(page, 'Proposal klien');
  await page.getByTestId('publish-proposal').click();
  await role(page, 'client');
  await page.getByRole('button', { name: 'Isi contoh: semua data tetap', exact: true }).click();
  await page.getByTestId('submit-client-locations').click();
  await page.getByLabel('Bukti keputusan / instruksi klien').fill('Saya setuju proposal terbaru ini (fiktif).');
  await page.getByTestId('client-agree').click();
  await page.getByLabel('Bukti keputusan / instruksi klien').fill('Saya menginstruksikan renewal sesuai proposal ini (fiktif).');
  await page.getByTestId('client-instruct').click();
  await role(page, 'broker');
  await stage(page, 'Rekonsiliasi data');
  for (const id of ['bekasi', 'tangerang', 'cikarang']) {
    await section(page, 'location-' + id);
    await page.locator('#match-note-' + id).fill('Cocok dengan konfirmasi klien yang tercatat.');
    await page.getByTestId('match-' + id).click();
  }
  await stage(page, 'Final review');
  for (const key of ['identity', 'period', 'rate', 'deductible', 'clauses']) await page.getByTestId('check-' + key).check();
  await page.getByTestId('issue-dfs').click();
  const wordDownload = page.waitForEvent('download');
  await page.getByTestId('export-word').click();
  const word = await wordDownload;
  expect((await readFile((await word.path())!)).length).toBeGreaterThan(1000);
  expect((await saved(page)).dfsSnapshots).toHaveLength(1);
  await section(page, 'binding');
  await page.locator('#dispatch-reference').fill('FIKTIF-DISPATCH-PANEL-01');
  await page.locator('#dispatch-recipient').fill('panel@example.invalid');
  await page.locator('#dispatch-time').fill('2026-11-19T11:00');
  await page.getByTestId('request-binding').click();
  const acknowledge = async (id: string, source: string) => {
    await page.locator('#ack-insurer').selectOption(id);
    await page.locator('#ack-respondent').fill('Underwriter binding fiktif ' + id);
    await page.locator('#ack-source').selectOption(source);
    await page.locator('#ack-evidence').fill('Acknowledged pengiriman binding-1 / dfs-1, opsi utama (fiktif).');
    await page.getByTestId('acknowledge-binding').click();
  };
  await acknowledge('insurer-a', 'binding-utama');
  await expect(page.getByText('Menunggu acknowledgment setiap anggota', { exact: true }).first()).toBeVisible();
  await acknowledge('insurer-b', 'binding-b');
  const completed = await saved(page);
  expect(completed.bindingRequests).toHaveLength(1);
  expect(completed.bindingAcknowledgments).toHaveLength(2);
  expect(completed.bindingAcknowledgments.every(item => item.recordedBy === 'broker-demo')).toBe(true);
  expect(new Set(completed.bindingAcknowledgments.map(item => item.insurerId)).size).toBe(2);
  await page.reload();
  expect((await saved(page)).bindingAcknowledgments).toEqual(completed.bindingAcknowledgments);
  expect(errors).toEqual([]);
});

for (const kind of ['corrupt', 'legacy'] as const) test(`${kind} storage is preserved byte-for-byte until a confirmed new-case reset`, async ({ page }) => {
  const key = kind === 'legacy' ? LEGACY_CASE_STORAGE_KEY : CASE_STORAGE_KEY;
  const raw = kind === 'legacy' ? '{ "schemaVersion": 1, "notes": "old notes" }' : '{broken';
  await seed(page);
  await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key, raw });
  await page.goto('/');
  await expect(page.getByRole('alert').first()).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Unduh cadangan data lama' }).click();
  const backup = await backupDownload;
  expect(await readFile((await backup.path())!, 'utf8')).toBe(raw);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByTestId('reset-case').click();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('reset-case').click();
  expect((await saved(page)).schemaVersion).toBe(2);
  expect((await saved(page)).revision).toBe(1);
  if (kind === 'legacy') expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  await page.reload();
  await expect(page.locator('.tour-dialog')).not.toBeVisible();
});

test('incomplete client evidence exposes DFS blockers and comparison data remains usable at six widths', async ({ page }) => {
  const state = partialResponseCase();
  state.locations[2].proposed!.name += ' ' + 'A'.repeat(140);
  state.submissions.at(-1)!.locations[2].name = state.locations[2].proposed!.name;
  await seed(page, state);
  await page.goto('/');
  await stage(page, 'Final review');
  await expect(page.getByTestId('issue-dfs')).toBeDisabled();
  for (const [width, height] of [[1440, 900], [1024, 768], [820, 1180], [768, 1024], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    for (const label of ['Bahan renewal', 'Review asuransi', 'Proposal klien', 'Rekonsiliasi data', 'Final review']) {
      await stage(page, label);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${label} at ${width}px`).toBeLessThanOrEqual(1);
      if (label === 'Rekonsiliasi data') for (const location of state.locations) {
        await section(page, 'location-' + location.id);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${location.id} at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
    if ([1440, 390, 320].includes(width)) {
      await stage(page, 'Rekonsiliasi data');
      await page.screenshot({ path: `.cache/qa/phase2-reconciliation-${width}.png`, fullPage: true });
    }
  }
});

test('source dialogs and keyboard navigation retain focus without recording decisions', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Langsung ke workspace' })).toBeAttached();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Langsung ke workspace' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await section(page, 'sources');
  const sourceButton = page.getByRole('button', { name: 'Lihat dokumen', exact: true }).first();
  await sourceButton.click();
  const source = page.getByRole('dialog', { name: 'Final slip 2026' });
  await expect(source).toContainText('Automatic Reinstatement');
  await page.keyboard.press('Escape');
  await expect(sourceButton).toBeFocused();
  await stage(page, 'Rekonsiliasi data');
  expect(await page.evaluate(key => localStorage.getItem(key), CASE_STORAGE_KEY)).toBeNull();
});

test('unsent client values disable agreement and role changes reset drafts only after confirmation', async ({ page }) => {
  await seed(page, proposalReadyCase());
  await page.goto('/');
  await role(page, 'client');
  const amount = page.locator('#client-value-bekasi');
  await amount.fill('4300000000.12');
  await expect(page.getByTestId('client-agree')).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss());
  await role(page, 'broker');
  await expect(page.locator('.role-select:visible')).toHaveValue('client');
  await expect(amount).toHaveValue('4300000000.12');
  page.once('dialog', dialog => dialog.accept());
  await role(page, 'broker');
  await role(page, 'client');
  await expect(amount).toHaveValue('3500000000');
  expect((await saved(page)).locations[0].proposed).toBeNull();
});

test('client clarification continues against the published proposal while stale consent stays blocked', async ({ page }) => {
  const initial = partialResponseCase();
  const original = structuredClone(initial.locations[2].proposed!);
  await seed(page, initial);
  await page.goto('/');
  await role(page, 'client');
  await expect(page.getByTestId('submit-client-locations')).toBeEnabled();
  await page.locator('#client-address-cikarang').fill(initial.locations[2].prior.address);
  await page.locator('#client-evidence-cikarang').fill('Klien mengklarifikasi alamat Cikarang melalui email fiktif.');
  await page.locator('#client-locations fieldset').nth(2).getByRole('checkbox').check();
  await page.getByTestId('submit-client-locations').click();
  const updated = await saved(page);
  expect(updated.locations[2].proposed).toEqual({ ...original, address: initial.locations[2].prior.address });
  expect(updated.locations[2].confirmation?.confirmed).toBe(true);
  expect(updated.locations[2].confirmation?.source).toContain('mengklarifikasi alamat Cikarang');
  expect(updated.locations.slice(0, 2).map(location => location.proposed)).toEqual(initial.locations.slice(0, 2).map(location => location.proposed));
  expect(updated.revision).toBe(initial.revision + 1);
  expect(updated.proposals).toEqual(initial.proposals);
  expect(updated.activeProposalId).toBe(initial.activeProposalId);
  expect(updated.submissions).toHaveLength(initial.submissions.length + 1);
  await expect(page.getByTestId('client-agree')).toBeDisabled();
});

test('a failed Word download keeps the current DFS and reports the error', async ({ page }) => {
  await seed(page, exportReadyCase());
  await page.addInitScript(() => { URL.createObjectURL = () => { throw new Error('Download denied'); }; });
  await page.goto('/');
  await stage(page, 'Final review');
  await expect(page.getByTestId('export-word')).toBeEnabled();
  await page.getByTestId('export-word').click();
  await expect(page.getByRole('alert').last()).toContainText('Unduhan');
  await expect(page.getByTestId('export-word')).toBeEnabled();
  expect((await saved(page)).dfsSnapshots).toHaveLength(1);
  expect((await saved(page)).bindingRequests).toHaveLength(0);
});

test('quota failure on an existing saved case permits subsequent memory-only work', async ({ page }) => {
  const initial = quoteReadyCase();
  await page.addInitScript(({ key, initial }) => {
    localStorage.setItem('ruang-renewal.tour.v1', 'seen');
    localStorage.setItem(key, JSON.stringify(initial));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name: string, value: string) {
      if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, { key: CASE_STORAGE_KEY, initial });
  await page.goto('/');
  await addInsurerSource(page, 'insurer-reply', 'memory-one', 'Asuransi Fiktif B');
  await expect(page.getByRole('alert').first()).toContainText('belum berhasil disimpan');
  await addInsurerSource(page, 'binding-evidence', 'memory-two', 'Asuransi Fiktif B');
  await expect(page.getByText('10 dokumen', { exact: true })).toBeVisible();
  expect((await saved(page)).documents).toHaveLength(8);
  expect((await saved(page)).lockVersion).toBe(initial.lockVersion);
});

test('a sequential stale-tab write is rejected and retains the unsaved form', async ({ page }) => {
  await seed(page, quoteReadyCase());
  await page.goto('/');
  const other = await page.context().newPage();
  await other.goto('/');
  await addInsurerSource(other, 'insurer-reply', 'saved-in-other-tab', 'Asuransi Fiktif B');
  await addInsurerSource(page, 'insurer-reply', 'unsaved-stale-draft', 'Asuransi Fiktif B');
  await expect(page.getByRole('alert').last()).toContainText('tab lain');
  await expect(page.locator('#doc-id')).toHaveValue('unsaved-stale-draft');
  const state = await saved(page);
  expect(state.documents.some(doc => doc.id === 'saved-in-other-tab')).toBe(true);
  expect(state.documents.some(doc => doc.id === 'unsaved-stale-draft')).toBe(false);
  await other.close();
});
