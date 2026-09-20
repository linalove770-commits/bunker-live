#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Генерация арта для «Бункер Live» через локальный CLIProxyAPI (gpt-image-2).

Стиль задаётся один раз: первая картинка становится стилевым якорем и
передаётся как референс во все последующие генерации — так набор остаётся
однородным.

    python tools/gen-art.py --only card-back
    python tools/gen-art.py            # весь список
"""

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

API_BASE = os.environ.get("CLIPROXY_API_BASE", "http://127.0.0.1:8317/v1").rstrip("/")
KEY = (
    os.environ.get("CLI_PROXY_API_KEY")
    or os.environ.get("NINEROUTER_API_KEY")
    or os.environ.get("OPENCODE_GO_API_KEY")
)
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "img"

# Общий стиль: единая палитра с интерфейсом, без текста и логотипов.
STYLE = (
    "Dark post-apocalyptic illustration for a survival board game card. "
    "Muted palette: deep charcoal background #0a0d14, hazard amber #f5a623 accents, "
    "cold cyan #22d3ee secondary accents, dusty red #ff5c5c for danger only. "
    "Rough engraved linework mixed with soft airbrush shading, retro Soviet civil-defence "
    "poster feel, film grain, subtle vignette. Centered single subject, generous empty "
    "margin around it, no text, no letters, no numbers, no logos, no watermark, "
    "no signature, no frame border. "
    "IMPORTANT: the artwork must stay readable when scaled down to 64 pixels — "
    "bold simple shapes, strong silhouette, high contrast against the dark background, "
    "few large forms instead of many small details, no busy texture."
)

ANCHOR = "card-back"

JOBS = {
    "card-back": (
        "A closed heavy steel bunker door seen straight on, rivets and a big "
        "three-blade radiation trefoil painted in amber in the centre, "
        "scratched metal, faint condensation. This is the back of a playing card: "
        "the composition must be symmetrical and readable as a repeating pattern."
    ),
    "hero": (
        "Wide atmospheric establishing shot: silhouettes of a small group of survivors "
        "standing before a massive concrete bunker entrance at dusk, a distant burning "
        "city on the horizon, heavy overcast sky, amber emergency lamp glowing above the door."
    ),
    "catastrophe": (
        "A dead frozen city under a starless ash-grey sky, snow drifting over abandoned "
        "cars and icicles, one ruined radio tower leaning in the distance. "
        "No people."
    ),
    "bunker": (
        "Cutaway view of an underground shelter: three concrete levels connected by a "
        "ladder, stacked crates of supplies, a hand-cranked ventilation fan, warm amber "
        "light spilling from a hatch above."
    ),
    "cat-profession": (
        "Still life of working tools laid out in a row: a wrench, a scalpel, a trowel, "
        "a sewing needle, a geologist's hammer. Object silhouettes only, no hands, no people."
    ),
    "cat-biology": (
        "A double helix of DNA rendered as a worn brass scientific instrument, "
        "entwined with a simple family silhouette of two adult figures and a child, "
        "all as flat dark silhouettes."
    ),
    "cat-body": (
        "A classical marble statue torso, chipped and cracked, standing in dim light; "
        "fitness and physical strength implied through form only."
    ),
    "cat-trait": (
        "A theatrical mask split down the middle: one half calm and composed, "
        "the other half tense and shouting. Dark patina, amber highlights."
    ),
    "cat-health": (
        "An old medical kit open on a table: a stethoscope, a glass ampoule, a pill jar, "
        "a bandage roll, a thermometer. Still life, no hands."
    ),
    "cat-hobby": (
        "A chessboard mid-game next to a fishing rod, a guitar and a stack of worn books — "
        "objects that turn into survival skills."
    ),
    "cat-phobia": (
        "A narrow dark corridor with a single trembling pool of light, a barely visible "
        "tall shadow at the far end, claustrophobic walls closing in."
    ),
    "cat-luggage": (
        "A heavy military crate and a canvas duffel bag with straps on the ground, "
        "an axe and a coil of rope leaning against them."
    ),
    "cat-backpack": (
        "An open canvas backpack on the floor with compact gear spilling out: "
        "a compass, matches, a folded map, a multitool, a water flask."
    ),
    "cat-fact": (
        "A worn folder of documents with a red stamp, loose photographs and a torn "
        "identity card spread on a table, an unlit lamp nearby."
    ),
    "cat-special": (
        "A glowing amber energy symbol shaped like a lightning bolt hovering above an "
        "open palm rendered as a dark silhouette, radiating concentric rings."
    ),
}


def api_url(path: str) -> str:
    return f"{API_BASE}/{path.lstrip('/')}"


def call(endpoint: str, fields: list, refs: list) -> dict:
    args = ["curl", "-sS", "-X", "POST", api_url(endpoint),
            "-H", f"Authorization: Bearer {KEY}"]
    for key, value in fields:
        args.extend(["-F", f"{key}={value}"])
    for ref in refs:
        args.extend(["-F", f"image[]=@{ref}"])
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"curl failed: {proc.stderr[:400]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Не JSON в ответе: {proc.stdout[:400]}") from exc


def save(payload: dict, out: Path) -> Path:
    if "error" in payload:
        raise RuntimeError(json.dumps(payload["error"], ensure_ascii=False)[:600])
    item = (payload.get("data") or [{}])[0]
    b64 = item.get("b64_json") or item.get("base64")
    if not b64:
        raise RuntimeError(f"Нет картинки в ответе: {str(payload)[:400]}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    return out


def generate(name: str, prompt: str, refs: list, size: str, quality: str) -> Path:
    out = OUT_DIR / f"{name}.png"
    full_prompt = f"{prompt}\n\nSTYLE: {STYLE}"
    fields = [
        ("model", "gpt-image-2"),
        ("size", size),
        ("quality", quality),
        ("prompt", full_prompt),
    ]

    if refs:
        payload = call("images/edits", fields, refs)
    else:
        payload = call("images/generations", fields, [])
        if "error" in payload:
            # Некоторые сборки прокси отдают генерацию только через edits.
            payload = call("images/edits", fields, [])

    save(payload, out)
    sidecar = out.with_suffix(".json")
    sidecar.write_text(json.dumps({
        "api": api_url("images/edits" if refs else "images/generations"),
        "output": str(out.relative_to(ROOT)),
        "refs": [str(Path(r).name) for r in refs],
        "prompt": full_prompt,
        "requested_size": size,
        "quality": quality,
        "usage": payload.get("usage"),
        "actual_size": payload.get("size"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def dimensions(path: Path) -> str:
    try:
        from PIL import Image
        with Image.open(path) as img:
            return f"{img.width}x{img.height}"
    except Exception:
        pass
    out = subprocess.run(["file", "-b", str(path)], capture_output=True, text=True).stdout
    return out.strip()[:80]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", default=None,
                        help="сгенерировать только эти имена (можно несколько раз)")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", default="high")
    parser.add_argument("--no-anchor", action="store_true",
                        help="не использовать стилевой якорь как референс")
    args = parser.parse_args()

    if not KEY:
        print("Не найден ключ (CLI_PROXY_API_KEY / NINEROUTER_API_KEY / OPENCODE_GO_API_KEY)",
              file=sys.stderr)
        return 2

    names = args.only or list(JOBS.keys())
    anchor_path = OUT_DIR / f"{ANCHOR}.png"
    failures = []

    for name in names:
        if name not in JOBS:
            print(f"! неизвестное имя: {name}", file=sys.stderr)
            failures.append(name)
            continue

        refs = []
        # Стилевой якорь передаём во все картинки, кроме него самого.
        if not args.no_anchor and name != ANCHOR and anchor_path.exists():
            refs = [anchor_path]
        # Первой картинке тоже нужен референс: прокси умеет только edits.
        if not refs:
            seed = OUT_DIR / '_style-seed.png'
            if seed.exists():
                refs = [seed]

        print(f"→ {name} (рефов: {len(refs)})", flush=True)
        try:
            out = generate(name, JOBS[name], refs, args.size, args.quality)
            print(f"  ✓ {out.relative_to(ROOT)}  {dimensions(out)}", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"  ✗ {name}: {exc}", file=sys.stderr, flush=True)
            failures.append(name)

    print(f"\nГотово: {len(names) - len(failures)}/{len(names)}")
    if failures:
        print("Не получилось:", ", ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
