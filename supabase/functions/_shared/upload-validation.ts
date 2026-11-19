import { Unzip, UnzipInflate } from 'fflate';
import { ApiError } from './api-contract.ts';
export const MAX_FILE=10*1024*1024;
const MAX_ENTRY=16*1024*1024, MAX_EXPANDED=40*1024*1024;
const mimeTypes:Record<string,string>={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const reject=(reason:string):never=>{throw new ApiError(422,'UNSUPPORTED_FILE',reason+' Convert to an unencrypted PDF, DOCX, XLSX, JPEG, PNG or WebP (maximum 10 MiB).');};
const text=(b:Uint8Array)=>new TextDecoder('latin1').decode(b);
export function fileType(name: string): string {
  if(typeof name!=='string' || name.length>240 || /[\\/\x00-\x1f\x7f]/.test(name)) return reject('Invalid filename.');
  const ext=name.split('.').at(-1)?.toLowerCase() ?? '';
  if(!Object.hasOwn(mimeTypes,ext)) return reject('Unsupported file extension.');
  return mimeTypes[ext];
}
export function validateUpload(bytes: Uint8Array, name: string, mime: string) {
  if(!bytes.length || bytes.length>MAX_FILE) reject('Invalid file size.');
  if(fileType(name)!==mime) reject('MIME type does not match the extension.');
  const starts=(sig:number[])=>sig.every((b,i)=>bytes[i]===b);
  if(starts([0xd0,0xcf,0x11,0xe0])) reject('Encrypted or legacy Office container.');
  if(mime==='application/pdf') {
    if(!/^%PDF-(1\.[0-9]|2\.0)\s/.test(text(bytes.subarray(0,16)))) reject('Invalid PDF signature.');
    const decoded=text(bytes).replace(/#([a-f0-9]{2})/gi,(_,n:string)=>String.fromCharCode(parseInt(n,16)));
    if(/\/Encrypt(?=[\s()<>{}\[\]/%]|$)/.test(decoded)) reject('Encrypted PDF.');
  } else if(mime==='image/jpeg') { if(!starts([255,216,255])) reject('Invalid JPEG signature.');
  } else if(mime==='image/png') { if(!starts([137,80,78,71,13,10,26,10])) reject('Invalid PNG signature.');
  } else if(mime==='image/webp') {
    if(bytes.length<16 || text(bytes.subarray(0,4))!=='RIFF' || text(bytes.subarray(8,12))!=='WEBP'
      || !['VP8 ','VP8L','VP8X'].includes(text(bytes.subarray(12,16)))
      || new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4,true)!==bytes.length-8) reject('Invalid WebP signature.');
  } else inspectOffice(bytes,name.toLowerCase().endsWith('.docx')?'docx':'xlsx');
}
function inspectOffice(bytes:Uint8Array,extension:'docx'|'xlsx') {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=(i:number)=>view.getUint16(i,true), u32=(i:number)=>view.getUint32(i,true);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(u32(i)===0x06054b50 && i+22+u16(i+20)===bytes.length){end=i;break;}
  if(end<0) reject('Incomplete Office archive.');
  const count=u16(end+10), directory=u32(end+16);
  if(u16(end+4)!==0 || u16(end+6)!==0 || u16(end+8)!==count || !count || count>512
    || directory+u32(end+12)!==end) reject('Unsupported Office archive limits.');
  const entries=new Map<string,{size:number;compressed:number;offset:number;flags:number;method:number;crc:number}>();
  const names=new Set<string>(); let cursor=directory,total=0;
  const utf8=(b:Uint8Array)=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{return reject('Invalid ZIP filename encoding.');}};
  function extras(start:number,size:number) {
    const finish=start+size;
    for(let pos=start;pos<finish;) {
      if(pos+4>finish) reject('Malformed ZIP extra field.');
      const id=u16(pos), len=u16(pos+2);
      if(pos+4+len>finish || id===1 || id===0x9901) reject('ZIP64 or encrypted Office archive.');
      pos+=4+len;
    }
  }
  for(let i=0;i<count;i++) {
    if(cursor+46>end || u32(cursor)!==0x02014b50) reject('Malformed ZIP directory.');
    const flags=u16(cursor+8), method=u16(cursor+10), size=u32(cursor+24), compressed=u32(cursor+20), offset=u32(cursor+42);
    const nl=u16(cursor+28), el=u16(cursor+30), cl=u16(cursor+32), next=cursor+46+nl+el+cl;
    if(next>end || u16(cursor+34)!==0 || (flags&0x2041)!==0 || ![0,8].includes(method)
      || offset===0xffffffff || compressed===0xffffffff || size>MAX_ENTRY || ((u32(cursor+38)>>>16)&0xf000)===0xa000) reject('Encrypted or unsupported ZIP entry.');
    const name=utf8(bytes.subarray(cursor+46,cursor+46+nl));
    const normalized=name.normalize('NFC').toLowerCase();
    if(!name || name.length>1024 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')
      || name.replace(/\/$/,'').split('/').some(x=>!x || x==='.' || x==='..') || names.has(normalized)) reject('Unsafe or duplicate ZIP path.');
    if(/(?:^|\/)(vba[^/]*|macrosheets)(\/|$)/i.test(name)) reject('Macro-enabled Office document.');
    names.add(normalized); total+=size; if(total>MAX_EXPANDED) reject('Office archive expansion limit exceeded.');
    extras(cursor+46+nl,el);
    entries.set(name,{size,compressed,offset,flags,method,crc:u32(cursor+16)}); cursor=next;
  }
  if(cursor!==end) reject('Malformed ZIP directory.');
  let expected=0;
  const sorted=[...entries.entries()].sort((a,b)=>a[1].offset-b[1].offset);
  sorted.forEach(([name,e],i)=>{
    const o=e.offset, next=sorted[i+1]?.[1].offset??directory;
    if(o!==expected || o+30>directory || u32(o)!==0x04034b50) reject('Invalid local ZIP entry.');
    const nl=u16(o+26),el=u16(o+28),data=o+30+nl+el,finish=data+e.compressed;
    if(data>next || finish>next || u16(o+6)!==e.flags || u16(o+8)!==e.method || utf8(bytes.subarray(o+30,o+30+nl))!==name) reject('Inconsistent ZIP entry.');
    extras(o+30+nl,el);
    if(e.flags&8) {
      let d=finish; const length=next-finish;
      if(length===16 && u32(d)===0x08074b50) d+=4; else if(length!==12) reject('Invalid ZIP descriptor.');
      if(u32(d)!==e.crc || u32(d+4)!==e.compressed || u32(d+8)!==e.size) reject('Inconsistent ZIP descriptor.');
    } else if(finish!==next || u32(o+14)!==e.crc || u32(o+18)!==e.compressed || u32(o+22)!==e.size) reject('Inconsistent ZIP sizes.');
    expected=next;
  });
  const main=extension==='docx'?'word/document.xml':'xl/workbook.xml';
  if(!entries.has('[Content_Types].xml') || !entries.get(main)?.size || entries.has(extension==='docx'?'xl/workbook.xml':'word/document.xml')) reject('Office format does not match extension.');
  let failure:Error|undefined, actualTotal=0, types='', completed=0, started=0;
  const xmlDecoder=new TextDecoder('utf-8',{fatal:true});
  const unzip=new Unzip(file=>{
    const e=entries.get(file.name); let actual=0;
    if(!e || ++started>count) {failure=new Error('Inconsistent archive.');return;}
    file.ondata=(error,chunk,final)=>{
      if(failure)return;
      actual+=chunk.length;actualTotal+=chunk.length;
      if(error || actual>MAX_ENTRY || actualTotal>MAX_EXPANDED || (file.name==='[Content_Types].xml' && actual>256*1024)) {
        failure=new Error('Archive decompression limit or data error.');file.terminate();return;
      }
      if(file.name==='[Content_Types].xml') types+=xmlDecoder.decode(chunk,{stream:!final});
      if(final) { if(actual!==e.size)failure=new Error('Inconsistent expanded size.'); else completed++; }
    };file.start();
  });
  unzip.register(UnzipInflate);
  try { for(let i=0;i<bytes.length;i+=4096) { const end=Math.min(i+4096,bytes.length);unzip.push(bytes.subarray(i,end),end===bytes.length);if(failure)throw failure;} }
  catch {reject('Invalid Office archive or decompression limit exceeded.');}
  if(failure || completed!==count) reject('Incomplete Office archive.');
  types=types.replace(/&#x([a-f0-9]+);|&#([0-9]+);/gi,(_,hex:string,decimal:string)=>String.fromCodePoint(parseInt(hex||decimal,hex?16:10)));
  if(/macroenabled|vba|macrosheet|<!DOCTYPE|<!ENTITY/i.test(types)) reject('Macro-enabled or unsupported Office XML.');
  types=types.replace(/<!--[\s\S]*?-->/g,'');
  if(!/<(?:\w+:)?Types\b/.test(types) || !types.includes('http://schemas.openxmlformats.org/package/2006/content-types')) reject('Invalid Office content types.');
  const content=extension==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  const overrides=[...types.matchAll(/<(?:\w+:)?Override\b([^<>]*)>/g)];
  if(!overrides.some(m=>{
    const attrs=Object.fromEntries([...m[1].matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/g)].map(a=>[a[1],a[3]]));
    return attrs.PartName==='/'+main && attrs.ContentType===content;
  })) reject('Office main content type does not match extension.');
}
