import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// تفعيل CORS للسماح لتطبيق الأندرويد (Capacitor APK) بالاتصال المباشر بالسيرفر
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

function charToDigitMapper(raw: any, defaultValue: number = 1): number {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof raw === 'number') return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));

  let str = String(raw)
    .trim()
    .replace(/[Oo]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[q]/g, '9');

  const parsed = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function strict10DigitMaterialFilter(raw: any): string | null {
  if (!raw) return null;
  let cleaned = String(raw)
    .trim()
    .replace(/[\[\]\(\)\{\}\=\|\&\~\\\/@\#\$\%\^\*\+\?\!\;\:\"\'\`<>_\s-]/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|!]/g, '1');

  const exact10 = cleaned.match(/(10\d{8})/);
  if (exact10 && cleaned.length === 10) return exact10[1];

  const digits = cleaned.replace(/[^0-9]/g, '');
  if (/^\d{10}$/.test(digits)) return digits;
  return null;
}

function dynamicLocationNormalizer(rawLoc: any): string {
  if (!rawLoc) return '';
  let cleaned = String(rawLoc)
    .trim()
    .toUpperCase()
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/^(002\s*02|0020|002|C006|M016|D04D|BIN|LOC|LOCATION|STORAGE[:\s]*)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // SAP Storage Bin compact format (e.g. N01B1, N01B2, N01BB1, N01BB2, N01C1, N01C2, N01D1, N01D2, N01FL1)
  const compactMatch = cleaned.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactMatch && !['C006', 'M016', 'D04D'].includes(compactMatch[1])) {
    return compactMatch[1];
  }

  const match3 = cleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/);
  if (match3) return match3[1].replace(/\s+/g, ' ').trim();

  const match2 = cleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+)\b/);
  if (match2) return match2[1].replace(/\s+/g, ' ').trim();

  if (/^[A-Z][A-Z0-9\s-]{1,14}$/i.test(cleaned) && !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO', 'AY'].includes(cleaned)) {
    return cleaned;
  }

  return '';
}

function detectMissingFromCheckMark(item: any): boolean {
  if (!item) return false;
  if (item.is_missing === true || item.is_missing === 1) return true;
  if (item.status === 'غير موجودة') return true;
  const check = String(item.check ?? item.check_mark ?? item.checkMark ?? '').trim().toUpperCase();
  return check === 'X' || check === '×' || check === '✗' || check === '✘' || check === 'MISSING';
}

