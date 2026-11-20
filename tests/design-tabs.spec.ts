import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { clientView } from '../supabase/functions/_shared/api-contract.ts';
import { proposalReadyCase } from './fixtures.ts';

async function accountTrigger(page: Page) {
  const trigger = page.locator('[data-testid="account-menu-trigger"]:visible');
  if (!await trigger.count()) await page.locator('details:has([data-testid="account-menu-trigger"]) > summary').first().click();
  await expect(trigger).toBeVisible();
  return trigger;
}

// Presentation fixtures never create hosted users, mutate cases or call an AI provider.
async function account(page: Page, role: 'broker' | 'client', email = 'qa@example.invalid') {
  const state = proposalReadyCase();
  const user = { id: 'presentation-' + role, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-19T00:00:00Z' };
  const writes: string[] = [];
  await page.route('**/auth/v1/token**', route => route.fulfill({ json: { access_token: 'test-session', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } }));
  await page.route('**/auth/v1/logout**', route => route.fulfill({ status: 204 }));
  await page.route('**/functions/v1/renewal-api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/renewal-api/')[1];
    if (request.method() !== 'GET') writes.push(path);
    if (path === 'cases') return route.fulfill({ json: { cases: [{ caseId: state.id, clientName: state.clientName, role, lockVersion: state.lockVersion }] } });
    if (path === 'case-setup') return route.fulfill({ json: { workspaces: role === 'broker' ? [{ workspaceId: 'qa', name: 'QA brokerage', clients: [] }] : [] } });
    if (path.endsWith('/assignments')) return route.fulfill({ json: { workspaceId: 'qa', lockVersion: state.lockVersion, clients: [], clientUserIds: [] } });
    if (path.endsWith('/ai')) return route.fulfill({ json: { batches: [], budget: { attemptsToday: 0, limit: 40, inFlightUntil: null } } });
    return route.fulfill({ json: role === 'broker' ? { role, state } : { role, ...clientView(state, user.id) } });
  });
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Open case →' }).click();
  await expect(page.getByRole('heading', { name: state.clientName, exact: true })).toBeVisible();
  return { state, writes };
}

test('broker sections preserve drafts and locale, with keyboard tab navigation', async ({ page }) => {
  const { writes } = await account(page, 'broker');
  const sources = page.getByTestId('section-tab-sources');
  await sources.click();
  await page.getByText('Record a new fictional source version', { exact: true }).click();
  const draft = page.locator('#doc-name');
  await draft.fill('Unsent source wording — keep verbatim');
  await page.getByTestId('section-tab-wording').click();
  await expect(draft).toHaveValue('Unsent source wording — keep verbatim');
  await expect(draft).not.toBeVisible();
  await page.getByTestId('locale-id').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  await page.getByTestId('section-tab-sources').click();
  await expect(draft).toBeVisible();
  await expect(draft).toHaveValue('Unsent source wording — keep verbatim');
  await sources.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('section-tab-qs')).toBeFocused();
  await expect(page.getByTestId('section-tab-qs')).toHaveAttribute('aria-selected', 'true');
  expect(await page.getByTestId('section-tab-qs').evaluate(element => element.getBoundingClientRect().top >= document.querySelector('.topbar')!.getBoundingClientRect().bottom)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(sources).toBeFocused();
  await expect(sources).toHaveAttribute('aria-selected', 'true');
  await expect(draft).toHaveValue('Unsent source wording — keep verbatim');
  await page.keyboard.press('End');
  await expect(page.getByTestId('section-tab-access')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('section-tab-qs')).toBeFocused();
  expect(await page.getByTestId('section-tab-qs').evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.stage-link:visible').filter({ hasText: 'Review asuransi' }).click();
  await expect(page.getByTestId('section-tab-qs')).toBeVisible();
  await sources.click();
  await expect(draft).toHaveValue('Unsent source wording — keep verbatim');
  expect(writes).toEqual([]);
});

test('sticky workspace chrome and account actions stay reachable at every supported width', async ({ page }) => {
  const email = 'qa-' + 'long-account-name-'.repeat(8) + '@example.invalid';
  const { writes } = await account(page, 'broker', email);
  const trigger = await accountTrigger(page);
  const actions = page.locator('[data-testid="account-menu-actions"]:visible');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await actions.getByRole('button', { name: 'Case list', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator('.case-heading').click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.getByTestId('section-tab-wording').click();
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(async () => page.locator('.topbar').evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0);
  const sticky = await page.locator('.context-column').evaluate(element => {
    const rect = element.getBoundingClientRect(), header = document.querySelector('.topbar')!.getBoundingClientRect();
    return { top: rect.top, headerBottom: header.bottom, height: rect.height, viewport: innerHeight, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, overflowY: getComputedStyle(element).overflowY };
  });
  expect(sticky.top).toBeGreaterThanOrEqual(sticky.headerBottom);
  expect(sticky.top).toBeLessThanOrEqual(sticky.headerBottom + 32);
  expect(sticky.top + sticky.height).toBeLessThanOrEqual(sticky.viewport + 1);
  if (sticky.scrollHeight > sticky.clientHeight) expect(['auto', 'scroll']).toContain(sticky.overflowY);
  for (const width of [1440, 1024, 820, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('locale-id').click();
    await page.getByTestId('locale-en').click();
    const menu = await accountTrigger(page);
    await menu.click();
    await expect(page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
  await trigger.click();
  await actions.getByRole('button', { name: 'Case list', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Renewal cases', exact: true })).toBeVisible();
  await (await accountTrigger(page)).click();
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Rekonvia', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('client sections retain location and decision drafts without exposing broker controls', async ({ page }) => {
  const { state, writes } = await account(page, 'client');
  await expect(page.getByTestId('role-select')).toHaveCount(0);
  await expect(page.locator('.stage-link')).toHaveCount(0);
  await expect(page.getByTestId('section-tab-ai')).toHaveCount(0);
  await page.getByTestId('section-tab-locations').click();
  await page.locator('#client-name-0').fill('Lokasi dikonfirmasi klien — draft');
  await page.locator('#client-evidence-0').fill('Bukti lokasi asli — belum dikirim');
  await page.getByTestId('section-tab-decisions').click();
  await page.locator('#client-decision-evidence').fill('Instruksi asli — belum dikirim');
  await expect(page.getByTestId('client-agree')).toBeDisabled();
  await page.getByTestId('section-tab-proposal').click();
  await page.getByTestId('locale-id').click();
  await page.getByTestId('section-tab-locations').click();
  await expect(page.locator('#client-name-0')).toHaveValue('Lokasi dikonfirmasi klien — draft');
  await expect(page.locator('#client-evidence-0')).toHaveValue('Bukti lokasi asli — belum dikirim');
  await page.getByTestId('section-tab-decisions').click();
  await expect(page.locator('#client-decision-evidence')).toHaveValue('Instruksi asli — belum dikirim');
  const menu = await accountTrigger(page);
  await menu.click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Daftar kasus', exact: true }).click();
  await expect(page.getByRole('heading', { name: state.clientName, exact: true })).toBeVisible();
  await expect(page.locator('#client-decision-evidence')).toHaveValue('Instruksi asli — belum dikirim');
  await expect(menu).toBeFocused();
  await menu.click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Daftar kasus', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kasus renewal', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
