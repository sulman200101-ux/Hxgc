// Requires npm run dev. Tests use a fresh browser profile and real offline OCR.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:3000');
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1800;c.height=380;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='44px Arial';x.fillText('Material       Storage Bin     QTY     Material Description',40,90);x.fillText('1001523111     N01B1           12      BOLT M16',40,200);return c.toDataURL();});
 const image=Buffer.from(data.split(',')[1],'base64');
 await page.getByRole('button',{name:'قراءة ورقة أو عدة أوراق'}).click();
 let dialog=page.getByRole('dialog',{name:'قراءة ورقة الجرد'});
 assert.equal(await dialog.getByLabel('اسم مقدم الدفعة').count(),0);
 let choosing=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'التقاط بالكاميرا',exact:true}).click();
 let picker=await choosing;assert.equal(picker.isMultiple(),false);
 assert.equal(await dialog.getByLabel('صورة الكاميرا').getAttribute('capture'),'environment');
 for(const count of [1,2]) {
  choosing=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'اختيار من الألبوم',exact:true}).click();
  picker=await choosing;assert.equal(picker.isMultiple(),true);
  await picker.setFiles(Array.from({length:count},(_,i)=>({name:`sheet-${i}.png`,mimeType:'image/png',buffer:image})));
  await dialog.getByText('انتهت القراءة الأولية؛ راجع كل ورقة وكمية ورقم قطعة مقابل أصلها، وصحح الأوراق غير الواضحة.',{exact:true}).waitFor({timeout:90000});
  assert.equal(await dialog.locator('[data-sheet-index]').count(),count);
  for(let i=0;i<count;i++) {const sheet=dialog.locator(`[data-sheet-index="${i}"]`);assert.equal(await sheet.getByLabel('رقم القطعة',{exact:true}).inputValue(),'1001523111');assert.equal(await sheet.getByLabel('الكمية',{exact:true}).inputValue(),'12');assert.equal(await sheet.getByLabel('راجعت هذا السطر مقابل الصورة').isChecked(),false);}
  await dialog.getByRole('button',{name:'إغلاق قارئ الجرد'}).click();
  if(count===1){await page.getByRole('button',{name:'قراءة ورقة أو عدة أوراق'}).click();dialog=page.getByRole('dialog',{name:'قراءة ورقة الجرد'});}
 }
 await page.getByRole('button',{name:'العمليات والتقارير',exact:true}).click();
 choosing=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'صرف',exact:true}).click();
 picker=await choosing;assert.equal(picker.isMultiple(),false);
 dialog=page.getByRole('dialog',{name:'قراءة ورقة الجرد'});
 await dialog.getByRole('heading',{name:'تصوير ورقة الصرف'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'طلب نقل',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'إغلاق قارئ الجرد'}).click();
 assert.deepEqual(errors,[]);
 console.log('PASS source-first scanner, camera capture picker, multi-select album, automatic real OCR for one/two images, explicit row review');
} finally {await browser.close();}
