"""Compare paired packaged renderer captures using exact RGB equality."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops


def compare(before, after, output, native):
    reference = json.loads((before / "manifest.json").read_text(encoding="utf-8"))
    candidate = json.loads((after / "manifest.json").read_text(encoding="utf-8"))
    files = [record["file"] for record in reference["records"]]
    if files != [record["file"] for record in candidate["records"]]:
        raise ValueError("Screenshot inventories differ")
    output.mkdir(parents=True, exist_ok=True)
    diffs = []
    for index, name in enumerate(files):
        if native:
            left_file = reference["records"][index].get("native", {})
            right_file = candidate["records"][index].get("native", {})
            if not left_file.get("file") or left_file.get("file") != right_file.get("file"):
                diffs.append({"file": name, "error": "NATIVE_CAPTURE_MISSING"})
                continue
            name = left_file["file"]
        with Image.open(before / name) as image:
            left = image.convert("RGB")
        with Image.open(after / name) as image:
            right = image.convert("RGB")
        if left.size != right.size:
            diffs.append({"file": name, "referenceSize": left.size, "candidateSize": right.size})
            continue
        delta = ImageChops.difference(left, right)
        red, green, blue = delta.split()
        mask = ImageChops.lighter(ImageChops.lighter(red, green), blue)
        different = left.width * left.height - mask.histogram()[0]
        if different:
            delta.point(lambda value: min(value * 5, 255)).save(output / name)
        diffs.append({"file": name, "size": left.size, "differentPixels": different,
                      "totalPixels": left.width * left.height, "bbox": mask.getbbox()})
    report = {"referenceBrowser": reference["browser"], "candidateBrowser": candidate["browser"],
              "exact": sum(row.get("differentPixels") == 0 for row in diffs),
              "total": len(diffs), "comparisons": diffs}
    (output / "compare.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"exact": report["exact"], "total": report["total"]}))
    return report["exact"] == report["total"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("before", "after", "output"):
        parser.add_argument(argument, type=Path)
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    raise SystemExit(0 if compare(args.before, args.after, args.output, args.native) else 1)
