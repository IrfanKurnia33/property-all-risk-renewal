import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { createHostedFixture } from './authenticated-fixtures.ts';
import { getCurrentWording } from '../src/domain.ts';

test.use({ trace: 'off' });
test.skip(process.env.REKONVIA_RUN_HOSTED_BROWSER_TESTS !== '1', 'Explicitly enabled hosted acceptance only.');

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kasus renewal', exact: true })).toBeVisible();
}

async function stage(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 800) {
    const menu = page.locator('.mobile-stage-nav');
    if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  }
  await page.locator('.stage-link:visible').filter({ hasText: label }).click();
}

async function command(page: Page, action: () => Promise<unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(result => result.url().endsWith('/commands') && result.request().method() === 'POST'),
    action(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.locator('fieldset.main-column')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function responsive(page: Page) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal page overflow at ${width}px`).toBe(true);
    expect(await page.locator('img[alt="Rekonvia"]').evaluateAll(images => images.every(image => {
      const img = image as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    }))).toBe(true);
  }
}

async function addSource(page: Page, source: { id: string; type: 'prior-slip' | 'QS'; start: string; end: string; status: 'agreed' | 'draft'; producer: string }) {
  const form = page.locator('#add-document');
  if (!await form.isVisible()) await page.getByText('Catat versi sumber fiktif baru', { exact: true }).click();
  await form.locator('#doc-id').fill(source.id);
  await form.locator('#doc-identity').fill(source.id);
  await form.locator('#doc-name').fill('Berkas QA fiktif ' + source.id);
  await form.locator('#doc-version').fill('1');
  await form.locator('#doc-producer').fill(source.producer);
  await form.locator('#doc-type').selectOption(source.type);
  await form.locator('#doc-start').fill(source.start);
  await form.locator('#doc-end').fill(source.end);
  await form.locator('#doc-option').selectOption(source.type === 'QS' ? 'utama' : '');
  await form.locator('#doc-status').selectOption(source.status);
  await command(page, () => form.getByRole('button', { name: 'Simpan versi sumber', exact: true }).click());
}

test('brokers create an unconfirmed historical schedule, manage client access and produce a reviewed QS from real uploads', async ({ browser }) => {
  test.setTimeout(240_000);
  const fixture = await createHostedFixture();
  const contexts: BrowserContext[] = [];
  const dialogs: string[] = [];
  const caseId = 'QA-PHASE4-' + fixture.run;
  const clientName = 'PT Onboarding Baru (Fiktif)';
  const historical = [
    { name: 'Pabrik historis QA privat', address: 'Alamat historis QA satu', amount: '9007199254740991.12' },
    { name: 'Gudang historis QA privat', address: 'Alamat historis QA dua', amount: '0.89' },
  ];
  const clause = 'Property All Risks Clause — fiktif <literal> & utuh.\nBaris kedua tetap persis.';
  try {
    contexts.push(await browser.newContext(), await browser.newContext());
    const broker = await contexts[0].newPage(), secondBroker = await contexts[1].newPage();
    broker.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    let failSetup=true,failAccess=true;
    await broker.route('**/functions/v1/renewal-api/case-setup',route=>{
      if(failSetup){failSetup=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL_ERROR'}})});}
      return route.continue();
    });
    await broker.route('**/functions/v1/renewal-api/cases/*/assignments',route=>{
      if(failAccess && route.request().method()==='GET'){failAccess=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL_ERROR'}})});}
      return route.continue();
    });
    await login(broker, fixture.accounts[0]);
    await broker.getByRole('button',{name:'Muat ulang formulir kasus',exact:true}).click();
    await broker.getByText('Buat kasus renewal fiktif', { exact: true }).click();
    const creation = broker.locator('#create-case');
    await creation.locator('#case-id').fill(caseId);
    await creation.locator('#case-client-name').fill(clientName);
    await creation.locator('#case-period-start').fill('2028-01-01');
    await creation.locator('#case-period-end').fill('2028-12-31');
    await creation.locator('#case-prior-start').fill('2027-01-01');
    await creation.locator('#case-prior-end').fill('2027-12-31');
    await creation.getByRole('button', { name: 'Tambah lokasi historis', exact: true }).click();
    for (const [index, location] of historical.entries()) {
      await creation.getByLabel('Nama lokasi historis ' + (index + 1), { exact: true }).fill(location.name);
      await creation.getByLabel('Alamat historis ' + (index + 1), { exact: true }).fill(location.address);
      await creation.getByLabel(`Sum insured historis ${index + 1} (IDR, desimal titik)`, { exact: true }).fill(location.amount);
    }
    await creation.getByRole('checkbox', { name: fixture.accounts[2].email, exact: true }).check();
    await broker.getByRole('button').filter({hasText:fixture.caseA}).click();
    expect(dialogs).toEqual(['Buang isian kasus baru yang belum disimpan?']);
    await expect(creation.locator('#case-id')).toHaveValue(caseId);
    dialogs.length=0;
    await responsive(broker);
    const [created] = await Promise.all([
      broker.waitForResponse(response => response.url().endsWith('/cases') && response.request().method() === 'POST'),
      creation.getByRole('button', { name: 'Buat kasus', exact: true }).click(),
    ]);
    expect(created.status()).toBe(200);
    await expect(broker.getByRole('heading', { name: clientName, exact: true })).toBeVisible();
    await expect(broker.getByTestId('send-quote')).toBeDisabled();
    await expect(broker.getByTestId('export-qs')).toBeDisabled();
    await expect(broker.getByText('Wording QS dan sumbernya belum diidentifikasi.', { exact: false }).first()).toBeVisible();
    await responsive(broker);
    const initial = await fixture.read(caseId);
    expect(initial.documents).toEqual([]);
    expect(getCurrentWording(initial).items).toEqual([]);
    expect(initial.terms.premiumLines[0].basis.amount).toBe('9007199254740992.01');
    expect(initial.priorTerms.periodStart).toBe('2027-01-01');
    expect(initial.priorTerms.periodEnd).toBe('2027-12-31');
    expect(initial.locations.map(location => location.prior.sumInsured.amount)).toEqual(historical.map(location => location.amount));
    expect(initial.locations.every(location => location.proposed === null && location.confirmation === null && location.review === 'unreviewed')).toBe(true);
    expect([initial.proposals, initial.quoteSnapshots, initial.submissions, initial.agreements, initial.instructions]).toEqual([[], [], [], [], []]);

    const unpublishedResponse = await fixture.api(2, caseId);
    expect(unpublishedResponse.status).toBe(200);
    const unpublished = await unpublishedResponse.json();
    expect(unpublished.proposal).toBeNull();
    expect(unpublished.currentLocations).toEqual([]);
    expect(JSON.stringify(unpublished)).not.toContain(historical[0].address);
    expect((await fixture.api(3, caseId)).status).toBe(404);

    await broker.getByRole('button',{name:'Muat ulang akses klien',exact:true}).click();
    const access = broker.locator('#case-assignments');
    await expect(access.getByRole('checkbox', { name: fixture.accounts[2].email, exact: true })).toBeChecked();
    await access.getByRole('checkbox', { name: fixture.accounts[3].email, exact: true }).check();
    const [assigned] = await Promise.all([
      broker.waitForResponse(response => response.url().endsWith('/assignments') && response.request().method() === 'POST'),
      access.getByRole('button', { name: 'Simpan akses klien', exact: true }).click(),
    ]);
    expect(assigned.status()).toBe(200);
    await expect(access.getByRole('button', { name: 'Simpan akses klien', exact: true })).toBeDisabled();
    expect((await fixture.api(3, caseId)).status).toBe(200);
    await access.getByRole('checkbox', { name: fixture.accounts[3].email, exact: true }).uncheck();
    const [unassigned] = await Promise.all([
      broker.waitForResponse(response => response.url().endsWith('/assignments') && response.request().method() === 'POST'),
      access.getByRole('button', { name: 'Simpan akses klien', exact: true }).click(),
    ]);
    expect(unassigned.status()).toBe(200);
    await expect(access.getByRole('button', { name: 'Simpan akses klien', exact: true })).toBeDisabled();
    expect((await fixture.api(3, caseId)).status).toBe(404);
    await stage(broker, 'Review asuransi');
    await expect(broker.getByRole('heading', { name: 'Review asuransi', exact: true })).toBeVisible();
    expect(dialogs).toEqual([]);
    await stage(broker, 'Bahan renewal');

    await login(secondBroker, fixture.accounts[1]);
    await secondBroker.getByRole('button').filter({ hasText: caseId }).click();
    await expect(secondBroker.getByRole('heading', { name: clientName, exact: true })).toBeVisible();
    await expect(secondBroker.getByTestId('send-quote')).toBeDisabled();

    const sources = [
      { id: 'phase4-prior', type: 'prior-slip' as const, start: '2027-01-01', end: '2027-12-31', status: 'agreed' as const, producer: 'Asuransi QA Historis (Fiktif)' },
      { id: 'phase4-qs', type: 'QS' as const, start: '2028-01-01', end: '2028-12-31', status: 'draft' as const, producer: 'Broker QA (Fiktif)' },
    ];
    for (const source of sources) {
      await addSource(broker, source);
      const upload = broker.locator('#upload-' + source.id);
      await upload.locator('input[type=file]').setInputFiles({ name: source.id + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nSynthetic fictional QA source.\n' + clause + '\n%%EOF') });
      await upload.getByRole('button', { name: 'Unggah dan finalisasi', exact: true }).click();
      await expect(upload).toHaveCount(0);
      await expect(broker.locator('fieldset.main-column')).toBeEnabled();
    }
    await broker.getByText('Tambah klausul dari baseline disepakati', { exact: true }).click();
    const baseline = broker.locator('#add-baseline-clause');
    await baseline.locator('#baseline-title').fill('Klausul baseline QA');
    await baseline.locator('#baseline-prior').fill(clause);
    await baseline.locator('#baseline-prior-source').selectOption('phase4-prior');
    await baseline.locator('#baseline-outgoing').fill(clause);
    await baseline.locator('#baseline-qs-source').selectOption('phase4-qs');
    await baseline.locator('#baseline-note').fill('Sumber historis disalin persis; QS mempertahankan wording.');
    await command(broker, () => baseline.getByRole('button', { name: 'Simpan klausul baseline baru', exact: true }).click());
    const item = getCurrentWording(await fixture.read(caseId)).items[0];
    expect(item.prior).toBe(clause);
    expect(item.outgoing).toBe(clause);
    const review = broker.locator('#review-' + item.id);
    await review.getByLabel('Catatan review wording', { exact: true }).fill('Wording dan kedua versi sumber QA diperiksa manual.');
    await command(broker, () => review.getByRole('button', { name: 'Simpan review wording', exact: true }).click());
    await expect(broker.getByTestId('send-quote')).toBeEnabled();
    await command(broker, () => broker.getByTestId('send-quote').click());
    await expect(broker.getByTestId('export-qs')).toBeEnabled();
    const [download] = await Promise.all([broker.waitForEvent('download'), broker.getByTestId('export-qs').click()]);
    const path = await download.path();
    expect(path).not.toBeNull();
    const files = unzipSync(new Uint8Array(await readFile(path!)));
    expect(files['[Content_Types].xml']).toBeTruthy();
    const xml = strFromU8(files['word/document.xml']);
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>/g)].map(match => match[1] === undefined ? '\n' : match[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join('');
    expect(text).toContain(caseId);
    expect(text).toContain('QS PROPERTY ALL RISKS');
    expect(text).toContain('IDR 9.007.199.254.740.992,01');
    expect(text).toContain(clause);
    expect(text).toContain('Historis / belum dikonfirmasi klien');
    for (const source of sources) expect(text).toContain(source.id);
    const prepared = await fixture.read(caseId);
    expect(prepared.quoteSnapshots).toHaveLength(1);
    expect(prepared.documents.every(document => !!document.file)).toBe(true);
    expect(prepared.locations.every(location => location.confirmation === null && location.proposed === null)).toBe(true);
    expect(dialogs).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await fixture.cleanup();
  }
});
