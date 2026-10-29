import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

let isGeminiKeyUnsupported = false;

function charToDigitMapper(raw: any, defaultValue: number = 1): number {
  if (raw === null || raw === undefined) return defaultValue;
  if (typeof raw === 'number') return isNaN(raw) ? defaultValue : Math.max(0, Math.floor(raw));

  const str = String(raw)
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
  let value = String(raw ?? '').trim();
  if (/^\d{10}$/.test(value)) return value;
  const repaired = value
    .replace(/[OoQD]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss$]/g, '5')
    .replace(/[Gg]/g, '6')
    .replace(/[Bb]/g, '8')
    .replace(/[^0-9]/g, '');
  if (/^10\d{8}$/.test(repaired)) return repaired;
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
    !['C006', 'M016', 'D04D', 'EA', 'SET', 'PK', 'SH', 'CO', 'AY', 'PAA', 'ZYD'].includes(sapFixed)
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

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    // التحقق من صلاحية صيغة المفتاح أو حالة عدم التطابق لتجنب أخطاء 401 المتكررة والتحويل الفوري للقارئ المحلي
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || !apiKey.startsWith('AIza') || isGeminiKeyUnsupported) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'يتم استخدام محرك القراءة المحلي الذكي.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `You are an expert industrial AI vision system specialized in reading ASMO "SAP Inventory Controller" spare parts sheets (whether upright landscape or rotated 90 degrees portrait/sideways).

TABLE COLUMNS (in order):
1. "#" (Short sequence number: 1 to 5 digits like 496, 1162, 5466, 11470, 18195) -> Extract as integer "seq". NEVER put "#" in "part_number"!
2. "Material" (Part Number: 10-digit number starting with 100, e.g. "1001023714", "1001032639", "1001011116", "1000428938") -> Extract the exact 10 digits as "part_number". Even if a pen mark touches a digit, read the 10-digit number starting with 100 carefully.
3. "Plant" (C006, M016, D04D) and "Area" (002) -> Ignore.
4. "Storage Bin" (Exact Location Code: e.g. "N11C2", "N11D1", "N11D2", "N11FL1", "N11FL2", "N12A1", "N12A2", "N16D1", "N16D2", "N17A1", "N17A2", "N17B1") -> Extract as "location". Never output "عام".
5. "Bun" (Unit: EA, PK, AY, SET, SH, CO, PAA, ZYD).
6. "QTY" (Integer quantity) -> Extract as integer "quantity".
7. "Check" (Handwritten mark column):
   - If marked with handwritten cross "X" or "×" -> set "is_missing": true and "check_mark": "X".
   - If marked with handwritten checkmark "✓", "✔", "/", -> set "is_missing": false and "check_mark": "✓".
   - If blank -> set "is_missing": false and "check_mark": "".
8. "Remark" (Handwritten note like "F1", "F2", "F3", "F5", "F20", "-4", "SET", "+90") -> Extract as "remark".
9. "Material Description" (Full English technical description including sizes, grades, and dimensions) -> Extract as "description".

MANDATE:
- Extract EVERY SINGLE ITEM ROW on the sheet from top to bottom (e.g. all 29 rows on the sheet), preserving repeated Material rows if a part appears twice on the sheet.
- Ignore table headers, page footers (e.g. Page 27 of 43), and blank margins.`;

    const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    let response: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
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
            ...(modelName === 'gemini-3.8-flash'
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  seq: { type: Type.INTEGER },
                  part_number: { type: Type.STRING },
                  location: { type: Type.STRING },
                  quantity: { type: Type.INTEGER },
                  check_mark: { type: Type.STRING },
                  is_missing: { type: Type.BOOLEAN },
                  remark: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
              },
            },
          },
        });

        if (response && response.text) {
          break;
        }
      } catch (err: any) {
        const errMsg = String(err?.message || err || '');
        if (
          err?.status === 401 ||
          err?.status === 403 ||
          errMsg.includes('401') ||
          errMsg.includes('UNAUTHENTICATED') ||
          errMsg.includes('API key not valid') ||
          errMsg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')
        ) {
          isGeminiKeyUnsupported = true;
          break;
        }
      }
    }

    if (!response || !response.text) {
      return res.status(200).json({
        success: false,
        fallbackToLocal: true,
        items: [],
        skipped_rows: [],
        message: 'تعذر تحليل الصورة عبر السيرفر، جاري التحويل للمحرك المحلي.',
      });
    }

    const rawResponseText = response.text || '[]';
    const cleanedText = rawResponseText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: any = [];
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const arrayMatch = cleanedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
        } catch {}
      }
    }

    const rawItems: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
      ? parsed.items
      : [];

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
        item.part_number ?? item.partNumber ?? item.material ?? item.part ?? ''
      ).trim();

      const finalPartNumber = strict10DigitMaterialFilter(rawPart);
      const normLocation = item._normLocation || '';
      const rawQty = item.quantity ?? item.qty ?? item.total_qty ?? 1;
      const normQuantity = charToDigitMapper(rawQty, 1);
      const isMissing = detectMissingFromCheckMark(item);
      const rawCheck = String(item.check_mark ?? item.check ?? '').trim();
      const checkMark = isMissing
        ? 'X'
        : /^(✓|✔|\/|CHECK)$/i.test(rawCheck)
        ? '✓'
        : '';
      const remark = item.remark ? String(item.remark).trim() : '';
      const seqNum = item.seq ? Number(item.seq) : undefined;
      const desc = String(
        item.description ?? item.description_en ?? item.desc ?? 'SPARE PART ASMO'
      ).trim();

      if (finalPartNumber && normLocation) {
        validItems.push({
          seq: seqNum,
          part_number: finalPartNumber,
          location: normLocation,
          location_code: normLocation,
          quantity: normQuantity,
          qty_total: normQuantity,
          is_missing: isMissing ? 1 : 0,
          check_mark: checkMark,
          remark,
          description_en: desc,
        });
      } else if (rawPart.replace(/[^0-9]/g, '').length > 0) {
        const cleanDigits = rawPart.replace(/[^0-9]/g, '');
        const reason = !finalPartNumber
          ? cleanDigits.length <= 5
            ? `الرقم (${cleanDigits}) هو رقم التسلسل (#) وليس رقم القطعة المكون من 10 أرقام`
            : `رقم القطعة (${rawPart}) ناقص ولا يتكون من 10 أرقام كاملة`
          : `اسم الموقع غير واضح في عمود Storage Bin`;

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
      message: error?.message || 'حدث خطأ أثناء معالجة الصورة عبر السيرفر',
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
