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

  // SAP Storage Bin compact format (e.g. N11C2, N11D1, N11FL1, N11FL2, N12A1, N06BB2, N06C, N06C1, N07A1)
  const compactMatch = cleaned.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactMatch && !['C006', 'M016', 'D04D'].includes(compactMatch[1])) {
    return compactMatch[1];
  }

  const match3 = cleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/);
  if (match3) return match3[1].replace(/\s+/g, ' ').trim();

  const match2 = cleaned.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+)\b/);
  if (match2) return match2[1].replace(/\s+/g, ' ').trim();

  if (/^[A-Z][A-Z0-9\s-]{1,14}$/i.test(cleaned) && !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO'].includes(cleaned)) {
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

    const prompt = `You are an expert AI vision system specialized in reading ASMO "SAP Inventory Controller" paper sheets and spare parts tables (even if the photo is rotated 90 degrees / vertical portrait).

CRITICAL TABLE COLUMN RULES:
The SAP Inventory Controller table has these columns in order:
1. "#" (Row sequence number: 3 to 5 digits like 8428, 8429, 8650, 11470, 1756, 627) -> IGNORE THIS COLUMN! NEVER output "#" as part_number!
2. "Material" (Part Number: ALWAYS a 10-digit number starting with 100, e.g. "1001023714", "1000995878", "1000238028", "1001122026") -> Extract the COMPLETE 10 digits as "part_number". Never copy incomplete numbers.
3. "Plant" (e.g. C006, M016, D04D) and "Area" (e.g. 002) -> Do NOT confuse these with Storage Bin.
4. "Storage Bin" (Exact Location Code: e.g. "N11C2", "N11D1", "N11D2", "N11FL1", "N11FL2", "N12A1", "N12A2", "N06BB2", "N06C", "N06C1", "N06C2", "N06D2", "N06FL1", "N06FL2", "N07A1") -> Extract the exact bin code for each row as "location". NEVER return "عام" or "General".
5. "Bun" (Unit: EA, SET, PK, SH, CO).
6. "QTY" (Integer quantity: e.g. 1, 2, 4, 6, 8, 10, 11, 16, 20, 120) -> Extract as integer "quantity".
7. "Check" (Handwritten mark column):
   - Inspect the handwritten mark in the "Check" column carefully for EVERY row:
   - If the row has a handwritten "X" / "×" / cross mark (indicating the part is NOT FOUND / missing), set "check_mark": "X" and "is_missing": true.
   - If the row has a handwritten checkmark "✓" or is normal, set "check_mark": "CHECK" and "is_missing": false.
8. "Remark" (e.g. "F1", "-4", "F2", or empty) -> Extract as "remark".
9. "Material Description" (Full English description of the spare part, e.g. "BALL VALVE, SIZE 1/2 INCH, MATERIAL STAI") -> Extract as "description".

MANDATE:
- Extract EVERY SINGLE ROW from top to bottom without skipping or truncating any row.
- Return ONLY a valid JSON array of objects with keys:
  [{"part_number": "1001023714", "location": "N11C2", "quantity": 6, "check_mark": "CHECK", "is_missing": false, "remark": "F1", "description": "GASKET, SIZE 10 INCH"}]`;

    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.8-flash',
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
        message: 'تعذر تحليل الصورة عبر الذكاء الاصطناعي، يرجى المحاولة مرة أخرى.',
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

      const finalPartNumber = strict10DigitMaterialFilter(rawPart);
      const rawLoc = item.location ?? item.location_code ?? item.bin ?? item.storage_bin ?? item.storageBin ?? '';
      const normLocation = dynamicLocationNormalizer(rawLoc);
      const rawQty = item.quantity ?? item.qty ?? item.total_qty ?? item.stock ?? 1;
      const normQuantity = charToDigitMapper(rawQty, 1);
      const isMissing = detectMissingFromCheckMark(item);
      const remark = item.remark ? String(item.remark).trim() : undefined;
      const desc = String(
        item.description ?? item.description_en ?? item.desc ?? item.name ?? item['Description'] ?? 'SPARE PART ASMO'
      ).trim();

      if (finalPartNumber && normLocation) {
        validItems.push({
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
        let reason = 'بيانات السطر غير مكتملة';
        if (!finalPartNumber) {
          reason =
            cleanDigits.length > 0 && cleanDigits.length <= 5
              ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام`
              : `رقم القطعة (${rawPart || 'فارغ'}) ناقص ولا يتكون من 10 أرقام كاملة`;
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
      success: true,
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
  return res.redirect('https://github.com/sulman200101-ux/965545664-_/releases/download/v1.0.0/asmo-inventory-release.apk');
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
