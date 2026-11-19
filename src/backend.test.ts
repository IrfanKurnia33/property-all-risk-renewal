import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { applyAction, createInitialCase, getActiveProposal, LOCAL_ACTORS } from './domain.ts';
import { clientProposal, clientView, parseCommand } from '../supabase/functions/_shared/api-contract.ts';
import { validateUpload } from '../supabase/functions/_shared/upload-validation.ts';
import { proposalReadyCase } from '../tests/fixtures.ts';

const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const command={caseId:'PAR-2027-014',expectedVersion:0,idempotencyKey:'310fe73b-fd1d-4ca9-9a40-c99e0acb1b34',type:'saveNotes',payload:{notes:'Example'}};
test('command boundary rejects actor spoofing, extra fields and file pointer injection',()=>{
  assert.deepEqual(parseCommand(command),command);
  assert.equal(parseCommand({...command,idempotencyKey:command.idempotencyKey.toUpperCase()}).idempotencyKey,command.idempotencyKey);
  assert.throws(()=>parseCommand({...command,actor:{role:'broker'}}));
  assert.throws(()=>parseCommand({...command,payload:{notes:'x',state:{}}}));
  assert.throws(()=>parseCommand({...command,expectedVersion:-1}));
  assert.throws(()=>parseCommand({...command,type:'attachEvidence',payload:{documentVersionId:'x',file:{}}}));
  assert.throws(()=>parseCommand({...command,type:'addDocument',payload:{document:{file:{id:'forged'}}}}));
  assert.throws(()=>parseCommand(JSON.parse(JSON.stringify(command).replace('"notes":"Example"','"notes":"Example","__proto__":{}'))));
});
test('published client projection excludes notes, raw evidence, private citations and nested unexpected properties',()=>{
  const state=proposalReadyCase();state.notes='PRIVATE-BROKER-NOTES';
  const proposal=getActiveProposal(state)!;
  proposal.responses[0].note='PRIVATE-RESPONSE';proposal.wording[0].reviewNote='PRIVATE-REVIEW';
  Object.assign(proposal.terms,{privateNote:'PRIVATE-NESTED'});
  Object.assign(proposal.locations[0].values,{sourcePack:'PRIVATE-PACK'});
  const safe=JSON.stringify(clientProposal(proposal));
  assert.doesNotMatch(safe,/PRIVATE-|sourceVersionIds|externalRespondent|recordedBy|outgoingSource|replySource|reviewNote/);
  assert.equal(clientView(state,'unrelated-client').submissions.length,0);
  assert.equal(clientView(state,'unrelated-client').proposal?.id,proposal.id);
});
test('verified file attachment is immutable and does not establish client confirmation',()=>{
  const initial=createInitialCase();
  const action={type:'attachEvidence' as const,documentVersionId:initial.documents[0].id,
    file:{id:'310fe73b-fd1d-4ca9-9a40-c99e0acb1b34',sha256:'a'.repeat(64),byteSize:10,mimeType:'application/pdf'}};
  const next=applyAction(initial,LOCAL_ACTORS.broker,action,0);
  assert.equal(next.lockVersion,1);assert.equal(next.revision,initial.revision);
  assert.equal(next.locations[0].confirmation,null);
  assert.throws(()=>applyAction(next,LOCAL_ACTORS.broker,action,1));
  assert.throws(()=>applyAction(initial,LOCAL_ACTORS.client,action,0));
});
function office(extra:Record<string,Uint8Array>={}) {
  return zipSync({'[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml':strToU8('<document/>'),...extra});
}
test('upload signatures, MIME, extension and encrypted PDF are checked',()=>{
  validateUpload(strToU8('%PDF-1.7\n%%EOF'),'example.pdf','application/pdf');
  assert.throws(()=>validateUpload(strToU8('%PDF-1.7\n /En#63rypt 1 0 R'),'x.pdf','application/pdf'));
  assert.throws(()=>validateUpload(strToU8('<svg/>'),'x.png','image/png'));
  assert.throws(()=>validateUpload(strToU8('%PDF-1.7\n'),'x.pdf','image/png'));
  assert.throws(()=>validateUpload(new Uint8Array(10*1024*1024+1),'x.pdf','application/pdf'));
  assert.throws(()=>validateUpload(new Uint8Array(),'x.pdf','application/pdf'));
});
test('Office inspection rejects unsafe paths, macros, encryption and incomplete packages',()=>{
  validateUpload(office(),'example.docx',DOCX);
  const invalid:Record<string,Uint8Array>[]=[{'../escape':strToU8('x')},{'word/vbaProject.bin':strToU8('x')},{'A.txt':strToU8('x'),'a.txt':strToU8('y')}];
  for(const extra of invalid)
    assert.throws(()=>validateUpload(office(extra),'x.docx',DOCX));
  const bytes=office();assert.throws(()=>validateUpload(bytes.subarray(0,bytes.length-8),'x.docx',DOCX));
  assert.throws(()=>validateUpload(Uint8Array.from([0xd0,0xcf,0x11,0xe0]),'x.docx',DOCX));
});
test('Office actual decompression is bounded even with forged advertised sizes',()=>{
  const bomb=office({'word/large.xml':new Uint8Array(16*1024*1024+1)});
  const view=new DataView(bomb.buffer);const decoder=new TextDecoder();
  for(let i=0;i+46<bomb.length;i++)if(view.getUint32(i,true)===0x02014b50){
    const length=view.getUint16(i+28,true);
    if(decoder.decode(bomb.subarray(i+46,i+46+length))==='word/large.xml'){
      const local=view.getUint32(i+42,true);view.setUint32(local+22,1,true);view.setUint32(i+24,1,true);break;
    }
  }
  assert.throws(()=>validateUpload(bomb,'x.docx',DOCX),/decompression/);
});
