import { test, expect } from '@playwright/test';

// Existing workflow assertions exercise the Indonesian locale explicitly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rekonvia.locale.v1', 'id_ID'));
});
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Document, Packer, Paragraph } from 'docx';
import { createHostedFixture } from './authenticated-fixtures.ts';
import { getCurrentWording } from '../src/domain.ts';
import { aiStepSections, parseAiBatch, parseAiReview } from '../supabase/functions/_shared/ai-contract.ts';
import type { AiBatch, AiHistory } from '../supabase/functions/_shared/ai-contract.ts';

test.use({trace:'off'});
test.skip(process.env.REKONVIA_RUN_HOSTED_BROWSER_TESTS!=='1','Explicitly enabled hosted acceptance only.');

async function login(page:Page,account:{email:string;password:string}) {
  await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(account.email);
  await page.getByLabel('Kata sandi',{exact:true}).fill(account.password);
  await page.getByRole('button',{name:'Masuk',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Kasus renewal',exact:true})).toBeVisible();
}

test('AI preparation preserves source text, resumes completed work and leaves manual decisions unchanged',async({browser})=>{
  test.setTimeout(180_000);
  const fixture=await createHostedFixture(),context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  await context.addInitScript(()=>localStorage.setItem('rekonvia.locale.v1','id_ID'));
  try{
    const page=await context.newPage(),history:AiHistory={batches:[],budget:{attemptsToday:0,limit:40,inFlightUntil:null}};
    const original='FIKTIF — Rate PAR 0.0483%; perluasan banjir harus diperiksa. Wording asli tetap utuh.';
    const bytes=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph(original),new Paragraph('FIKTIF: bagian kedua tidak dipilih dan belum diperiksa oleh AI.')]}]}));
    const aiPrefix=fixture.url+'/functions/v1/renewal-api/cases/'+fixture.caseA+'/ai';
    let actualAttempts=0,lostResponse=true,nextFails=false;
    const sentKeys:string[]=[],receipts=new Map<string,unknown>();
    await page.route(aiPrefix+'**',async route=>{
      const request=route.request(),suffix=request.url().slice(aiPrefix.length);
      if(request.method()==='GET'){await route.fulfill({json:history});return;}
      const input=request.postDataJSON();
      const receiptKey=suffix+':'+String(input.idempotencyKey);
      if(suffix.match(/^\/batches\/[^/]+\/steps\/\d+$/))sentKeys.push(input.idempotencyKey);
      if(receipts.has(receiptKey)){await route.fulfill({json:receipts.get(receiptKey)});return;}
      if(suffix==='/batches'){
        const parsed=parseAiBatch(input);
        const batch:AiBatch={id:randomUUID(),purpose:parsed.purpose,sections:parsed.sections,unprocessedCount:parsed.unprocessedCount,createdAt:new Date().toISOString(),
          steps:aiStepSections(parsed.sections).map((sectionIds,index)=>({index,sectionIds,status:'pending',result:null,errorCode:null,review:null,attemptedAt:null}))};
        history.batches.unshift(batch);
        const result={batch,budget:history.budget};receipts.set(receiptKey,result);
        await route.fulfill({json:result});return;
      }
      const match=suffix.match(/^\/batches\/([^/]+)\/steps\/(\d+)(\/review)?$/);
      if(!match){await route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});return;}
      const batch=history.batches.find(item=>item.id===match[1])!,step=batch.steps[Number(match[2])];
      if(match[3]){
        const review=parseAiReview(input);step.review={decision:review.decision,note:review.note,reviewedBy:fixture.accounts[0].id,at:new Date().toISOString()};
      }else{
        actualAttempts++;history.budget.attemptsToday++;step.attemptedAt=new Date().toISOString();
        if(nextFails){step.status='failed';step.errorCode='AI_NO_ELIGIBLE_PROVIDER';nextFails=false;}
        else{step.status='completed';step.result={summary:'Temuan hanya dari kutipan terpilih; bagian kedua belum ditinjau.',findings:[{kind:'warning',title:'Rate memerlukan pemeriksaan broker',detail:'Sumber menulis 0.0483% secara eksplisit. Periksa unit dan perluasan pada wording asli.',sourceIds:step.sectionIds,proposedText:'Catatan kandidat: rate tertulis 0.0483%; verifikasi cakupan banjir.'}],warnings:['AI tidak dapat menetapkan persetujuan klien atau insurer.']};}
      }
      const result={step,budget:history.budget};receipts.set(receiptKey,result);
      if(!match[3] && lostResponse){lostResponse=false;await route.abort('failed');return;}
      await route.fulfill({json:result});
    });
    await login(page,fixture.accounts[0]);
    await page.getByRole('button').filter({hasText:fixture.caseA}).click();
    await expect(page.getByRole('heading',{name:fixture.initial.clientName,exact:true})).toBeVisible();
    await page.getByTestId('section-tab-sources').click();
    const source=fixture.initial.documents[0],upload=page.locator('#upload-'+source.id);
    await upload.locator('input[type=file]').setInputFiles({name:'fictional-source.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:bytes});
    await upload.getByRole('button',{name:'Unggah dan finalisasi',exact:true}).click();
    await expect(upload).toHaveCount(0);
    const before=await fixture.read();
    await page.getByTestId('section-tab-ai').click();
    await page.getByText('Bantuan AI untuk sumber renewal · opsional',{exact:true}).click();
    const workspace=page.locator('[data-ai-workspace]');
    await expect(workspace.getByTestId('ai-refresh')).toBeEnabled();
    await workspace.getByTestId('ai-preparation').locator(':scope > summary').click();
    await workspace.locator('#ai-document').selectOption(source.id);
    await workspace.getByTestId('ai-open-source').click();
    const section=workspace.getByTestId('ai-preparation').locator('details').first();
    await section.locator(':scope > summary').click();
    await expect(section.locator('textarea')).toHaveValue(original);
    await expect(section.locator('textarea')).toHaveAttribute('readonly','');
    await section.getByRole('checkbox',{name:/Sertakan word\/document.xml \/ paragraf 1/}).check();
    await expect(workspace.getByTestId('ai-create-batch')).toBeDisabled();
    await workspace.getByRole('checkbox',{name:/Saya memastikan pilihan ini hanya berisi data fiktif/}).check();
    await workspace.getByTestId('ai-create-batch').click();
    await expect(workspace.getByTestId('ai-run-step-0')).toBeEnabled();
    expect(history.batches[0].sections[0].text).toBe(original);
    expect(history.batches[0].unprocessedCount).toBe(1);
    expect(actualAttempts).toBe(0);
    await workspace.getByTestId('ai-run-step-0').click();
    await expect(workspace.getByTestId('ai-retry-same')).toBeVisible();
    await workspace.getByTestId('ai-retry-same').click();
    await expect(workspace.getByText('Rate memerlukan pemeriksaan broker',{exact:true})).toBeVisible();
    expect(actualAttempts).toBe(1);
    expect(sentKeys).toHaveLength(2);expect(sentKeys[1]).toBe(sentKeys[0]);
    await expect(workspace.getByTestId('ai-run-step-0')).toHaveCount(0);
    await workspace.getByText('Periksa sumber: '+source.id+' · word/document.xml / paragraf 1',{exact:true}).click();
    await workspace.getByRole('button',{name:'Salin kutipan sumber',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(original);
    const reviewed=workspace.getByRole('button',{name:'Catat saran ditinjau',exact:true});
    await expect(reviewed).toBeDisabled();
    await workspace.getByLabel('Catatan tinjauan broker',{exact:true}).fill('Sumber asli fiktif diperiksa. Unit rate sesuai; cakupan tetap memerlukan peninjauan manual.');
    await workspace.getByRole('checkbox',{name:/Saya memeriksa kutipan, konteks, dan setiap saran/}).check();
    await reviewed.click();
    await expect(workspace.getByText(/Saran ditinjau broker ·/)).toBeVisible();
    expect(await fixture.read()).toEqual(before);
    nextFails=true;
    await workspace.getByRole('checkbox',{name:/Saya memastikan pilihan ini hanya berisi data fiktif/}).check();
    await workspace.getByTestId('ai-create-batch').click();
    await expect(workspace.getByTestId('ai-run-step-0')).toBeEnabled();
    await workspace.getByTestId('ai-run-step-0').click();
    await expect(workspace.getByText(/Langkah ini belum menghasilkan saran yang dapat dipakai/)).toBeVisible();
    expect(actualAttempts).toBe(2);
    await expect(workspace.getByTestId('ai-run-step-0')).toHaveCount(0);
    await page.getByTestId('section-tab-wording').click();
    const manualReview=page.locator('#review-'+getCurrentWording(before).items[0].id);
    await expect(manualReview.getByRole('button',{name:'Simpan review wording',exact:true})).toBeEnabled();
    expect(await fixture.read()).toEqual(before);
    await page.reload();
    await page.getByRole('button').filter({hasText:fixture.caseA}).click();
    await page.getByTestId('section-tab-ai').click();
    await page.getByText('Bantuan AI untuk sumber renewal · opsional',{exact:true}).click();
    await expect(workspace.getByText(/Langkah ini belum menghasilkan saran yang dapat dipakai/)).toBeVisible();
    const completed=workspace.getByTestId('ai-batches').locator(':scope > details').nth(1);
    await completed.locator(':scope > summary').click();
    await expect(completed.getByText('Rate memerlukan pemeriksaan broker',{exact:true})).toBeVisible();
    await expect(completed.getByText(/Saran ditinjau broker ·/)).toBeVisible();
    await expect(completed.getByTestId('ai-run-step-0')).toHaveCount(0);
    expect(actualAttempts).toBe(2);
    for(const width of [1440,768,390,320]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.keyboard.press('Tab');
    await workspace.getByTestId('ai-refresh').focus();
    await expect(workspace.getByTestId('ai-refresh')).toBeFocused();
    expect(await workspace.getByTestId('ai-refresh').evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await page.evaluate(text=>Object.values(localStorage).some(value=>value.includes(text)),original)).toBe(false);
    expect(await fixture.read()).toEqual(before);
  }finally{await context.close();await fixture.cleanup();}
});
