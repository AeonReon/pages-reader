#!/usr/bin/env python3
"""Build a synthetic .pages file for testing.

Creates a tiny PDF, then zips it as Preview.pdf alongside some bogus
index data — matching the real .pages layout closely enough that
JSZip will find Preview.pdf in the archive.
"""
import io
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "test-fixtures"
OUT.mkdir(parents=True, exist_ok=True)

def minimal_pdf(text: str = "Hello from Pages Reader test fixture.") -> bytes:
    """Render a 1-page PDF via PIL (well-formed, all viewers accept it)."""
    img = Image.new("RGB", (816, 1056), "white")
    draw = ImageDraw.Draw(img)
    try:
        title_font = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc", 36)
        body_font = ImageFont.truetype(
            "/System/Library/Fonts/Helvetica.ttc", 18)
    except OSError:
        title_font = ImageFont.load_default()
        body_font = ImageFont.load_default()
    draw.text((80, 80),  text, fill="#1c1c1c", font=title_font)
    draw.text((80, 150), "Generated for Pages Reader QA.",
              fill="#444", font=body_font)
    draw.text((80, 200),
              "If you can read this in the viewer, the PDF extraction works.",
              fill="#444", font=body_font)
    buf = io.BytesIO()
    img.save(buf, "PDF", resolution=96.0)
    return buf.getvalue()

def make_pages_file(name: str, pdf_path_in_zip: str = "Preview.pdf") -> Path:
    """Wrap the PDF inside a zip that looks like a .pages archive."""
    pdf = minimal_pdf(f"Test fixture: {name}")
    target = OUT / name
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(pdf_path_in_zip, pdf)
        # Mimic a real Pages archive's other files (Pages won't actually read these)
        z.writestr("Metadata/BuildVersionHistory.plist",
                   '<?xml version="1.0" encoding="UTF-8"?>\n<plist></plist>')
        z.writestr("Metadata/DocumentIdentifier", "test-fixture-id")
    return target

if __name__ == "__main__":
    a = make_pages_file("modern.pages", "Preview.pdf")
    b = make_pages_file("older.pages", "QuickLook/Preview.pdf")
    print(f"wrote {a}  ({a.stat().st_size} bytes)")
    print(f"wrote {b}  ({b.stat().st_size} bytes)")