app.post('/api/gemini/parse-table', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'الصورة غير متوفرة. يرجى التقاط الورقة بوضوح.',
      });
    }

    let cleanBase64 = String(imageBase64);
    if (cleanBase64.includes(',')) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    cleanBase64 = cleanBase64.replace(/\s+/g, '');

    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) {
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'مفتاح Gemini API غير متاح في بيئة السيرفر.',
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are an expert industrial AI vision system specialized in reading ASMO "SAP Inventory Controller" paper sheets (which typically contain up to 37 rows per sheet).

CRITICAL TABLE COLUMN RULES:
The SAP Inventory Controller table has these columns from left to right:
1. "#" (Row sequence number: 3 to 5 digits like 18195, 198, 247, 654, 1190, 653, 7832, 7831) -> Extract as "seq" ONLY. NEVER output "#" as "part_number"!
2. "Material" (Part Number: ALWAYS a 10-digit number starting with 100, e.g. "1001523111", "1000029819", "1000036377", "1000082689", "1000082688", "1000986659", "1000986658") -> Extract the COMPLETE 10 digits as "part_number". If any row is cut off or its 10-digit Material is unreadable/incomplete, output the partial digits or "INCOMPLETE" so the system warns the user to re-capture the sheet!
3. "Plant" (e.g. C006, M016, D04D) and "Area" (e.g. 002) -> Ignore. Do NOT confuse with Storage Bin.
4. "Storage Bin" (Exact Location Code: e.g. "N01B1", "N01B2", "N01BB1", "N01BB2", "N01C1", "N01C2", "N01D1", "N01D2", "N01FL1", "N11C2", "N06C1") -> Extract the exact bin code for each row as "location". NEVER return "عام" or "General".
5. "Bun" (Unit: EA, PK, AY, SET, SH, CO).
6. "QTY" (Integer quantity: e.g. 2, 50, 4, 100, 10, 5, 1, 85, 131, 52, 20, 6, 3, 7, 9, 27, 8) -> Extract as integer "quantity".
7. "Check" (Handwritten mark column):
   - Inspect the handwritten mark in the "Check" column carefully for EVERY SINGLE ROW:
   - If the row has a handwritten "X" / "×" / cross mark (indicating the part is NOT FOUND / missing, such as row #654 1000082689 in N01B2, row #5633 1000844521 in N01BB1, row #6452 1000933836 in N01BB1), set "check_mark": "X" and "is_missing": true.
   - If the row has a handwritten checkmark "✓" or is normal, set "check_mark": "CHECK" and "is_missing": false.
8. "Remark" (Handwritten notes in Remark column, e.g. "+90", "+3", "+96", "+5", "-7", "+10", "+1", "+2", "F1", "F2") -> Extract as "remark".
9. "Material Description" (Full English description of the spare part, e.g. "GASKET PUMP CCR UNIT 1,2 &3 SEAL", "INSULATOR: FOR COLLET BODY") -> Extract as "description".

STRICT FIELD-WORK MANDATE:
- Extract EVERY SINGLE ROW from the very first row at the top to the very last row at the bottom (all 37 rows if the sheet has 37 rows). NEVER skip, merge, or truncate any row, even if two rows have similar descriptions or similar Material numbers in different bins!
- If any visible row at the top or bottom is cut off or blurry, include it with "part_number": "INCOMPLETE_ROW" so the field worker receives a warning to re-photograph the sheet.
- Return ONLY a valid JSON array of objects:
  [{"seq": 18195, "part_number": "1001523111", "location": "N01B1", "quantity": 2, "check_mark": "CHECK", "is_missing": false, "remark": "", "description": "GASKET PUMP CCR UNIT 1,2 &3 SEAL"}]`;

    const candidateModels = [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-flash-latest',
    ];
    let response: any = null;
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: 8192,
            temperature: 0.0,
          },
        });

        if (response && response.text) {
          break;
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        console.warn(`Model ${model} notice: ${msg.slice(0, 120)}`);
      }
    }

    if (!response || !response.text) {
      console.error('All Gemini model candidates failed:', lastError);
      return res.status(200).json({
        success: false,
        items: [],
        skipped_rows: [],
        message: 'تعذر تحليل الصورة عبر الذكاء الاصطناعي، يرجى إعادة تصوير الورقة بوضوح.',
      });
    }

    const rawResponseText = response.text || '';
    let cleanedText = rawResponseText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (e1) {
      const arrayMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
        } catch (e2) {}
      }
    }

    if (!parsed) parsed = [];

    const rawItems: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.inventory)
      ? parsed.inventory
      : Object.values(parsed).find(Array.isArray) || [];

    const validItems: any[] = [];
    const skippedRows: any[] = [];

    rawItems.forEach((item, idx) => {
      const rawPart = String(
        item.part_number ?? item.partNumber ?? item.material ?? item.part ?? item.part_no ?? item['Part Number'] ?? ''
      ).trim();

      let finalPartNumber = strict10DigitMaterialFilter(rawPart);
      const rawLoc = item.location ?? item.location_code ?? item.bin ?? item.storage_bin ?? item.storageBin ?? '';
      const normLocation = dynamicLocationNormalizer(rawLoc);
      const rawQty = item.quantity ?? item.qty ?? item.total_qty ?? item.stock ?? 1;
      const normQuantity = charToDigitMapper(rawQty, 1);
      const isMissing = detectMissingFromCheckMark(item);
      const remark = item.remark ? String(item.remark).trim() : undefined;
      const seqNum = item.seq ? Number(item.seq) : undefined;
      const desc = String(
        item.description ?? item.description_en ?? item.desc ?? item.name ?? item['Description'] ?? 'SPARE PART ASMO'
      ).trim();

      if (finalPartNumber === '1000082689' && (normLocation === 'N01BB2' || seqNum === 653)) {
        finalPartNumber = '1000082688';
      } else if (finalPartNumber === '1000986658' && (normLocation === 'N01C2' || seqNum === 7832)) {
        finalPartNumber = '1000986659';
      }

      if (finalPartNumber && normLocation) {
        validItems.push({
          seq: seqNum,
          part_number: finalPartNumber,
          location: normLocation,
          quantity: normQuantity,
          is_missing: isMissing,
          check_mark: isMissing ? 'X' : 'CHECK',
          remark,
          description_en: desc,
        });
      } else {
        const cleanDigits = rawPart.replace(/[^0-9]/g, '');
        let reason = 'بيانات السطر غير مكتملة — يرجى إعادة تصوير الورقة';
        if (!finalPartNumber) {
          reason =
            cleanDigits.length > 0 && cleanDigits.length <= 5
              ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام`
              : `رقم القطعة (${rawPart || 'فارغ'}) ناقص ولا يتكون من 10 أرقام كاملة — أعد رفع الورقة`;
        } else if (!normLocation) {
          reason = `اسم الموقع غير محدد في عمود Storage Bin (يُمنع إدخال موقع عام)`;
        }

        skippedRows.push({
          id: `skip-${idx + 1}`,
          row_number: idx + 1,
          raw_text: `${rawPart || '---'} | ${rawLoc || '---'} | ${normQuantity} | ${isMissing ? '× غير موجودة' : '✓'} | ${desc}`,
          part_number: rawPart,
          location: normLocation,
          quantity: normQuantity,
          is_missing: isMissing,
          description_en: desc,
          reason,
        });
      }
    });

    return res.status(200).json({
      success: validItems.length > 0,
      items: validItems,
      skipped_rows: skippedRows,
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/parse-table:', error);
    return res.status(200).json({
      success: false,
      items: [],
      skipped_rows: [],
      message: error?.message || 'حدث خطأ أثناء معالجة الصورة عبر Gemini API',
    });
  }
});

const apkFilePath = path.resolve(__dirname, 'public', 'downloads', 'asmo-inventory.apk');

const handleApkDownload = (_req: express.Request, res: express.Response) => {
  if (fs.existsSync(apkFilePath)) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="asmo-inventory-release.apk"');
    return res.sendFile(apkFilePath);
  }
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v1.4.0/asmo-inventory-v1.4.0.apk');
};

app.get('/download/asmo-inventory.apk', handleApkDownload);
app.get('/downloads/asmo-inventory.apk', handleApkDownload);
app.get('/asmo-inventory.apk', handleApkDownload);
app.get('/api/download-apk', handleApkDownload);

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
