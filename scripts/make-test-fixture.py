#!/usr/bin/env python3
"""Build a synthetic .pages file for testing.

Creates a tiny PDF, then zips it as Preview.pdf alongside some bogus
index data — matching the real .pages layout closely enough that
JSZip will find Preview.pdf in the archive.
"""
import gzip
import io
import zipfile
from pathlib import Path
from fpdf import FPDF

OUT = Path(__file__).resolve().parent.parent / "test-fixtures"
OUT.mkdir(parents=True, exist_ok=True)

def minimal_pdf(text: str = "Hello from Pages Reader test fixture.") -> bytes:
    """Real text-bearing PDF (fpdf2). PDF.js getTextContent() can read it."""
    pdf = FPDF(format="Letter", unit="pt")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 24)
    pdf.cell(0, 30, "Test Fixture: " + text[:40])
    pdf.ln(40)
    pdf.set_font("Helvetica", size=14)
    pdf.cell(0, 20, "Generated for Pages Reader QA.")
    pdf.ln(28)
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 24, "Section heading")
    pdf.ln(32)
    pdf.set_font("Helvetica", size=12)
    pdf.multi_cell(0, 18,
        "This paragraph proves PDF.js text extraction works. "
        "If you see this content in the exported DOCX, Markdown, HTML or TXT "
        "file then the converter pipeline is end-to-end functional.")
    pdf.ln(8)
    pdf.multi_cell(0, 18,
        "A second paragraph. Nothing here is rasterised; every character is "
        "a real text object inside the PDF.")
    return bytes(pdf.output())

def xml_pages_index() -> bytes:
    """index.xml mimicking iWork '09 Pages structure — exercises XML extractor."""
    xml = """<?xml version="1.0" encoding="UTF-8"?>
<document xmlns="http://developer.apple.com/namespaces/sl"
          xmlns:sf="http://developer.apple.com/namespaces/sf">
  <sf:text-storage>
    <sf:h1>Pages Reader Test Document</sf:h1>
    <sf:p>This is the first paragraph of the test document. It has multiple sentences. The extractor should keep them together.</sf:p>
    <sf:h2>A secondary heading</sf:h2>
    <sf:p>Another paragraph follows. It demonstrates that headings break the flow correctly.</sf:p>
    <sf:list-item>First item in a bullet list</sf:list-item>
    <sf:list-item>Second item</sf:list-item>
    <sf:list-item>Third item with a slightly longer description</sf:list-item>
    <sf:h3>A third-level heading</sf:h3>
    <sf:p>Final paragraph closing out the test fixture.</sf:p>
  </sf:text-storage>
</document>
"""
    return xml.encode("utf-8")

def make_pages_file(name: str, pdf_path_in_zip: str = "Preview.pdf",
                    include_xml: bool = False) -> Path:
    """Wrap the PDF (and optionally index.xml.gz) inside a .pages archive."""
    pdf = minimal_pdf(f"Test fixture: {name}")
    target = OUT / name
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(pdf_path_in_zip, pdf)
        if include_xml:
            z.writestr("index.xml.gz", gzip.compress(xml_pages_index()))
        z.writestr("Metadata/BuildVersionHistory.plist",
                   '<?xml version="1.0" encoding="UTF-8"?>\n<plist></plist>')
        z.writestr("Metadata/DocumentIdentifier", "test-fixture-id")
    return target

if __name__ == "__main__":
    a = make_pages_file("modern.pages", "Preview.pdf")
    b = make_pages_file("older.pages", "QuickLook/Preview.pdf")
    c = make_pages_file("xml-format.pages", "Preview.pdf", include_xml=True)
    for p in [a, b, c]:
        print(f"wrote {p}  ({p.stat().st_size} bytes)")
