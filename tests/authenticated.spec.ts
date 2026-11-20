import { test, expect } from '@playwright/test';

// Existing workflow assertions exercise the Indonesian locale explicitly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rekonvia.locale.v1', 'id_ID'));
});
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { createHostedFixture } from './authenticated-fixtures.ts';
import { getCurrentWording } from '../src/domain.ts';

test.use({trace:'off'});
test.skip(process.env.REKONVIA_RUN_HOSTED_BROWSER_TESTS!=='1','Explicitly enabled hosted acceptance only.');
async function login(page:Page,account:{email:string;password:string}) {
  await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Kata sandi',{exact:true}).fill(account.password);
  const response=page.waitForResponse(r=>r.url().includes('/auth/v1/token') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Masuk',exact:true}).click();
  const result=await response;if(!result.ok()){const data=await result.json();throw new Error('Browser sign-in failed (HTTP '+result.status()+', '+String(data.code??data.error_code??'no code')+').');}
  await expect(page.getByRole('heading',{name:'Kasus renewal',exact:true})).toBeVisible();
}
async function stage(page:Page,label:string) {
  if((page.viewportSize()?.width??1440)<=800){const menu=page.locator('.mobile-stage-nav');if(!await menu.evaluate(el=>(el as HTMLDetailsElement).open))await menu.locator('summary').click();}
  await page.locator('.stage-link:visible').filter({hasText:label}).click();
}
async function saved(page:Page,action:()=>Promise<unknown>,status=200) {
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/commands') && r.request().method()==='POST'),action()]);
  expect(response.status()).toBe(status);
  await expect(page.locator('fieldset.main-column')).toBeEnabled();
}
test('authenticated renewal isolates four accounts, retains stale drafts and exports current DFS',async({browser})=>{
  test.setTimeout(240_000);
  const fixture=await createHostedFixture(),contexts=[];
  try{
    for(let i=0;i<4;i++)contexts.push(await browser.newContext());
    const pages=await Promise.all(contexts.map(c=>c.newPage()));const [b1,b2,c1,c2]=pages;
    await b1.addInitScript(()=>localStorage.setItem('rekonvia.case.v2','{"old":"fictional local backup"}'));
    for(let i=0;i<4;i++)await login(pages[i],fixture.accounts[i]);
    for(const broker of [b1,b2]){await expect(broker.getByRole('button').filter({hasText:fixture.caseA})).toHaveCount(1);await expect(broker.getByRole('button').filter({hasText:fixture.caseB})).toHaveCount(1);}
    await expect(c1.getByText('Belum ada kasus yang dapat dibuka',{exact:true})).toBeVisible();
    await expect(c2.getByRole('button').filter({hasText:fixture.caseB})).toHaveCount(1);await expect(c2.getByText(fixture.caseA)).toHaveCount(0);
    for(const broker of [b1,b2]){await broker.getByRole('button').filter({hasText:fixture.caseA}).click();await expect(broker.getByRole('heading',{name:fixture.initial.clientName,exact:true})).toBeVisible();await expect(broker.getByTestId('role-select')).toHaveCount(0);}
    for(const broker of [b1,b2])await stage(broker,'Final review');
    await b1.locator('#notes').fill('PRIVATE-BROKER-WRITE-'+fixture.run);await b2.locator('#notes').fill('PRIVATE-STALE-DRAFT-'+fixture.run);
    await saved(b1,()=>b1.getByRole('button',{name:'Simpan catatan sesi',exact:true}).click());
    await saved(b2,()=>b2.getByRole('button',{name:'Simpan catatan sesi',exact:true}).click(),409);
    await expect(b2.getByRole('alert')).toContainText('Kasus berubah');await expect(b2.locator('#notes')).toHaveValue('PRIVATE-STALE-DRAFT-'+fixture.run);
    await b2.getByRole('button',{name:'Muat ulang versi terbaru',exact:true}).click();await expect(b2.getByRole('alert')).toHaveCount(0);await expect(b2.locator('#notes')).toHaveValue('PRIVATE-STALE-DRAFT-'+fixture.run);
    await saved(b2,()=>b2.getByRole('button',{name:'Simpan catatan sesi',exact:true}).click());
    expect((await fixture.read()).notes).toBe('PRIVATE-STALE-DRAFT-'+fixture.run);
    // Lose a successful response, then replay exactly the same command key.
    await b1.getByRole('button',{name:'Muat ulang versi terbaru',exact:true}).click();await expect(b1.locator('.case-meta')).toContainText('versi simpan 2');
    await b1.locator('#notes').fill('PRIVATE-RETRY-'+fixture.run);
    let lost=true;
    await b1.route('**/functions/v1/renewal-api/cases/*/commands',async route=>{if(lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
    await b1.getByRole('button',{name:'Simpan catatan sesi',exact:true}).click();await expect(b1.getByRole('button',{name:'Coba ulang tindakan yang sama',exact:true})).toBeVisible();
    const beforeRetry=(await fixture.read()).lockVersion;
    await b1.getByRole('button',{name:'Coba ulang tindakan yang sama',exact:true}).click();await expect(b1.getByRole('button',{name:'Coba ulang tindakan yang sama',exact:true})).toHaveCount(0);
    expect((await fixture.read()).lockVersion).toBe(beforeRetry);await b1.unroute('**/functions/v1/renewal-api/cases/*/commands');
    await stage(b1,'Bahan renewal');
    const sourceIds=new Set(getCurrentWording(fixture.initial).items.flatMap(w=>[w.priorSource?.documentVersionId,w.outgoingSource.documentVersionId]).filter((x):x is string=>!!x));
    sourceIds.add('reply-'+fixture.initial.selectedOptionId);
    sourceIds.add('binding-'+fixture.initial.selectedOptionId);
    for(const id of sourceIds){const form=b1.locator('#upload-'+id);await form.locator('input[type=file]').setInputFiles({name:id+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nFictional source for browser QA.\n%%EOF')});await form.getByRole('button',{name:'Unggah dan finalisasi',exact:true}).click();await expect(form).toHaveCount(0);}
    for(const w of getCurrentWording(fixture.initial).items){const form=b1.locator('#review-'+w.id);await form.getByLabel('Catatan review wording').fill('Fictional sources and original wording checked.');await saved(b1,()=>form.getByRole('button',{name:'Simpan review wording',exact:true}).click());}
    await saved(b1,()=>b1.getByTestId('send-quote').click());await expect(b1.getByTestId('export-qs')).toBeEnabled();
    await stage(b1,'Review asuransi');const response=b1.locator('#record-response');await response.locator('#external-respondent').fill('PRIVATE-UNDERWRITER-'+fixture.run);await response.locator('#response-source').selectOption('reply-'+fixture.initial.selectedOptionId);await response.locator('#response-evidence').fill('Fictional acceptance of QS and 100% share.');
    await saved(b1,()=>b1.getByTestId('record-response').click());await stage(b1,'Proposal klien');await saved(b1,()=>b1.getByTestId('publish-proposal').click());
    const [proposalDownload]=await Promise.all([b1.waitForEvent('download'),b1.getByTestId('export-proposal').click()]);
    const proposalPath=await proposalDownload.path();
    const proposalXml=new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(proposalPath!)))['word/document.xml']);
    expect(proposalXml.includes('PROPOSAL')).toBe(true);expect(/PRIVATE-/.test(proposalXml)).toBe(false);
    await c1.getByRole('button',{name:'Muat ulang daftar',exact:true}).click();await c1.getByRole('button').filter({hasText:fixture.caseA}).click();await expect(c1.getByRole('heading',{name:fixture.initial.clientName,exact:true})).toBeVisible();
    await expect(c1.getByTestId('client-export-proposal')).toBeEnabled();
    const [clientProposalDownload]=await Promise.all([c1.waitForEvent('download'),c1.getByTestId('client-export-proposal').click()]);
    const clientProposalPath=await clientProposalDownload.path();
    expect(new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(clientProposalPath!)))['word/document.xml'])).toBe(proposalXml);
    const safeResponse=await fixture.api(2,fixture.caseA);expect(safeResponse.status).toBe(200);const safe=await safeResponse.text();expect(/PRIVATE-|outgoingSource|replySource|externalRespondent|sourceVersionIds/.test(safe)).toBe(false);
    expect((await fixture.api(2,fixture.caseB)).status).toBe(404);expect((await fixture.api(3,fixture.caseA)).status).toBe(404);
    const staleClient=await contexts[2].newPage();await staleClient.goto('/');await staleClient.getByRole('button').filter({hasText:fixture.caseA}).click();
    for(const client of [c1,staleClient])for(let i=0;i<fixture.initial.locations.length;i++){await client.locator('#client-evidence-'+i).fill('Fictional client confirmation '+i);await client.locator('#authenticated-client-locations input[type=checkbox]').nth(i).check();}
    await c1.getByRole('button',{name:'Simpan konfirmasi lokasi',exact:true}).click();await expect(c1.getByTestId('client-agree')).toBeEnabled();
    await staleClient.getByRole('button',{name:'Simpan konfirmasi lokasi',exact:true}).click();await expect(staleClient.getByRole('alert')).toContainText('Kasus berubah');await expect(staleClient.locator('#client-evidence-0')).toHaveValue('Fictional client confirmation 0');
    await staleClient.getByRole('button',{name:'Muat ulang versi terbaru',exact:true}).click();await expect(staleClient.getByRole('button',{name:'Saya sudah meninjau versi terbaru',exact:true})).toBeVisible();await expect(staleClient.locator('#client-evidence-0')).toHaveValue('Fictional client confirmation 0');
    await staleClient.getByRole('button',{name:'Saya sudah meninjau versi terbaru',exact:true}).click();await staleClient.getByRole('button',{name:'Simpan konfirmasi lokasi',exact:true}).click();await expect(staleClient.getByTestId('client-agree')).toBeEnabled();
    await c1.getByRole('button',{name:'Muat ulang versi terbaru',exact:true}).click();await expect(c1.getByTestId('client-agree')).toBeEnabled();
    await c1.locator('#client-decision-evidence').fill('Fictional agreement to this proposal.');await c1.getByTestId('client-agree').click();await expect(c1.getByTestId('client-instruct')).toBeEnabled();await c1.locator('#client-decision-evidence').fill('Fictional renewal instruction for this proposal.');await c1.getByTestId('client-instruct').click();await expect(c1.getByText('Instruksi tersimpan',{exact:true})).toBeVisible();
    await b1.getByRole('button',{name:'Muat ulang versi terbaru',exact:true}).click();await expect(b1.locator('fieldset.main-column')).toBeEnabled();await stage(b1,'Rekonsiliasi');
    for(const l of fixture.initial.locations){const form=b1.locator('#match-'+l.id);await form.getByLabel('Hasil pencocokan').selectOption('matched');await form.getByLabel('Catatan pencocokan').fill('Fictional client evidence matched.');await saved(b1,()=>form.getByRole('button',{name:'Simpan pencocokan',exact:true}).click());}
    await stage(b1,'Final review');for(const key of ['identity','period','rate','deductible','clauses'])await saved(b1,()=>b1.getByTestId('check-'+key).check());
    await saved(b1,()=>b1.getByTestId('issue-dfs').click());
    const download=b1.waitForEvent('download');await b1.getByTestId('export-word').click();const word=await download;const path=await word.path();const xml=new TextDecoder().decode(unzipSync(new Uint8Array(await readFile(path!)))['word/document.xml']);
    expect(xml.includes(fixture.caseA)).toBe(true);expect(xml.includes('DFS')).toBe(true);expect(xml.includes(getCurrentWording(fixture.initial).items[0].outgoing)).toBe(true);
    const dispatch=b1.locator('#binding-dispatch');await dispatch.locator('#dispatch-reference').fill('Fictional manual dispatch QA');await dispatch.locator('#dispatch-recipient').fill('Asuransi Fiktif A');await dispatch.locator('#dispatch-time').fill('2026-11-19T21:00');
    await saved(b1,()=>b1.getByTestId('request-binding').click());
    const acknowledgment=b1.locator('#binding-ack');await acknowledgment.locator('#ack-respondent').fill('Fictional insurer respondent');await acknowledgment.locator('#ack-source').selectOption('binding-'+fixture.initial.selectedOptionId);await acknowledgment.locator('#ack-evidence').fill('Fictional acknowledgment binding-1 / dfs-1 for opsi utama.');
    await saved(b1,()=>b1.getByTestId('acknowledge-binding').click());
    const complete=await fixture.read();expect(complete.bindingRequests).toHaveLength(1);expect(complete.bindingAcknowledgments).toHaveLength(1);expect(complete.bindingAcknowledgments[0].recordedBy).toBe(fixture.accounts[0].id);
    expect(await b1.evaluate(()=>localStorage.getItem('rekonvia.case.v2'))).toBe('{"old":"fictional local backup"}');
    expect(await b1.evaluate(marker=>Object.values(localStorage).some(v=>v.includes(marker)),'PRIVATE-RETRY-'+fixture.run)).toBe(false);
    await c1.locator('#client-decision-evidence').fill('PRIVATE-UNSAVED-CLIENT-DRAFT');await c1.getByRole('button',{name:'Keluar',exact:true}).click();await expect(c1.getByRole('heading',{name:'Masuk ke Rekonvia',exact:true})).toBeVisible();await expect(c1.locator('#client-decision-evidence')).toHaveCount(0);
    await login(c1,fixture.accounts[3]);await expect(c1.getByRole('button').filter({hasText:fixture.caseB})).toHaveCount(1);await expect(c1.getByText(fixture.caseA)).toHaveCount(0);expect((await c1.content()).includes('PRIVATE-UNSAVED-CLIENT-DRAFT')).toBe(false);
    await c2.getByRole('button').filter({hasText:fixture.caseB}).click();await expect(c2.getByRole('heading',{name:'PT Uji Kedua (Fiktif)',exact:true})).toBeVisible();
    for(const width of [1440,1024,820,768,390,320]){await c2.setViewportSize({width,height:900});expect(await c2.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await c2.getByRole('button',{name:'Daftar kasus',exact:true}).click();await c2.route('**/functions/v1/renewal-api/cases',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_SESSION'}})}));await c2.getByRole('button',{name:'Muat ulang daftar',exact:true}).click();await expect(c2.getByRole('heading',{name:'Masuk ke Rekonvia',exact:true})).toBeVisible();
  }finally{await Promise.all(contexts.map(c=>c.close()));await fixture.cleanup();}
});
