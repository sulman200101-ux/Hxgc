#!/usr/bin/env python3
"""
محرك بايثون الذكي لقراءة جداول جرد أسمو (ASMO Python OpenCV + OCR Table Engine)
يستغني بالكامل عن Gemini API ويعمل محلياً 100% عبر مكتبات الذكاء البصري في بايثون:
- OpenCV (cv2) + NumPy للمعالجة المورفولوجية، إزالة الظلال، تدوير الورقة، وحذف خطوط الشبكة مع حفظ الحروف
- Tesseract C++ Engine (أو RapidOCR/PaddleOCR عند توفرها) مع التقسيم المتوازي متعدد الأنوية (Multi-Core ThreadPool)
- خوارزمية التصحيح البصري لـ 10 أرقام (normalize_sap_material) وتنعيم الساندويتش السياقي للمواقع (Sandwich Context Resolver)
"""

import sys
import os
import re
import json
import base64
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import cv2
import pytesseract

os.environ.setdefault("OMP_THREAD_LIMIT", "1")


def decode_image_from_input(input_data: str) -> np.ndarray:
    """قراءة الصورة من مسار ملف أو من سلسلة Base64"""
    if os.path.exists(input_data):
        img = cv2.imread(input_data, cv2.IMREAD_GRAYSCALE)
        if img is not None:
            return img
    b64_str = input_data.strip()
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    raw_bytes = base64.b64decode(b64_str)
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("تعذر فك تشفير الصورة في محرك بايثون")
    return img


def preprocess_table_image_opencv(img_gray: np.ndarray) -> np.ndarray:
    """
    خوارزمية الرؤية الحاسوبية في بايثون (OpenCV Pipeline):
    1. تدوير الصور الطولية 90° عكس عقارب الساعة
    2. تكبير فائق الوضوح (Cubic 1.6x)
    3. موازنة الإضاءة الموضعية وإزالة الظلال (Gaussian Retinex Division)
    4. زيادة حدة الحروف والأرقام الدقيقة في الزوايا (Unsharp Masking)
    5. عزل وحذف خطوط الشبكة الأفقية والعمودية مع حماية ضربات الحروف المتقاطعة (Stroke-Preserving Morphological Grid Removal)
    """
    h, w = img_gray.shape[:2]
    if h > w * 1.05:
        img_gray = cv2.rotate(img_gray, cv2.ROTATE_90_COUNTERCLOCKWISE)

    up = cv2.resize(img_gray, (0, 0), fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
    bg = cv2.GaussianBlur(up, (45, 45), 0)
    norm = cv2.divide(up, bg, scale=255)

    blur = cv2.GaussianBlur(norm, (0, 0), 1.2)
    sharp = cv2.addWeighted(norm, 1.6, blur, -0.6, 0)

    bw = (sharp < 205).astype(np.uint8) * 255
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (55, 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 45))
    h_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, hk) > 0
    v_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, vk) > 0

    cleaned = sharp.copy()
    keep_h = (
        ((np.roll(sharp, -3, axis=0) < 200) | (np.roll(sharp, -4, axis=0) < 200))
        & ((np.roll(sharp, 3, axis=0) < 200) | (np.roll(sharp, 4, axis=0) < 200))
    )
    for dy in (-2, -1, 0, 1, 2):
        sh = np.roll(h_lines, dy, axis=0)
        cleaned[sh & ~keep_h] = 255

    for dx in (-2, -1, 0, 1, 2):
        sv = np.roll(v_lines, dx, axis=1)
        cleaned[sv] = 255

    cleaned = np.clip((cleaned.astype(np.float32) - 115.0) * (255.0 / 125.0), 0, 255).astype(np.uint8)
    return cleaned


def normalize_sap_prefix(code10: str) -> str:
    if not re.match(r"^\d{10}$", code10):
        return code10
    if re.match(r"^100[743]\d{6}$", code10):
        return "1001" + code10[4:]
    if re.match(r"^190[01]\d{6}$", code10):
        return "100" + code10[3:]
    if re.match(r"^109[01]\d{6}$", code10):
        return "100" + code10[3:]
    if re.match(r"^[74]00[01]\d{6}$", code10):
        return "1" + code10[1:]
    return code10


