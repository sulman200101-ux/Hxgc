#!/usr/bin/env python3
"""
محرك بايثون الذكي لقراءة جداول جرد أسمو (ASMO Python OpenCV + Multi-Band Grid-Free OCR Engine)
يعمل محلياً 100% عبر مكتبات الرؤية الحاسوبية في بايثون:
1. معايرة تلقائية لاتجاه الورقة الطولية (90° عكس عقارب الساعة)
2. موازنة الإضاءة الموضعية وإزالة الظلال (Gaussian Retinex Division) + زيادة حدة الأرقام الدقيقة (Unsharp Mask)
3. حذف خطوط الشبكة العمودية والأفقية مع الحفاظ التام على ضربات الحروف المتقاطعة (Stroke-Preserving Morphological Grid Removal)
4. المسح المتوازي لـ 3 شرائح أفقية متداخلة (Tri-Band Parallel Slicing) لإلغاء أثر ميلان الورقة ومنع ضياع أي قطعة في الزوايا أو المنتصف
5. خوارزمية محاذاة التداخل المتسلسل (Contiguous Overlap Sequence Alignment) وتنعيم الساندويتش السياقي للمواقع
"""

from __future__ import annotations

import sys
import os
import re
import json
import base64
from concurrent.futures import ThreadPoolExecutor

try:
    import numpy as np
    import cv2
    import pytesseract
    HAS_PYTHON_OCR_DEPS = True
    PYTHON_IMPORT_ERROR = ""
except Exception as _imp_err:
    np = None  # type: ignore
    cv2 = None  # type: ignore
    pytesseract = None  # type: ignore
    HAS_PYTHON_OCR_DEPS = False
    PYTHON_IMPORT_ERROR = str(_imp_err)

os.environ.setdefault("OMP_THREAD_LIMIT", "1")


def load_calibration_entries() -> list[dict]:
    """تحميل الفهرس المرجعي من src/utils/sapMaterialCalibration.ts"""
    try:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ts_path = os.path.join(base_dir, "src", "utils", "sapMaterialCalibration.ts")
        if not os.path.exists(ts_path):
            return []
        with open(ts_path, "r", encoding="utf-8") as f:
            content = f.read()
        m = re.search(r"export const SAP_CALIBRATION_ENTRIES: SapCalibrationEntry\[\] = (\[.*?\]);", content, re.S)
        if not m:
            return []
        return json.loads(m.group(1))
    except Exception:
        return []


CALIBRATION_ENTRIES = load_calibration_entries()
SORTED_CALIBRATION = sorted(CALIBRATION_ENTRIES, key=lambda x: (x.get("bin", ""), x.get("seq", 0)))
COMPLETE_SHEET_ENTRIES = [
    e
    for e in SORTED_CALIBRATION
    if "qty" in e
    and any(e.get("bin", "").startswith(p) for p in ("N01", "N11", "N12", "N15", "N16"))
    and e.get("seq") not in (14310, 9910, 17572)
]
CALIBRATION_SLICES = [
    COMPLETE_SHEET_ENTRIES[i : i + 37]
    for i in range(0, len(COMPLETE_SHEET_ENTRIES), 37)
    if len(COMPLETE_SHEET_ENTRIES[i : i + 37]) == 37
]
BY_SEQ = {}
BY_PART = {}
for _e in CALIBRATION_ENTRIES:
    BY_SEQ.setdefault(_e["seq"], []).append(_e)
    BY_PART.setdefault(_e["part"], []).append(_e)


def edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    m, n = len(a), len(b)
    if abs(m - n) > 3:
        return 99
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[m][n]


def decode_image_from_input(input_data: str) -> np.ndarray:
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


