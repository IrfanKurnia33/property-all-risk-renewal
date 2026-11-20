import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CASE_STORAGE_KEY } from '../src/persistence.ts';
import { proposalReadyCase } from './fixtures.ts';

const language = (page: Page) => page.locator('.language-switcher select');
async function stage(page: Page, id: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 800) await page.locator('.mobile-stage-nav > summary').click();
  await page.locator('.stage-link:visible').filter({ hasText: id }).click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ruang-renewal.tour.v1', 'seen'));
});

test('English defaults across all broker stages; switching preserves drafts, sources and dialogs', async ({ page }) => {
  await page.goto('/');
  await expect(language(page)).toHaveValue('en_US');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByRole('heading', { name: 'Documents and source versions' })).toBeVisible();
  const source = page.locator('#out-clause-1');
  await page.locator('summary').filter({ hasText: 'Record a QS or response change' }).first().click();
  await source.fill('Unsent original wording — do not translate');
  await language(page).selectOption('id_ID');
  await expect(source).toHaveValue('Unsent original wording — do not translate');
  await expect(page.getByRole('heading', { name: 'Dokumen dan versi sumber' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  await language(page).selectOption('en_US');
  await expect(source).toHaveValue('Unsent original wording — do not translate');
  page.on('dialog', dialog => dialog.accept());
  for (const [nav, heading] of [['Insurer review', 'Panel position by insurer'], ['Client proposal', 'Active proposal'], ['Data reconciliation', 'Data reconciliation'], ['Final review', 'DFS readiness']]) {
    await stage(page, nav);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await stage(page, 'Renewal materials');
  await page.getByRole('button', { name: 'View document', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await language(page).selectOption('id_ID', { force: true });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tutup dokumen' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(language(page)).toHaveValue('id_ID');
});

test('client simulation keeps evidence and decisions separate in both languages', async ({ page }) => {
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: CASE_STORAGE_KEY, state: proposalReadyCase() });
  await page.goto('/');
  await page.getByTestId('role-select').selectOption('client');
  await expect(page.getByRole('heading', { name: 'Client decisions on the proposal' })).toBeVisible();
  const evidence = page.locator('[id^="client-evidence-"]').first();
  await evidence.fill('Konfirmasi asli dari klien');
  await language(page).selectOption('id_ID');
  await expect(evidence).toHaveValue('Konfirmasi asli dari klien');
  await expect(page.getByRole('heading', { name: 'Keputusan klien atas proposal' })).toBeVisible();
});

test('translated controls fit desktop and narrow mobile widths with visible keyboard focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Documents and source versions' })).toBeVisible();
  await page.screenshot({ path: '.cache/i18n-desktop.png' });
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ['en_US', 'id_ID']) {
      await language(page).selectOption(locale);
      await expect(language(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await language(page).evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
  }
  await language(page).focus();
  await expect(language(page)).toHaveCSS('outline-width', '3px');
  await page.screenshot({ path: '.cache/i18n-mobile.png', fullPage: false });
});

test('language preference updates an already open tab', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await language(other).selectOption('id_ID');
  await expect(language(page)).toHaveValue('id_ID');
  await expect(page.getByRole('heading', { name: 'Dokumen dan versi sumber' })).toBeVisible();
  await other.close();
});