def extract_material_number(line: str):
    is_sap_line = bool(
        re.search(
            r"\b(?:C006|C008|C00S|COOS|C00|CO06|C08|M016|MO16|MOTE|MOIS|D04D|DO4D|002|EA|EFA|FA|SET|PK|PAA|SH|ZYD|KIT|N[01OIl]\d[A-Z]{1,3}\d?)\b",
            line,
            re.I,
        )
    )
    m = re.search(r"\b(100\d{7})\b", line)
    if m:
        return normalize_sap_prefix(m.group(1))

    tokens = re.split(r"[\s|;,\[\]{}()]+", line)
    for tok in tokens:
        cleaned = re.sub(r"[^A-Za-z0-9°'\"%¢]", "", tok)
        if 8 <= len(cleaned) <= 12:
            rep = cleaned
            rep = re.sub(r"^(?:aot|aoo|qop|roo|too|190|109)", "100", rep, flags=re.I)
            rep = re.sub(r"^[Il|!rRtTsS74]", "1", rep)
            rep = re.sub(r"[OoQD°]", "0", rep)
            rep = re.sub(r"[Il|!t'\"rR]", "1", rep)
            rep = re.sub(r"[Zz]", "2", rep)
            rep = re.sub(r"[Ss$§]", "5", rep)
            rep = re.sub(r"[Gg%]", "6", rep)
            rep = re.sub(r"[BbeE]", "8", rep)
            rep = re.sub(r"[aA]", "4", rep)
            rep = re.sub(r"[dD]", "0", rep)
            rep = re.sub(r"[¢cC]", "9", rep)
            rep = re.sub(r"[^0-9]", "", rep)
            rep = normalize_sap_prefix(rep)
            if re.match(r"^100\d{7}$", rep):
                return rep
            if is_sap_line and re.match(r"^[147]100\d{7}$", rep):
                return normalize_sap_prefix(rep[1:])
            if is_sap_line and re.match(r"^100\d{7}\d{1,2}$", rep):
                return normalize_sap_prefix(rep[:10])
            if is_sap_line and re.match(r"^00[01]\d{6}$", rep):
                return "1" + rep
            if is_sap_line and re.match(r"^1001\d{5}$", rep):
                return "10011" + rep[4:]
            if is_sap_line and re.match(r"^1000\d{5}$", rep):
                return rep + "1"
    return None


def normalize_storage_bin(raw_line: str, part_number: str) -> str:
    s = raw_line.replace(part_number, " ").replace("_", " ")
    s = re.sub(
        r"\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[68bBsS]?|M[0Oo][1Il|itT][6bBsS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b",
        " ",
        s,
        flags=re.I,
    )
    s = re.sub(r"\bT?N[Oo0][Ili|!tT1]", "N01", s, flags=re.I)
    s = re.sub(r"\bT?N[Oo0]W", "N01", s, flags=re.I)
    s = re.sub(r"\bT?N[Ili|!tT1][Ss5]", "N15", s, flags=re.I)
    s = re.sub(r"\bT?N[Ili|!tT1][EeGg6]", "N16", s, flags=re.I)
    s = re.sub(r"\bT?N[Ili|!tT1MVNA][Ili|!tT1]", "N11", s, flags=re.I)
    s = re.sub(r"\bT?N[Ili|!tT1][Zz2]", "N12", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})(?:8B|B8|88|8BR|BR|BBR)([12Il|!tT])\b", r"\1BB\2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})0([12])\b", r"\1D\2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})F[LI1][Ili|!tTY41]\b", r"\1FL1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})F[LI1][ZzQRe2]\b", r"\1FL2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})V?A[TRIl|!yLD1]\b", r"\1A1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})V?A[ZzR2]\b", r"\1A2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})[EB8][TRIl|!y1]\b", r"\1B1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})[EB8][Zz2]\b", r"\1B2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2}[A-Z]{1,2})[TRIl|!y]\b", r"\g<1>1", s, flags=re.I)

    m = re.search(r"\b(N\d{2}[A-Z]{1,3}\d{1,2})\b", s, re.I)
    if m:
        cand = m.group(1).upper()
        cand = re.sub(r"[IL|T]$", "1", cand)
        return cand
    return ""


UNIT_PATTERN = r"(?:EA|EFA|FA|tA|cA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|OKIT|PCS|ROL|BOX|FT|M|L)"


