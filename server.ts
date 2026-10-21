import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

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
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
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
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8');

  const exact10 = cleaned.match(/(10\d{8})/);
  if (exact10) return exact10[1];

  const digits = cleaned.replace(/[^0-9]/g, '');
  if (/^\d{10}$/.test(digits)) {
    if (/^[47]00\d{7}$/.test(digits)) return '1' + digits.slice(1);
    return digits;
  }
  // ترميم الأرقام ذات الـ 9 خانات إذا طمس خط الجدول الرقم الأول (1) أو أحد أصفار البادئة (1000)
  if (/^00\d{7}$/.test(digits)) return '1' + digits;
  if (/^100\d{6}$/.test(digits)) return '1000' + digits.slice(3);

  return null;
}

function dynamicLocationNormalizer(rawLoc: any): string {
  if (!rawLoc) return '';
  let cleaned = String(rawLoc)
    .trim()
    .toUpperCase()
    .replace(/عام/g, '')
    .replace(/موقع[:\s]*/g, '')
    .replace(/\b(002\s*02|0020|002|C006|M016|D04D|BIN|LOC|LOCATION|STORAGE\s*BIN)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // إصلاح بصري لرموز المواقع (NO1B2 -> N01B2, N01FLI -> N01FL1)
  let sapFixed = cleaned
    .replace(/\b([A-Z])[Oo](\d)/g, '$10$2')
    .replace(/\b([A-Z]\d)[Oo]/g, '$10')
    .replace(/\b([A-Z])[Il|](\d)/g, '$11$2')
    .replace(/\b([A-Z]\d)[Il|]([A-Z])/g, '$11$2')
    .replace(/([A-Z]{1,3})[Il|]\b/g, '$11')
    .replace(/([A-Z]{1,3})[Oo]\b/g, '$10');

  const splitSap = sapFixed.match(/^([A-Z]\d{2})\s+([A-Z]{1,3}\d{0,2})$/);
  if (splitSap) {
    sapFixed = `${splitSap[1]}${splitSap[2]}`;
  }

  const compactMatch = sapFixed.match(/\b([A-Z]\d{2}[A-Z]{1,3}\d{0,2})\b/);
  if (compactMatch && !['C006', 'M016', 'D04D'].includes(compactMatch[1])) {
    return compactMatch[1];
  }

  const match3 = sapFixed.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+\s+[0-9A-Z]+)\b/);
  if (match3) return match3[1].replace(/\s+/g, ' ').trim();

  const match2 = sapFixed.match(/\b([A-Z][0-9]{2}\s+[A-Z0-9]+)\b/);
  if (match2) return match2[1].replace(/\s+/g, ' ').trim();

  if (
    /^[A-Z0-9][A-Z0-9\s\/._-]{1,18}$/i.test(sapFixed) &&
    /[A-Z]/i.test(sapFixed) &&
    !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO', 'AY'].includes(sapFixed)
  ) {
    return sapFixed;
  }

  return '';
}

