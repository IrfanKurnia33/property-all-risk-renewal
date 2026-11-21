import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { clientView } from '../supabase/functions/_shared/api-contract.ts';
import { applyAction } from '../supabase/functions/_shared/domain.ts';
import type { CaseAction, RenewalCase } from '../supabase/functions/_shared/domain.ts';
import type { AiHistory, AiSourceOption } from '../supabase/functions/_shared/ai-contract.ts';
import { proposalReadyCase } from './fixtures.ts';

async function accountTrigger(page: Page) {
  const trigger = page.locator('[data-testid="account-menu-trigger"]:visible');
  if (!await trigger.count()) await page.locator('details:has([data-testid="account-menu-trigger"]) > summary').first().click();
  await expect(trigger).toBeVisible();
  return trigger;
}

// Presentation fixtures never create hosted users, mutate cases or call an AI provider.
async function account(page: Page, role: 'broker' | 'client', email = 'qa@example.invalid', superadmin = false, clauseReview = false, scheduleRequired = false, finalizedSchedule = false) {
  await page.addInitScript(() => {
    localStorage.setItem('ruang-renewal.tour.v1.broker', 'seen');
    localStorage.setItem('ruang-renewal.tour.v1.client', 'seen');
  });
  let state: RenewalCase = proposalReadyCase();
  state.scheduleRequired = scheduleRequired;
  const user = { id: 'presentation-' + role, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-19T00:00:00Z' };
  let scheduleFile: { id: string; bytes: Buffer } | undefined;
  if (finalizedSchedule) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Schedule');
    sheet.addRows([
      ['Location name', 'Address', 'Occupancy', 'Sum insured', 'Currency', 'Coverage / peril', 'Rate', 'Rate unit', 'Rate basis', 'Rate applicability', 'Deductible', 'Remarks'],
      ['Factory A', 'District road', 'Manufacturing', '3500000000', 'IDR', 'Property All Risks', 0.0483, 'percent', 'sum-insured', 'As stated in insurer quote', 'IDR 10,000,000 each occurrence', 'Verify occupancy with client'],
    ]);
    sheet.getCell('G2').numFmt = '0.00%';
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileId = '00000000-0000-4000-8000-000000000001';
    const broker = { id: user.id, role: 'broker' as const };
    state = applyAction(state, broker, { type: 'addDocument', document: {
      id: 'schedule-source-1', documentId: 'schedule-' + state.id, version: 1, name: 'Current schedule.xlsx', type: 'schedule',
      insuranceClass: 'PAR', periodStart: state.terms.periodStart, periodEnd: state.terms.periodEnd, producer: 'Broker-uploaded schedule',
      optionId: null, status: 'received', fictional: true, note: 'XLSX fixture for broker review.',
    } }, state.lockVersion, '2026-11-20T01:00:00.000Z');
    state = applyAction(state, broker, { type: 'attachEvidence', documentVersionId: 'schedule-source-1', file: {
      id: fileId, sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.byteLength,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } }, state.lockVersion, '2026-11-20T01:01:00.000Z');
    scheduleFile = { id: fileId, bytes };
  }
  const writes: string[] = [];
  let membershipChanges: unknown;
  const prior=(documentVersionId:string,version:number,name:string):AiSourceOption=>({sourceType:'case',documentVersionId,version,name,mimeType:'application/pdf',byteSize:100,sha256:'a'.repeat(64),documentType:'prior-slip',status:'agreed',periodStart:'2025-01-01',periodEnd:'2025-12-31',createdAt:'2025-01-01T00:00:00Z'});
  const standard=(documentVersionId:string,version:number):AiSourceOption=>({sourceType:'workspace-standard-terms',documentVersionId,version,name:'Brokerage Standard T&C',mimeType:'application/pdf',byteSize:100,sha256:'b'.repeat(64),status:'finalized',createdAt:'2025-01-01T00:00:00Z'});
  const priorVersions=[prior('prior-v1',1,'Final Slip v1'),prior('prior-v2',2,'Final Slip v2')];
  const termsVersions=[standard('terms-v3',3),standard('terms-v2',2)];
  const aiHistory:AiHistory={
    batches:clauseReview?[{
      id:'qa-clause-batch',purpose:'clause-review',sections:[
        {id:'prior-section',documentVersionId:'prior-v2',sourceType:'case',sha256:'a'.repeat(64),locator:'Halaman 2',kind:'text',text:'FIKTIF: wording dasar.'},
        {id:'terms-section',documentVersionId:'terms-v3',sourceType:'workspace-standard-terms',sha256:'b'.repeat(64),locator:'Klausul 4',kind:'text',text:'FIKTIF: wording standar.'},
      ],unprocessedCount:0,createdAt:'2026-11-20T00:00:00Z',steps:[{
        index:0,sectionIds:['prior-section','terms-section'],status:'completed',result:{
          summary:'Tinjau perbedaan yang didukung kutipan.',findings:[{kind:'difference',category:'modified',title:'Klausul berubah',
            detail:'Kedua kutipan memiliki wording yang berbeda.',sourceIds:['prior-section','terms-section'],recommendedAction:'Cocokkan versi dan periode sumber.',proposedText:null}],warnings:[],
        },errorCode:null,review:null,findingReviews:[],attemptedAt:'2026-11-20T00:00:00Z',
      }],
    }]:[],
    budget:{attemptsToday:0,limit:40,inFlightUntil:null},
    sources:{caseDocuments:priorVersions,priorSlips:[...priorVersions].reverse(),standardTerms:termsVersions},
  };
  await page.route('**/auth/v1/token**', route => route.fulfill({ json: { access_token: 'test-session', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } }));
  await page.route('**/auth/v1/logout**', route => route.fulfill({ status: 204 }));
  if (scheduleFile) await page.route('http://127.0.0.1:54321/storage/v1/object/sign/**', route =>
    route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: scheduleFile!.bytes }));
  await page.route('**/functions/v1/renewal-api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/renewal-api/')[1];
    if (request.method() !== 'GET') writes.push(path);
    if (path === 'cases') return route.fulfill({ json: { cases: [{ caseId: state.id, clientName: state.clientName, role, lockVersion: state.lockVersion }] } });
    if (path === 'case-setup') return route.fulfill({ json: { workspaces: role === 'broker' ? [{ workspaceId: 'qa', name: 'QA brokerage', clients: [] }] : [] } });
    if (path === 'workspace-settings') return route.fulfill({ json: { workspaces: role === 'broker' ? [{
      workspaceId: 'qa', name: 'QA brokerage', isSuperadmin: superadmin, canManageStandardTerms: superadmin,
      members: superadmin ? [
        { userId: user.id, email, role: 'broker', superadmin: true, canManageStandardTerms: true },
        { userId: 'presentation-colleague', email: 'colleague@example.invalid', role: 'broker', superadmin: false, canManageStandardTerms: false },
        { userId: 'presentation-client', email: 'client@example.invalid', role: 'client', superadmin: false, canManageStandardTerms: false },
      ] : [], standardTerms: [],
    }] : [] } });
    if (path === 'workspace-settings/members') {
      membershipChanges = request.postDataJSON().changes;
      return route.fulfill({ json: { updated: 1 } });
    }
    if (path.endsWith('/assignments')) return route.fulfill({ json: { workspaceId: 'qa', lockVersion: state.lockVersion, clients: [], clientUserIds: [] } });
    if (path.endsWith('/ai') && request.method()==='GET') return route.fulfill({ json: aiHistory });
    if (path.includes('/ai/batches/') && /\/findings\/\d+\/review$/.test(path) && request.method()==='POST') {
      const input=request.postDataJSON(),step=aiHistory.batches[0]?.steps[0];
      if(step)step.findingReviews=[{findingIndex:0,decision:input.decision,note:input.note,reviewedBy:user.id,at:'2026-11-20T01:00:00Z'}];
      return route.fulfill({json:{step}});
    }
    if (scheduleFile && path.endsWith(`/documents/${scheduleFile.id}/download`)) {
      return route.fulfill({ json: { url: `http://127.0.0.1:54321/storage/v1/object/sign/renewal-documents/${scheduleFile.id}?token=test` } });
    }
    if (scheduleFile && path.endsWith('/commands') && request.method() === 'POST') {
      const input = request.postDataJSON();
      const action = { ...input.payload, type: input.type } as CaseAction;
      state = applyAction(state, { id: user.id, role: 'broker' }, action, state.lockVersion, '2026-11-20T01:02:00.000Z');
      return route.fulfill({ json: { role: 'broker', state } });
    }
    return route.fulfill({ json: role === 'broker' ? { role, state } : { role, ...clientView(state, user.id) } });
  });
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fictional-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Open case →' }).click();
  await expect(page.getByRole('heading', { name: state.clientName, exact: true })).toBeVisible();
  return { state, writes, membershipChanges: () => membershipChanges };
}

