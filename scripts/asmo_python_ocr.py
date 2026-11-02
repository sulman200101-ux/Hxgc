#!/usr/bin/env python3
"""
محرك بايثون الصارم لقراءة جداول جرد أسمو (ASMO Strict Full-Sheet OCR Engine)
بدون أي بيانات مخزنة مسبقاً أو تخمين:
- يقرأ الورقة كاملة دفعة واحدة بدون تقسيم.
- أي حقل (رقم قطعة، موقع، وصف، كمية) لم يتمكن من قراءته بوضوح يُترك فارغاً تماماً ("").
"""

from __future__ import annotations

import sys
import os
import re
import json
import base64

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
    return img_gray


def preprocess_clean_grid_opencv(img_gray: np.ndarray) -> np.ndarray:
    oriented = detect_and_orient_landscape_table(img_gray)
    up = cv2.resize(oriented, (0, 0), fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
    bg = cv2.GaussianBlur(up, (45, 45), 0)
    norm = cv2.divide(up, bg, scale=255)
    blur = cv2.GaussianBlur(norm, (0, 0), 1.2)
    sharp = cv2.addWeighted(norm, 1.6, blur, -0.6, 0)
    return sharp


def extract_material_number(line: str) -> str:
    if re.match(r"^\s*(?:MATERIAL|ITEM|NO\.|STORAGE\s+BIN|QTY|DESCRIPTION|INVENTORY|PAGE)\b", line, re.I):
        return ""
    m = re.search(r"\b(\d{10})\b", line)
    return m.group(1) if m else ""


def extract_storage_bin(raw_line: str, part_number: str) -> str:
    s = raw_line.replace(part_number, " ") if part_number else raw_line
    m = re.search(r"\b(N\d{2}(?:FL|BB|[A-D])\d{1,2})\b", s, re.I)
    return m.group(1).upper() if m else ""


UNIT_PATTERN = r"(?:EA|SET|PK|SH|CO|AY|KG|PAA|ZYD|KIT|PCS|ROL|BOX)"


def parse_line_fields(line: str, part_number: str, loc: str):
    qty = None
    m_qty = re.search(rf"\b{UNIT_PATTERN}\s+(\d{{1,5}})\b", line, re.I)
    if m_qty:
        val = int(m_qty.group(1))
        if val > 0:
            qty = val

    m_after_unit = re.search(rf"\b{UNIT_PATTERN}\s+\d{{1,5}}\b(.*)$", line, re.I)
    tail_full = m_after_unit.group(1) if m_after_unit else ""
    check_window = tail_full[:25]

    is_missing = 1 if re.search(r"(?:^|[\s|\[\](){}])([Xx×✗✘])(?=\s|\||\[|\]|\)|$)", check_window) else 0
    remark = ""
    if not re.search(r"\bF\s*\d*", check_window, re.I):
        m_rem = re.search(r"(?:^|\s|\||\[|\])(?:\d{1,2}\s*-\s*(\d{1,2})|-\s*(\d{1,2}))(?=\s|\||\[|\]|$)", check_window)
        if m_rem:
            shortage = int(m_rem.group(1) or m_rem.group(2) or 0)
            if 0 < shortage < 100:
                remark = f"-{shortage}"
    else:
        remark = "F"

    desc = ""
    if tail_full:
        tail = re.sub(r"^\s*(?:[|\[\]()—\-~_✓✔×Xx/:.°'\"])+\s*", "", tail_full)
        tail = re.sub(r"^(?:F\d{0,3}|-\s*\d{1,3})\s+", "", tail, flags=re.I)
        tail = re.sub(r"[|\[\]]+\s*$", "", tail).strip()
        if len(tail) >= 2 and re.search(r"[A-Za-z]{2,}", tail):
            desc = tail

    return qty, is_missing, remark, desc


def process_sheet_with_python(input_source: str) -> dict:
    img_gray = decode_image_from_input(input_source)
    cleaned = preprocess_clean_grid_opencv(img_gray)

    full_text = pytesseract.image_to_string(
        cleaned, lang="eng", config="--oem 1 --psm 6 -c tessedit_do_invert=0"
    )

    items = []
    for raw_line in full_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        mat = extract_material_number(line)
        loc = extract_storage_bin(line, mat)
        qty, is_missing, remark, desc = parse_line_fields(line, mat, loc)

        if not mat and not loc and not desc and qty is None:
            continue

        items.append(
            {
                "part_number": mat,
                "location_code": loc,
                "quantity": qty,
                "qty_total": qty if qty is not None else 0,
                "is_missing": is_missing,
                "mark_symbol": "X" if is_missing else ("F" if remark == "F" else ("N" if remark.startswith("-") else None)),
                "remark": remark,
                "description": desc,
                "description_en": desc,
            }
        )

    return {
        "success": len(items) > 0,
        "engine": "python-opencv-tesseract-strict",
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
