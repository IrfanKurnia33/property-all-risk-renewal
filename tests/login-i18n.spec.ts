import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { clientView } from '../supabase/functions/_shared/api-contract.ts';
import { proposalReadyCase } from './fixtures.ts';

const language = (page: Page, locale: 'en' | 'id') => page.getByTestId('locale-' + locale);
async function mockAccount(page: Page, role: 'broker' | 'client') {
  const state = proposalReadyCase();
  const user = { id: 'client-demo', email: 'qa@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-19T00:00:00Z' };
  await page.route('**/auth/v1/token**', route => route.fulfill({ json: { access_token: 'test-session', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } }));
  await page.route('**/auth/v1/logout**', route => route.fulfill({ status: 204 }));
  await page.route('**/functions/v1/renewal-api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/renewal-api/')[1];
    if (path === 'cases') return route.fulfill({ json: { cases: [{ caseId: state.id, clientName: state.clientName, role, lockVersion: state.lockVersion }] } });
    if (path === 'case-setup') return route.fulfill({ json: { workspaces: role === 'broker' ? [{ workspaceId: 'qa', name: 'QA brokerage', clients: [] }] : [] } });
    if (path.endsWith('/assignments')) return route.fulfill({ json: { workspaceId: 'qa', lockVersion: state.lockVersion, clients: [], clientUserIds: [] } });
    if (path.endsWith('/ai')) return route.fulfill({ json: { batches: [], budget: { attemptsToday: 0, limit: 40, inFlightUntil: null } } });
    return route.fulfill({ json: role === 'broker' ? { role, state } : { role, ...clientView(state, user.id) } });
  });
}
async function signIn(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill('qa@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Renewal cases', exact: true })).toBeVisible();
}

test('login defaults to US English, translates errors and remembers Indonesian after reload', async ({ page }) => {
  await page.route('**/auth/v1/token**', route => route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Rekonvia' })).toBeVisible();
  await expect(language(page, 'en')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Email', { exact: true }).fill('qa@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('email or password is incorrect');
  await language(page, 'id').click();
  await expect(page.getByRole('heading', { name: 'Masuk ke Rekonvia' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Email atau kata sandi');
  await page.reload();
  await expect(page.getByLabel('Kata sandi', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.cache/i18n-login.png' });
});

for (const role of ['broker', 'client'] as const) test(`${role} stays bilingual from login through case workspace and sign-out`, async ({ page }) => {
  await mockAccount(page, role);
  await page.goto('/');
  await signIn(page);
  await language(page, 'id').click();
  await expect(page.getByRole('heading', { name: 'Kasus renewal', exact: true })).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Buka kasus →' }).click();
  const draft = role === 'broker' ? page.locator('#doc-name') : page.locator('#client-name-0');
  await page.getByTestId('section-tab-' + (role === 'broker' ? 'sources' : 'locations')).click();
  if (role === 'broker') await page.getByText('Catat versi sumber fiktif baru', { exact: true }).click();
  await draft.fill('Original client data / data asli');
  await language(page, 'en').click();
  await expect(draft).toHaveValue('Original client data / data asli');
  await expect(page.getByRole('heading', { name: role === 'broker' ? 'Documents and source versions' : 'Current-period data confirmation', exact: true })).toBeVisible();
  if (role === 'broker') {
    await page.getByTestId('section-tab-ai').click();
    await page.getByText('AI assistance for renewal sources · optional', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI source assistance', exact: true })).toBeVisible();
    await language(page, 'id').click();
    await expect(page.getByRole('heading', { name: 'Bantuan AI untuk sumber', exact: true })).toBeVisible();
    await language(page, 'en').click();
  }
  await page.locator('[data-testid="account-menu-trigger"]:visible').click();
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Rekonvia' })).toBeVisible();
  await expect(language(page, 'en')).toHaveAttribute('aria-pressed', 'true');
});
