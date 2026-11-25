// Requires npm run dev. Generates isolated synthetic inventory, not stored user data.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:3000');
 const downloading=page.waitForEvent('download',{timeout:240000});downloading.catch(()=>{});
 const stats=await page.evaluate(async()=>{
  HTMLCanvasElement.prototype.toDataURL=()=>{throw new Error('Large report must not rasterize the full table');};
  let ticks=0;let done=0;let maximumGap=0;let last=performance.now();const started=last;
  const timer=setInterval(()=>{const now=performance.now();maximumGap=Math.max(maximumGap,now-last);last=now;ticks++;},20);
  try {
   const {exportCategoryToPdfFile}=await import('/src/utils/pdfExportUtil.ts');
   const items=Array.from({length:7500},(_,index)=>({part_number:String(1002000000+index),location_code:'N01B1',description_en:`HEXAGON HEAD BOLT M16 X 70 MM SS316 #${index}`,description_ar:'مسمار رأس سداسي M16 X 70 MM SS316',category:'مسامير وروابط',qty_total:20,qty_out:3,qty_remaining:17,is_moved:0,status:'غير مدقق'}));
   const file=await exportCategoryToPdfFile({categoryName:'مسامير وروابط',items,onProgress:value=>{done=value;}});
   return {ticks,done,maximumGap,bytes:file.size,elapsedMs:performance.now()-started};
  } finally {clearInterval(timer);}
 });
 const download=await downloading;const path='/tmp/asmo-7500.pdf';await download.saveAs(path);
 const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:20*1024*1024});
 const codes=new Set(text.match(/100200\d{4}/g)||[]);
 assert.ok(text.includes('HEXAGON HEAD BOLT M16 X 70 MM SS316'));assert.equal(stats.done,7500);assert.ok(stats.ticks>10);assert.equal(codes.size,7500);assert.ok(text.includes('1002000000')&&text.includes('1002007499'));assert.deepEqual(errors,[]);
 console.log('PASS all 7500 unique part numbers exported across PDF pages; no whole-table canvas; UI heartbeat remained active');console.log(JSON.stringify(stats));console.log(execFileSync('pdfinfo',[path],{encoding:'utf8'}));
} catch(error) {console.error(error);process.exitCode=1;} finally {await browser.close();}