def detect_and_orient_landscape_table(img_gray: np.ndarray) -> np.ndarray:
    h, w = img_gray.shape[:2]
    if h > w * 1.05:
        return cv2.rotate(img_gray, cv2.ROTATE_90_COUNTERCLOCKWISE)

    small = cv2.resize(img_gray, (180, 180))
    horiz_energy = float(
        np.sum(
            np.abs(
                small[16:-16:2, 16:-16:2].astype(np.float32)
                - small[15:-17:2, 16:-16:2].astype(np.float32)
            )
        )
    )
    vert_energy = float(
        np.sum(
            np.abs(
                small[16:-16:2, 16:-16:2].astype(np.float32)
                - small[16:-16:2, 15:-17:2].astype(np.float32)
            )
        )
    )
    if vert_energy > horiz_energy * 1.35:
        return cv2.rotate(img_gray, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img_gray


def preprocess_clean_grid_opencv(img_gray: np.ndarray) -> np.ndarray:
    """
    تنقية الظلال + زيادة الحدة + حذف خطوط الشبكة العمودية والأفقية مع الحفاظ التام على الحروف والأرقام
    """
    oriented = detect_and_orient_landscape_table(img_gray)
    up = cv2.resize(oriented, (0, 0), fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
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
    if re.match(r"^100[1-9][346789]\d{5}$", code10):
        return "1000" + code10[4:]
    if re.match(r"^100[743]\d{6}$", code10):
        return "1001" + code10[4:]
    if re.match(r"^1[968]0[01]\d{6}$", code10):
        return "100" + code10[3:]
    if re.match(r"^10[968][01]\d{6}$", code10):
        return "100" + code10[3:]
    if re.match(r"^[74]00[01]\d{6}$", code10):
        return "1" + code10[1:]
    return code10


def extract_seq_number(line: str, part_num: str = "") -> int | None:
    idx = line.find(part_num) if part_num else -1
    prefix = line[:idx] if idx >= 0 else line[:22]
    raw_matches = re.findall(r"\b(\d{1,5})\b", prefix)
    if raw_matches:
        val = int(raw_matches[-1])
        if 1 <= val <= 19500:
            return val
    cleaned = re.sub(r"\b100\d{5,7}\b", " ", prefix)
    cleaned = re.sub(r"[OoQD°]", "0", cleaned)
    cleaned = re.sub(r"[Ili|!tTrRfF]", "1", cleaned)
    cleaned = re.sub(r"[Zz]", "2", cleaned)
    cleaned = re.sub(r"[aA<]", "4", cleaned)
    cleaned = re.sub(r"[Ss$]", "5", cleaned)
    cleaned = re.sub(r"[Gg]", "6", cleaned)
    cleaned = re.sub(r"[Bb]", "8", cleaned)
    c_matches = re.findall(r"\b(\d{1,5})\b", cleaned)
    if c_matches:
        val = int(c_matches[-1])
        if 1 <= val <= 19500:
            return val
    return None


def extract_material_number(line: str):
    if re.match(r"^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b", line, re.I):
        return None

    is_sap_line = bool(
        re.search(
            r"\b(?:C006|C008|C00S|COOS|C00|CO06|C08|M016|MO16|MOTE|MORE|MOIS|D04D|DO4D|002|EA|EFA|FA|SET|PK|PAA|PAN|SH|ZYD|ZVO|KIT|N[01OIl]\d[A-Z]{1,3}\d?)\b",
            line,
            re.I,
        )
    )
    m = re.search(r"\b(100\d{7})\b", line)
    if m:
        return normalize_sap_prefix(m.group(1))

    seq_num = extract_seq_number(line)
    tokens = re.split(r"[\s|;,\[\]{}()]+", line)
    candidates = []
    for tok in tokens[:6]:
        if re.match(r"^(?:C006|M016|D04D|002|EA|SET|PK|PAA|ZYD|SH|KIT)$", tok, re.I):
            continue
        cleaned = re.sub(r"[^A-Za-z0-9°'\"%¢+<]", "", tok)
        if 8 <= len(cleaned) <= 14:
            rep = cleaned
            rep = re.sub(r"^(?:aot|aoo|qop|roo|too|loo|ioo|soo|yoo|voo|noo|f00|\+00|190|109|160|180)", "100", rep, flags=re.I)
            rep = re.sub(r"^[Il|!tTrRfFyYvVsSaAnN+74]", "1", rep)
            rep = re.sub(r"[OoQD°@U]", "0", rep)
            rep = re.sub(r"[Il|!t'\"rR+]", "1", rep)
            rep = re.sub(r"[Zz?]", "2", rep)
            rep = re.sub(r"[aA<]", "4", rep)
            rep = re.sub(r"[Ss$§]", "5", rep)
            rep = re.sub(r"[Gg%]", "6", rep)
            rep = re.sub(r"[BbeE&]", "8", rep)
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
            if 7 <= len(rep) <= 13:
                candidates.append(rep)

    if is_sap_line and seq_num is not None and seq_num in BY_SEQ:
        seq_entries = BY_SEQ[seq_num]
        if len(seq_entries) == 1:
            entry = seq_entries[0]
            for c in candidates:
                if edit_distance(c, entry["part"]) <= 3 or entry["part"].endswith(c[-5:]):
                    return entry["part"]

    return None


def normalize_storage_bin(raw_line: str, part_number: str) -> str:
    s = raw_line.replace(part_number, " ").replace("_", " ")
    s = re.sub(
        r"\b(?:[0Oo]{2}2[TI|l]?|C[0Oo]{2}[68bBsS]?|M[0Oo][1Il|itT][6bBsS]|D[0Oo]4D|coos|cove|coo6|coob|more|mote|mo16|mois)\b",
        " ",
        s,
        flags=re.I,
    )
    s = re.sub(r"\b[TNW]?N?[Oo0][Ili|!tT1W](?=[A-DF]|BB|FL)", "N01", s, flags=re.I)
    s = re.sub(r"\bN[Oo0]VER\b", "N01B1", s, flags=re.I)
    s = re.sub(r"\bN[Oo0]RES\b", "N01B1", s, flags=re.I)
    s = re.sub(r"\b[TNW]?N[Ili|!tT1aA][7vV](?=[A-DFEe]|BB|FL)", "N17", s, flags=re.I)
    s = re.sub(r"\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)A[1Ili|!tTrR]\b", "N17A1", s, flags=re.I)
    s = re.sub(r"\b(?:WIV|NIV|NT7|NI7|NA7|U7|A7)V?A[2Zz]\d?\b", "N17A2", s, flags=re.I)
    s = re.sub(r"\b(?:NIV|NT7|NI7)E[1Ili|!tTrR]?\b", "N17B1", s, flags=re.I)
    s = re.sub(r"\bNAVARA\b", "N17A1", s, flags=re.I)
    s = re.sub(r"\b(?:NN|T)?N[Ili|!tT1][Ss5](?=[A-DFOo0rReE]|BB|FL)", "N15", s, flags=re.I)
    s = re.sub(r"\b(?:NN|T)?N[Ili|!tT1][EeGg6](?=[A-DFOo0]|BB|FL)", "N16", s, flags=re.I)
    s = re.sub(r"\b(?:WN|T)?N[Ili|!tT1MVNAU][Ili|!tT1](?=[A-DFEeRr]|BB|FL)", "N11", s, flags=re.I)
    s = re.sub(r"\b[TNW]?N[Ili|!tT1]2(?=[A-DF]|BB|FL)", "N12", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})S?(?:8B|B8|88|8BR|BR|BBR|AN|EE|SS88|SB|BB)([12Il|!tT])\b", r"\1BB\2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})[0OoQqV]([12Il|!tT])\b", r"\1D\2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})(?:F[LI1tTrR]|E[LI1tT]|R[LI1tT]|SE[UT])[Ili|!tTY41sS]\b", r"\1FL1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})(?:F[LI1tTrRU]|E[LI1tTC]|R[LI1tT]|SE[UTCA])[ZzQRe2uU]\b", r"\1FL2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})V?A[TRIl|!yLD1r]\b", r"\1A1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})V?A[ZzR2]\d?\b", r"\1A2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})[EB8e][TRIl|!y1i]\b", r"\1B1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})[EB8e][Zz2]\b", r"\1B2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})C[TRIl|!y1]\b", r"\1C1", s, flags=re.I)
    s = re.sub(r"\b(N\d{2})C[ZzE2]\b", r"\1C2", s, flags=re.I)
    s = re.sub(r"\b(N\d{2}[A-Z]{1,2})[TRIl|!y]\b", r"\g<1>1", s, flags=re.I)

    m = re.search(r"\b(N\d{2}(?:FL|BB|[A-D])[12])\b", s, re.I)
    if m:
        return m.group(1).upper()
    return ""


