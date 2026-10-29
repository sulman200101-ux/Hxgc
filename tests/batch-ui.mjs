// Requires npm run dev in another terminal. Uses an isolated browser profile.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.ASMO_TEST_BASE_URL || 'http://127.0.0.1:3000/');
 await page.getByRole('button',{name:'العمليات والتقارير',exact:true}).click();
 await page.getByRole('region',{name:'شاشة العمليات والتقارير',exact:true}).waitFor();
 await page.getByRole('button',{name:'المخزون',exact:true}).click();
 const hint=page.getByText('اسحب لليمين لفتح العمليات والتقارير',{exact:true});
 await hint.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:80,clientY:300}]});
 await hint.dispatchEvent('touchend',{changedTouches:[{identifier:1,clientX:90,clientY:500}]});
 assert.equal(await page.getByRole('button',{name:'المخزون',exact:true}).getAttribute('aria-pressed'),'true');
 await hint.dispatchEvent('touchstart',{touches:[{identifier:1,clientX:80,clientY:300}]});
 await hint.dispatchEvent('touchend',{changedTouches:[{identifier:1,clientX:240,clientY:310}]});
 assert.equal(await page.getByRole('button',{name:'العمليات والتقارير',exact:true}).getAttribute('aria-pressed'),'true');
 const panel=page.getByText('قراءة وحفظ عدة أوراق دفعة واحدة',{exact:true}).locator('..');
 await panel.locator('summary').first().click();
 await panel.getByLabel('اسم مقدم الدفعة').fill('tester');
 await page.getByRole('button',{name:'المخزون',exact:true}).click();
 await page.getByRole('button',{name:'العمليات والتقارير',exact:true}).click();
 assert.equal(await panel.getByLabel('اسم مقدم الدفعة').inputValue(),'tester');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCuoAAAAASUVORK5CYII=','base64');
 await panel.getByLabel('اختيار صور الأوراق').setInputFiles([{name:'sheet-1.png',mimeType:'image/png',buffer:png},{name:'sheet-2.png',mimeType:'image/png',buffer:png}]);
 for(let i=0;i<2;i++) {
  const sheet=panel.locator(`[data-sheet-index="${i}"]`);
  await sheet.getByLabel('رقم مستند الورقة').fill(`PAPER-${i+1}`);
  await sheet.getByRole('button',{name:'إضافة سطر يدوي لهذه الورقة'}).click();
  await sheet.getByLabel('رقم القطعة',{exact:true}).fill('1000000777');
  await sheet.getByLabel('الكمية',{exact:true}).fill('8');
  await sheet.getByLabel('الموقع',{exact:true}).fill('N01B1');
  await sheet.getByLabel('الاسم الأصلي').fill('BOLT M16');
  await sheet.getByLabel('راجعت هذا السطر مقابل الصورة').check();
 }
 await panel.getByRole('button',{name:'حفظ جميع أوراق الدفعة للمراجعة'}).click();
 await panel.getByText('حُفظت 2 أوراق للمراجعة؛ المخزون لم يتغير',{exact:true}).waitFor();
 const readState = async () => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('ASMO_Inventory_DB');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db=req.result; const tx=db.transaction(['items','documents'],'readonly');
    const items=tx.objectStore('items').getAll(); const docs=tx.objectStore('documents').getAll();
    tx.oncomplete=()=>{resolve({items:items.result,docs:docs.result});db.close();};
    tx.onabort=()=>reject(tx.error);
  };
 }));
 const saved=await readState(); const before={stock:saved.items.length,docs:saved.docs.length};
 assert.deepEqual(before,{stock:0,docs:2});
 await panel.getByRole('button',{name:'اعتماد جميع الأوراق المتبقية وتنفيذها'}).click();
 await page.getByRole('textbox',{name:'الرمز',exact:true}).fill('2468');
 await page.getByRole('textbox',{name:'تأكيد الرمز',exact:true}).fill('2468');
 await page.getByRole('button',{name:'اعتماد',exact:true}).click();
 await panel.getByText('تم اعتماد الدفعة وتنفيذها بالكامل',{exact:true}).waitFor();
 const committed=await readState();
 const after={stock:committed.items.length,qty:committed.items[0].qty_remaining,approved:committed.docs.filter(doc=>doc.status==='approved').length,locations:new Set(committed.items.map(item=>item.location_code)).size};
 assert.deepEqual(after,{stock:1,qty:8,approved:2,locations:1});
 assert.deepEqual(errors,[]);
 console.log('PASS multiple image selection, two reviewed drafts, one supervisor approval, preserved originals, no duplicate inventory or locations, no premature stock change');
} finally {await browser.close();}
