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
  const upright=await processOcrFromImage(canvas.toDataURL());
  const {rotateImageDegrees}=await import('/src/utils/imagePreprocessor.ts');
  const sideways=await processOcrFromImage(await rotateImageDegrees(canvas.toDataURL(),90));
  const {parseStrictAsmoTable,extractStrictQuantity}=await import('/src/utils/strictTableParser.ts');
  return {upright,sideways,duplicates:parseStrictAsmoTable('2861 1000428938 M016 002 N12A2 PK 3 TIE CABLE 1.6 MM\n2809 1000428938 M016 002 N12A2 PK 6 TIE CABLE 1.6 MM'),paa:extractStrictQuantity('1000129631 M016 002 N17A1 PAA 5 GLOVES','1000129631','N17A1'),zyd:extractStrictQuantity('1001064248 M016 002 N16D2 ZYD 7 F2 GASKET','1001064248','N16D2')};
 });
 console.log(JSON.stringify(result));
 assert.equal(result.duplicates.length,2);assert.deepEqual(result.duplicates.map(row=>row.qty_total),[3,6]);
 assert.equal(result.paa.total,5);assert.equal(result.zyd.total,7);
 for(const rows of [result.upright,result.sideways]) assert.ok(rows.some(row=>row.part_number==='1001523111' && row.location_code==='N01B1' && row.qty_total===12 && row.description_en.includes('M16')));
 console.log('PASS upright/sideways OCR and SAP PAA/ZYD quantity columns with external network blocked');
} finally {await browser.close();}