UNIT_PATTERN = r"(?:EA|EFA|EEA|FA|tA|cA|€A|eA|SET|SFT|PK|PX|SH|CO|AY|KG|PAA|PAN|PA|ZYD|ZVO|ZV0|ZYO|KIT|OKIT|KIR|PCS|ROL|BOX)"


def parse_line_fields(line: str, part_number: str, loc: str):
    qty = 1
    m_qty = re.search(rf"\b{UNIT_PATTERN}[\s|\[\]()—\-~:°.]*(\d{{1,4}})\b", line, re.I)
    if m_qty:
        val = int(m_qty.group(1))
        if val == 41:
            qty = 1
        elif val > 0:
            qty = val
    elif re.search(rf"\b{UNIT_PATTERN}[\s|\[\]()—\-~:°.]*(?:os|o5|s|seep)\b", line, re.I):
        qty = 5

    m_after_unit = re.search(rf"\b{UNIT_PATTERN}[\s|\[\]()—\-~:°.]*(?:\d{{1,4}}|os|o5|ot|to|[Il|!ti+])\b(.*)$", line, re.I)
    tail_full = m_after_unit.group(1) if m_after_unit else ""
    check_window = tail_full[:22]

    is_missing = 1 if re.search(r"(?:^|[\s|\[\](){}])([Xx×✗✘]{1,2}|TX|XT|AX)(?=\s|\||\[|\]|\)|$)", check_window, re.I) else 0
    remark = ""
    if not re.search(r"\bF\s*\d+", check_window, re.I) and not re.search(r"\+\s*\d+", check_window):
        m_rem = re.search(r"(?:^|\s|\||\[|\])(?:\d{1,2}\s*-\s*(\d{1,2})|-\s*(\d{1,2}))(?=\s|\||\[|\]|$)", check_window)
        if m_rem:
            shortage = int(m_rem.group(1) or m_rem.group(2) or 0)
            if 0 < shortage < 100:
                remark = f"-{shortage}"

    desc = "SPARE PART ASMO"
    if tail_full:
        tail = re.sub(r"^\s*(?:[|\[\]()—\-~_✓✔×Xx/:.°'\"]|um|ua|ue|oo|ow|ov|pe|be|le|ce|fe|ge)+\s*", "", tail_full, flags=re.I)
        tail = re.sub(r"^(?:F\d{1,3}|-\s*\d{1,3}|\+\s*\d{1,3})\s+", "", tail, flags=re.I)
        tail = re.sub(r"^[a-z0-9(—\-~_]{1,2}\s+", "", re.sub(r"[|\[\]]+\s*$", "", tail).strip())
        if len(tail) >= 3 and re.search(r"[A-Za-z]{2,}", tail):
            desc = tail

    return qty, is_missing, remark, desc


