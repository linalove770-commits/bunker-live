#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Оптимизация сгенерированного арта под веб.

Прокси отдаёт крупные квадраты (1254x1254 и больше). Для интерфейса они
избыточны: иконке категории хватит 192px, обложке — 1280px. Скрипт уменьшает
картинки и сохраняет их оптимизированными PNG в public/img/.

    python tools/optimize-art.py
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print("Нужен Pillow: uv run --with pillow --no-project python tools/optimize-art.py",
          file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "public" / "img"

# Имя -> целевой размер. Крупные иллюстрации сохраняем в JPEG (PNG на
# фотографических градиентах даёт мегабайты), иконки — в PNG.
TARGETS = {
    "hero": 1280,
    "card-back": 512,
    "catastrophe": 512,
    "bunker": 512,
}
CATEGORY_SIZE = 192
JPEG_QUALITY = 84
# Крупные картинки уходят в JPEG, иконки категорий остаются PNG.
JPEG_NAMES = {"hero", "card-back", "catastrophe", "bunker"}

SKIP = {"_style-seed"}


def target_for(name: str) -> int:
    if name in TARGETS:
        return TARGETS[name]
    if name.startswith("cat-"):
        return CATEGORY_SIZE
    return 512


def main() -> int:
    if not IMG.exists():
        print("Нет папки public/img", file=sys.stderr)
        return 1

    sources = sorted(p for p in IMG.glob("*.png") if p.stem not in SKIP)
    if not sources:
        print("Нет картинок для оптимизации", file=sys.stderr)
        return 1

    total_before = 0
    total_after = 0
    for src in sources:
        before = src.stat().st_size
        total_before += before
        name = src.stem
        size = target_for(name)
        as_jpeg = name in JPEG_NAMES
        with Image.open(src) as img:
            img = img.convert("RGB")
            if img.width != size:
                img = img.resize((size, size), Image.LANCZOS)
            if as_jpeg:
                dst = src.with_suffix(".jpg")
                img.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
                src.unlink()
            else:
                dst = src
                img.save(dst, "PNG", optimize=True)
        after = dst.stat().st_size
        total_after += after
        print(f"{dst.name:24} {size:>5}px  {before // 1024:>5} КБ -> {after // 1024:>4} КБ")

    print(f"\nВсего: {total_before // 1024} КБ -> {total_after // 1024} КБ "
          f"({len(sources)} файлов)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