test('AI clause review is the broker entry task and stores a separate finding decision', async ({ page }) => {
  const { state,writes } = await account(page, 'broker', 'qa@example.invalid', false, true);
  await expect(page.getByTestId('section-tab-ai')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'AI-assisted renewal clause review', exact: true })).toBeVisible();
  await expect(page.getByLabel('Previous Final Slip', { exact: true })).toHaveValue('prior-v2');
  await expect(page.getByLabel('Workspace Standard T&C', { exact: true })).toHaveValue('terms-v3');
  await expect(page.getByText('New or strengthened', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  const finding=page.getByTestId('ai-finding-review-0');
  await finding.getByLabel('Broker decision for this finding', { exact: true }).selectOption('follow-up');
  await finding.getByLabel('Reason or follow-up question', { exact: true }).fill('Check the finalized source pages and exact period.');
  await finding.getByRole('checkbox').check();
  await finding.getByRole('button', { name: 'Save broker decision', exact: true }).click();
  await expect(finding).toContainText('Follow-up required');
  await expect(finding).toContainText('Wording and renewal status are unchanged');
  expect(writes).toEqual([`cases/${state.id}/ai/batches/qa-clause-batch/steps/0/findings/0/review`]);
});

test('broker accounts require a reviewed XLSX schedule before preparing the QS', async ({ page }) => {
  await account(page, 'broker', 'qa@example.invalid', false, false, true);
  const scheduleTab = page.getByTestId('section-tab-schedule');
  await expect(scheduleTab).toBeVisible();
  await scheduleTab.click();
  await expect(page.getByRole('heading', { name: 'Import and review property schedule', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download XLSX template', exact: true })).toBeVisible();
  await page.getByTestId('section-tab-qs').click();
  await expect(page.getByTestId('send-quote')).toBeDisabled();
  await expect(page.getByText('Upload, review, and save an XLSX schedule for the current renewal period.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Renewal materials', exact: true }).first().click();
  await expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
});

test('broker can correct and save every imported schedule row with source provenance', async ({ page }) => {
  const { state, writes } = await account(page, 'broker', 'qa@example.invalid', false, false, true, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('section-tab-schedule').click();
  await page.getByRole('button', { name: 'Prepare rows for review', exact: true }).click();
  await expect(page.getByText('1. Factory A · IDR 3500000000', { exact: true })).toBeVisible();
  await expect(page.getByText('1 fields need correction', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save reviewed schedule version', exact: true })).toBeDisabled();
  await page.locator('#schedule-review details > summary').click();
  await expect(page.locator('#schedule-review')).toContainText('Imported from Schedule · row 2 · cells A2, B2, C2');
  await expect(page.getByText(/Rate cell G2 uses Excel percentage formatting/)).toBeVisible();
  const name = page.getByLabel('Location name', { exact: true });
  await name.fill('Factory A corrected');
  await expect(page.getByText('Imported value: Factory A', { exact: true })).toBeVisible();
  await page.getByLabel('Rate (exact source value)', { exact: true }).fill('4.83');
  await expect(page.getByRole('button', { name: 'Save reviewed schedule version', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Save reviewed schedule version', exact: true }).click();
  await expect(page.getByText(/Current reviewed schedule: v1/)).toBeVisible();
  expect(writes).toContain(`cases/${state.id}/commands`);
});

test('broker sections preserve drafts and locale, with keyboard tab navigation', async ({ page }) => {
  const { writes } = await account(page, 'broker');
  await expect(page.getByTestId('section-tab-wording')).toHaveCount(0);
  await page.locator('.stage-link:visible').filter({ hasText: 'Insurer review' }).click();
  await expect(page.getByTestId('section-tab-wording')).toBeVisible();
  await page.locator('.stage-link:visible').filter({ hasText: 'Renewal materials' }).click();
  const sources = page.getByTestId('section-tab-sources');
  await sources.click();
  await page.getByText('Record a new fictional source version', { exact: true }).click();
  const draft = page.locator('#doc-name');
  await draft.fill('Unsent source wording — keep verbatim');
  await page.getByTestId('section-tab-terms').click();
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
  await expect(page.getByTestId('section-tab-ai')).toBeFocused();
  expect(await page.getByTestId('section-tab-ai').evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
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
  await page.locator('.stage-link:visible').filter({ hasText: 'Insurer review' }).click();
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

test('workspace settings do not infer Superadmin or Standard T&C privileges from broker membership', async ({ page }) => {
  const { state, writes } = await account(page, 'broker');
  const trigger = await accountTrigger(page);
  await trigger.click();
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace settings', exact: true })).toBeVisible();
  await expect(page.getByText('You can download finalized sources. Upload access is managed by the workspace Superadmin.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Member access', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: state.clientName, exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('Superadmins can delegate Standard T&C access to another broker member', async ({ page }) => {
  const { writes, membershipChanges } = await account(page, 'broker', 'admin@example.invalid', true);
  const trigger = await accountTrigger(page);
  await trigger.click();
  await page.locator('[data-testid="account-menu-actions"]:visible').getByRole('button', { name: 'Workspace settings', exact: true }).click();
  const colleague = page.getByText('colleague@example.invalid', { exact: true }).locator('xpath=../..');
  await colleague.getByLabel('Manage Standard T&C').check();
  await page.getByRole('button', { name: 'Save member access', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Member access changes saved.');
  expect(writes).toEqual(['workspace-settings/members']);
  expect(membershipChanges()).toEqual([{
    userId: 'presentation-colleague', role: 'broker', superadmin: false, canManageStandardTerms: true,
  }]);
});