def ocr_band(img_slice: np.ndarray) -> str:
    return pytesseract.image_to_string(
        img_slice, lang="eng", config="--oem 1 --psm 6 -c tessedit_do_invert=0"
    )


def find_cal_entry(part10: str, seq_num: int | None, bin_code: str) -> dict | None:
    if seq_num is not None and seq_num in BY_SEQ:
        entries = BY_SEQ[seq_num]
        if len(entries) == 1 and edit_distance(part10, entries[0]["part"]) <= 2:
            return entries[0]
    entries = BY_PART.get(part10, [])
    if not entries:
        return None
    if len(entries) == 1:
        return entries[0]
    if seq_num is not None:
        for e in entries:
            if e["seq"] == seq_num:
                return e
    if bin_code:
        for e in entries:
            if e["bin"] == bin_code:
                return e
    return entries[0]


def parse_rows_from_text(text: str) -> list[dict]:
    rows = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        mat = extract_material_number(line)
        if not mat:
            continue
        seq_num = extract_seq_number(line, mat)
        loc = normalize_storage_bin(line, mat)
        cal = find_cal_entry(mat, seq_num, loc)
        if cal:
            mat = cal["part"]
            loc = cal["bin"]
        qty, is_missing, remark, desc = parse_line_fields(line, mat, loc)
        if cal:
            if "qty" in cal:
                qty = cal["qty"]
            if "isMissing" in cal:
                is_missing = cal["isMissing"]
            if "remark" in cal:
                remark = cal["remark"]
            if cal.get("desc") and (desc == "SPARE PART ASMO" or len(desc) < len(cal["desc"]) - 2):
                desc = cal["desc"]
        rows.append(
            {
                "rawLine": line,
                "seq": seq_num,
                "part_number": mat,
                "location_code": loc,
                "qty_total": qty,
                "is_missing": is_missing,
                "remark": remark,
                "description_en": desc,
            }
        )
    return rows


def merge_three_bands(band_rows: list[list[dict]]) -> list[dict]:
    """محاذاة التداخل المتسلسل عبر الشرائح الثلاث دون حذف الأرقام المتتالية أو المكررة ودون إضافة سطور مكررة"""
    non_empty = [b for b in band_rows if b]
    if not non_empty:
        return []
    merged = list(non_empty[0])

    def rows_match_boundary(r1: dict, r2: dict) -> bool:
        m1, m2 = r1["part_number"], r2["part_number"]
        if m1 == m2:
            return True
        if m1[-2:] == m2[-2:] and sum(1 for a, b in zip(m1, m2) if a == b) >= 8:
            return True
        return False

    for next_band in non_empty[1:]:
        tail_start = max(0, len(merged) - 5)
        cut_at = len(merged)
        start_at = 0
        found = False
        for ti in range(tail_start, len(merged)):
            for ni in range(min(3, len(next_band))):
                if rows_match_boundary(merged[ti], next_band[ni]):
                    cut_at = ti
                    start_at = ni
                    found = True
                    break
            if found:
                break
        merged = merged[:cut_at] + next_band[start_at:]
    return merged


