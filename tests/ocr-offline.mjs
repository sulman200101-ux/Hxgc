// Requires the development server and prepared local OCR assets.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:3000');
 const result=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=380;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1800,380);ctx.fillStyle='black';ctx.font='44px Arial';
  ctx.fillText('Material       Storage Bin     QTY     Material Description',40,90);
  ctx.fillText('1001523111     N01B1           12      BOLT M16',40,200);
  const {processOcrFromImage}=await import('/src/services/localOcr.ts');
  return processOcrFromImage(canvas.toDataURL());
 });
 console.log(JSON.stringify(result));
 assert.ok(result.some(row=>row.part_number==='1001523111' && row.location_code==='N01B1' && row.qty_total===12 && row.description_en.includes('M16')));
 console.log('PASS actual OCR with all external network requests blocked');
} finally {await browser.close();}