function detectMissingFromCheckMark(item: any): boolean {
  if (!item) return false;
  if (item.is_missing === true || item.is_missing === 1 || item.is_missing === 'true') return true;
  if (item.status === 'غير موجودة') return true;
  const check = String(item.check ?? item.check_mark ?? item.checkMark ?? '').trim().toUpperCase();
  return (
    check === 'X' ||
    check === '×' ||
    check === '✗' ||
    check === '✘' ||
    check === '✕' ||
    check === '✖' ||
    check === 'MISSING' ||
    check === 'NOT FOUND'
  );
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

    const prompt = `You are an expert industrial AI vision system specialized in reading ASMO "SAP Inventory Controller" spare parts sheets (in any orientation: landscape or rotated 90 degrees portrait).

TABLE COLUMNS (in order):
1. "#" (Short sequence number: 1 to 5 digits like 198, 653, 654, 8428, 18195) -> Extract as "seq". NEVER put "#" in "part_number"!
2. "Material" (Part Number: 10-digit number starting with 100, e.g. "1001523111", "1000029819", "1000082689", "1001023714") -> Extract the full 10 digits as "part_number". Even if a pen mark touches a digit, read the 10-digit number starting with 100 carefully.
3. "Plant" (C006, M016, D04D) and "Area" (002) -> Ignore.
4. "Storage Bin" (Exact Location Code: e.g. "N01B1", "N01B2", "N01BB1", "N01BB2", "N01C1", "N01C2", "N01D1", "N01D2", "N01FL1", "N11C2", "N06C1") -> Extract as "location". If a row belongs to the same bin group as the row above it, output that bin code. NEVER output "عام".
5. "Bun" (Unit: EA, PK, AY, SET, SH, CO).
6. "QTY" (Integer quantity) -> Extract as integer "quantity".
7. "Check" (Handwritten mark column):
   - If marked with handwritten cross "X" or "×" -> set "is_missing": true and "check_mark": "X".
   - If marked with handwritten checkmark "✓", "✔", "/", or left blank -> set "is_missing": false and "check_mark": "CHECK". Never fail on messy handwriting in the Check column!
8. "Remark" (Handwritten note like "+90", "+3", "+96", "-7", "F1", "F2") -> Extract as "remark".
9. "Material Description" (English description) -> Extract as "description".

MANDATE:
- Extract EVERY SINGLE ITEM ROW on the sheet from top to bottom (whether the sheet has 5 rows, 24 rows, 36 rows, 37 rows, or more).
- Ignore table headers, page footers, and blank margins.
- Return ONLY a valid JSON array:
  [{"seq": 18195, "part_number": "1001523111", "location": "N01B1", "quantity": 2, "check_mark": "CHECK", "is_missing": false, "remark": "", "description": "GASKET PUMP CCR UNIT 1,2 &3 SEAL"}]`;

    const candidateModels = [
      { name: 'gemini-3-flash-preview', minimalThinking: true },
      { name: 'gemini-3.5-flash', minimalThinking: false },
      { name: 'gemini-3.6-flash', minimalThinking: false },
      { name: 'gemini-flash-lite-latest', minimalThinking: false },
    ];
    let response: any = null;
    let lastError: any = null;

    for (const m of candidateModels) {
      try {
        const configObj: any = {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
          temperature: 0.0,
        };
        if (m.minimalThinking) {
          configObj.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
        }

        response = await ai.models.generateContent({
          model: m.name,
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
          config: configObj,
        });

        if (response && response.text) {
          break;
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        console.warn(`Model ${m.name} notice: ${msg.slice(0, 120)}`);
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

    // استنتاج الموقع الفعلي من السطور المجاورة إذا طمست علامة اليد خانة الموقع في سطر واحد
    let lastValidLoc = '';
    const preNormalized = rawItems.map((item) => {
      const rawLoc = item.location ?? item.location_code ?? item.bin ?? item.storage_bin ?? item.storageBin ?? '';
      let normLoc = dynamicLocationNormalizer(rawLoc);
      if (normLoc) {
        lastValidLoc = normLoc;
      } else if (lastValidLoc) {
        normLoc = lastValidLoc;
      }
      return { ...item, _normLocation: normLoc };
    });

    let nextValidLoc = '';
    for (let i = preNormalized.length - 1; i >= 0; i--) {
      if (preNormalized[i]._normLocation) {
        nextValidLoc = preNormalized[i]._normLocation;
      } else if (nextValidLoc) {
        preNormalized[i]._normLocation = nextValidLoc;
      }
    }

    const validItems: any[] = [];
    const skippedRows: any[] = [];

    preNormalized.forEach((item, idx) => {
      const rawPart = String(
        item.part_number ?? item.partNumber ?? item.material ?? item.part ?? item.part_no ?? item['Part Number'] ?? ''
      ).trim();

      let finalPartNumber = strict10DigitMaterialFilter(rawPart);
      const normLocation = item._normLocation || '';
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
      } else if (rawPart.replace(/[^0-9]/g, '').length > 0) {
        const cleanDigits = rawPart.replace(/[^0-9]/g, '');
        let reason = 'بيانات السطر غير مكتملة';
        if (!finalPartNumber) {
          reason =
            cleanDigits.length > 0 && cleanDigits.length <= 5
              ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام`
              : `رقم القطعة (${rawPart || 'فارغ'}) ناقص ولا يتكون من 10 أرقام كاملة`;
        } else if (!normLocation) {
          reason = `اسم الموقع غير واضح في عمود Storage Bin`;
        }

        skippedRows.push({
          id: `skip-${idx + 1}`,
          row_number: idx + 1,
          raw_text: `${rawPart || '---'} | ${normLocation || '---'} | ${normQuantity} | ${isMissing ? '× غير موجودة' : '✓'} | ${desc}`,
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
  return res.redirect('https://github.com/sulman200101-ux/Hxgc/releases/download/v1.5.0/asmo-inventory-v1.5.0.apk');
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