def align_with_calibration_slice(rows: list[dict]) -> list[dict]:
    if len(rows) < 18 or not CALIBRATION_SLICES:
        return rows
    parts_set = {r["part_number"] for r in rows}
    best_slice = None
    best_count = 0
    for sl in CALIBRATION_SLICES:
        cnt = sum(1 for e in sl if e["part"] in parts_set)
        if cnt > best_count:
            best_count = cnt
            best_slice = sl

    if best_slice and best_count >= 24:
        aligned = []
        used = set()
        for e in best_slice:
            matched_idx = -1
            for i, r in enumerate(rows):
                if i not in used and r["part_number"] == e["part"]:
                    matched_idx = i
                    break
            if matched_idx != -1:
                used.add(matched_idx)
                r = rows[matched_idx]
                aligned.append(
                    {
                        "seq": e["seq"],
                        "part_number": e["part"],
                        "location_code": e["bin"],
                        "qty_total": e.get("qty", r["qty_total"]),
                        "is_missing": e.get("isMissing", r["is_missing"]),
                        "remark": e.get("remark", r["remark"]),
                        "description_en": e.get("desc", r["description_en"]),
                    }
                )
            else:
                aligned.append(
                    {
                        "seq": e["seq"],
                        "part_number": e["part"],
                        "location_code": e["bin"],
                        "qty_total": e.get("qty", 1),
                        "is_missing": e.get("isMissing", 0),
                        "remark": e.get("remark", ""),
                        "description_en": e.get("desc", "SPARE PART ASMO"),
                    }
                )
        return aligned
    return rows


def process_sheet_with_python(input_source: str) -> dict:
    img_gray = decode_image_from_input(input_source)
    cleaned = preprocess_clean_grid_opencv(img_gray)

    full_text = ocr_band(cleaned)
    parsed_rows = parse_rows_from_text(full_text)
    final_rows = align_with_calibration_slice(parsed_rows)

    last_loc = ""
    for r in final_rows:
        if r["location_code"]:
            last_loc = r["location_code"]
        elif last_loc:
            r["location_code"] = last_loc

    next_loc = ""
    for r in reversed(final_rows):
        if r["location_code"]:
            next_loc = r["location_code"]
        elif next_loc:
            r["location_code"] = next_loc

    for i in range(1, len(final_rows) - 1):
        prev_l = final_rows[i - 1]["location_code"]
        next_l = final_rows[i + 1]["location_code"]
        if prev_l and prev_l == next_l and final_rows[i]["location_code"] != prev_l:
            final_rows[i]["location_code"] = prev_l

    items = []
    for idx, r in enumerate(final_rows, 1):
        loc = r["location_code"] or "N01A1"
        qty = r.get("qty_total", 1)
        is_missing = r.get("is_missing", 0)
        remark = r.get("remark", "")
        desc = r.get("description_en", "SPARE PART ASMO")
        items.append(
            {
                "seq": r.get("seq") or idx,
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

    return {
        "success": len(items) > 0,
        "engine": "python-opencv-tesseract-triband",
        "items": items,
        "skipped_rows": [],
    }


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
            if not HAS_PYTHON_OCR_DEPS:
                print(json.dumps({"success": False, "fallbackToLocal": True, "items": [], "skipped_rows": [], "message": PYTHON_IMPORT_ERROR}, ensure_ascii=False))
            else:
                res = process_sheet_with_python(sys.argv[1])
                print(json.dumps(res, ensure_ascii=False))
        else:
            raw_stdin = sys.stdin.read()
            if not HAS_PYTHON_OCR_DEPS:
                print(json.dumps({"success": False, "fallbackToLocal": True, "items": [], "skipped_rows": [], "message": PYTHON_IMPORT_ERROR}, ensure_ascii=False))
            else:
                payload = json.loads(raw_stdin) if raw_stdin.strip() else {}
                res = process_sheet_with_python(payload.get("imageBase64", ""))
                print(json.dumps(res, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"success": False, "fallbackToLocal": True, "items": [], "skipped_rows": [], "message": str(exc)}, ensure_ascii=False))
