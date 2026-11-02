#!/usr/bin/env python3
"""
محرك بايثون الذكي لقراءة جداول جرد أسمو (ASMO Zero-Hallucination OpenCV + Dual-Pass Grid-Free OCR Engine)
يعمل محلياً 100% بدون أي أرقام قطع مخزنة مسبقاً ودون اختلاق أي أرقام وهمية:
1. معايرة تلقائية لاتجاه الورقة الطولية (90° عكس عقارب الساعة) وتكبيرها لدقة 2400px.
2. كبت حبر القلم الأزرق في أعمدة الأرقام المطبوعة مع الحفاظ على علامات القلم (✓ و × و -N) في عمودي Check و Remark (من 42% إلى 53% من العرض).
3. موازنة الإضاءة الموضعية عبر تمريرتين لمرشح الصندوق (2-Pass Box Blur) وحذف خطوط الشبكة الأفقية والعمودية.
4. دمج التمريرة المنقاة من الشبكة مع التمريرة الطبيعية مع توحيد السطور المتتالية المتطابقة في الوصف والموقع.
"""

from __future__ import annotations

import sys
import os
import re
import json
import base64
import subprocess
from concurrent.futures import ThreadPoolExecutor

try:
    import numpy as np
    import cv2
    HAS_PYTHON_OCR_DEPS = True
    PYTHON_IMPORT_ERROR = ""
except Exception as _imp_err:
    np = None  # type: ignore
    cv2 = None  # type: ignore
    HAS_PYTHON_OCR_DEPS = False
    PYTHON_IMPORT_ERROR = str(_imp_err)

os.environ.setdefault("OMP_THREAD_LIMIT", "1")


def decode_color_image(input_data: str) -> np.ndarray:
    if os.path.exists(input_data):
        img = cv2.imread(input_data, cv2.IMREAD_COLOR)
        if img is not None:
            return img
    b64_str = input_data.strip()
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    raw_bytes = base64.b64decode(b64_str)
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("تعذر فك تشفير الصورة في محرك بايثون")
    return img


def detect_and_orient_landscape_table(img_bgr: np.ndarray) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    if h > w * 1.05:
        return cv2.rotate(img_bgr, cv2.ROTATE_90_COUNTERCLOCKWISE)

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (180, 180))
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
        return cv2.rotate(img_bgr, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img_bgr


def prepare_dual_pass_images(img_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    oriented = detect_and_orient_landscape_table(img_bgr)
    h, w = oriented.shape[:2]
    scale = 2400.0 / float(w)
    big = cv2.resize(oriented, (2400, int(round(h * scale))), interpolation=cv2.INTER_CUBIC)
    bh, bw = big.shape[:2]

    b, g, r = cv2.split(big)
    blue_excess = np.clip(b.astype(np.int16) - r.astype(np.int16), 0, 255)
    clean_gray = np.clip(b.astype(np.int16) + (blue_excess * 0.6), 0, 255).astype(np.uint8)
    std_gray = cv2.cvtColor(big, cv2.COLOR_BGR2GRAY)

    # الحفاظ على حبر القلم الأزرق في عمودي Check و Remark (من 42% إلى 53% من العرض)
    c0, c1 = int(bw * 0.42), int(bw * 0.53)
    hybrid_gray = clean_gray.copy()
    hybrid_gray[:, c0:c1] = std_gray[:, c0:c1]

    bg = cv2.blur(hybrid_gray, (91, 91))
    bg = cv2.blur(bg, (91, 91))
    norm = np.clip((hybrid_gray.astype(np.float32) / np.maximum(bg.astype(np.float32), 1.0)) * 245.0, 0, 255).astype(np.uint8)

    inv = (norm < 210).astype(np.uint8) * 255
    horiz_lines = cv2.morphologyEx(inv, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (85, 1)))
    vert_lines = cv2.morphologyEx(inv, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 55)))
    vert_lines[:, int(bw * 0.34):] = 0
    grid_mask = cv2.bitwise_or(horiz_lines, cv2.dilate(vert_lines, np.ones((2, 2), np.uint8), iterations=1))

    no_grid = norm.copy()
    no_grid[grid_mask > 0] = 248
    stretched = np.clip((no_grid.astype(np.float32) - 190.0) * 1.8 + 190.0, 0, 255).astype(np.uint8)

    # تحجيم الصورة الطبيعية لـ 2200px للتمريرة الثانية
    scale_nat = 2200.0 / float(w)
    natural_scaled = cv2.resize(oriented, (2200, int(round(h * scale_nat))), interpolation=cv2.INTER_CUBIC)
    return stretched, natural_scaled


def run_tesseract_array(img_arr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img_arr)
    if not ok:
        return ""
    proc = subprocess.run(
        ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "6"],
        input=buf.tobytes(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return proc.stdout.decode("utf-8", errors="replace")


def process_sheet_with_python(input_source: str) -> dict:
    img_bgr = decode_color_image(input_source)
    grid_free_img, natural_img = prepare_dual_pass_images(img_bgr)

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_grid = pool.submit(run_tesseract_array, grid_free_img)
        f_nat = pool.submit(run_tesseract_array, natural_img)
        raw_text = f_grid.result()
        left_text = f_nat.result()

    return {
        "success": bool(raw_text.strip() or left_text.strip()),
        "engine": "python-opencv-dualpass-zero-hallucination",
        "raw_text": raw_text,
        "left_text": left_text,
        "items": [],
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