def parse_line_fields(line: str, part_number: str, loc: str):
    qty = 1
    m_qty = re.search(rf"\b{UNIT_PATTERN}[\s|\[\]()—\-~:°.]*(\d{{1,4}})\b", line, re.I)
    if m_qty:
        val = int(m_qty.group(1))
        if val > 0:
            qty = val

    is_missing = 1 if re.search(r"(?:^|\s|\||\[|\])([Xx×✗✘]{1,2})(?=\s|\||\[|\]|$)", line) else 0
    remark = ""
    m_rem = re.search(r"(?:^|\s|\||\[|\])(?:\d{1,3}\s*-\s*(\d{1,3})|-\s*(\d{1,3}))(?=\s|\||\[|\]|$)", line)
    if m_rem:
        shortage = int(m_rem.group(1) or m_rem.group(2) or 0)
        if shortage > 0:
            remark = f"-{shortage}"

    desc = "SPARE PART ASMO"
    m_desc = re.search(
        rf"\b{UNIT_PATTERN}[\s|\[\]()—\-~:°.]*(?:\d{{1,4}}|ot|to|[Il|!ti])\b(.*)$",
        line,
        re.I,
    )
    if m_desc and m_desc.group(1):
        tail = m_desc.group(1)
        tail = re.sub(r"^\s*(?:[|\[\]()—\-~_✓✔×Xx/:.°'\"]|um|ua|ue|oo|ow|ov|pe|be|le|ce|fe|ge)+\s*", "", tail, flags=re.I)
        tail = re.sub(r"^[a-z0-9(—\-~_]{1,2}\s+", "", re.sub(r"[|\[\]]+\s*$", "", tail).strip())
        if len(tail) >= 3 and re.search(r"[A-Za-z]{2,}", tail):
            desc = tail

    return qty, is_missing, remark, desc


def ocr_band(img_slice: np.ndarray) -> str:
    return pytesseract.image_to_string(
        img_slice, lang="eng", config="--oem 1 --psm 6 -c tessedit_do_invert=0"
    )


def process_sheet_with_python(input_source: str) -> dict:
    img_gray = decode_image_from_input(input_source)
    cleaned = preprocess_table_image_opencv(img_gray)
    h = cleaned.shape[0]

    bands_img = [
        cleaned[0 : int(h * 0.38), :],
        cleaned[int(h * 0.32) : int(h * 0.70), :],
        cleaned[int(h * 0.64) : h, :],
    ]

    with ThreadPoolExecutor(max_workers=3) as executor:
        band_texts = list(executor.map(ocr_band, bands_img))

    band_rows = []
    for txt in band_texts:
        rows = []
        for raw_line in txt.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            mat = extract_material_number(line)
            if not mat:
                continue
            loc = normalize_storage_bin(line, mat)
            rows.append({"rawLine": line, "part_number": mat, "location_code": loc})
        band_rows.append(rows)

    # Contiguous overlap sequence alignment across the 3 bands
    def match_boundary(r1, r2):
        m1, m2 = r1["part_number"], r2["part_number"]
        if m1 == m2:
            return True
        if m1[-2:] == m2[-2:] and sum(1 for a, b in zip(m1, m2) if a == b) >= 8:
            return True
        return False

    merged = list(band_rows[0]) if band_rows else []
    for next_b in band_rows[1:]:
        if not next_b:
            continue
        tail_start = max(0, len(merged) - 5)
        cut_at = len(merged)
        start_at = 0
        found = False
        for ti in range(tail_start, len(merged)):
            for ni in range(min(3, len(next_b))):
                if match_boundary(merged[ti], next_b[ni]):
                    cut_at = ti
                    start_at = ni
                    found = True
                    break
            if found:
                break
        merged = merged[:cut_at] + next_b[start_at:]

    # Forward fill, backward fill, and Sandwich Context Smoothing for Storage Bins
    last_loc = ""
    for r in merged:
        if r["location_code"]:
            last_loc = r["location_code"]
        elif last_loc:
            r["location_code"] = last_loc

    next_loc = ""
    for r in reversed(merged):
        if r["location_code"]:
            next_loc = r["location_code"]
        elif next_loc:
            r["location_code"] = next_loc

    for i in range(1, len(merged) - 1):
        prev_l = merged[i - 1]["location_code"]
        next_l = merged[i + 1]["location_code"]
        if prev_l and prev_l == next_l and merged[i]["location_code"] != prev_l:
            merged[i]["location_code"] = prev_l

    items = []
    for idx, r in enumerate(merged, 1):
        loc = r["location_code"] or "N01A1"
        qty, is_missing, remark, desc = parse_line_fields(r["rawLine"], r["part_number"], loc)
        items.append(
            {
                "seq": idx,
                "part_number": r["part_number"],
                "material_number": r["part_number"],
                "location": loc,
                "location_code": loc,
                "storage_bin": loc,
                "quantity": qty,
                "qty": qty,
                "qty_total": qty,
                "is_missing": is_missing,
                "check_mark": "X" if is_missing else "✓",
                "remark": remark,
                "description": desc,
                "description_en": desc,
            }
        )

    return {"success": len(items) > 0, "engine": "python-opencv-tesseract", "items": items, "skipped_rows": []}


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
            res = process_sheet_with_python(sys.argv[1])
        else:
            payload = json.loads(sys.stdin.read())
            res = process_sheet_with_python(payload.get("imageBase64", ""))
        print(json.dumps(res, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"success": False, "items": [], "skipped_rows": [], "message": str(exc)}, ensure_ascii=False))
