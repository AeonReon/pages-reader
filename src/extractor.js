/* extractor.js — pull a normalized document out of a .pages / .key / .numbers archive.
 *
 * Output shape:
 *   {
 *     title:  string,
 *     blocks: [
 *       { type: 'heading', level: 1|2|3, text: string },
 *       { type: 'paragraph', text: string },
 *       { type: 'list', ordered: boolean, items: [string, ...] },
 *     ],
 *     source: 'xml' | 'pdf' | 'none',
 *     pdfBlob: Blob | null,      // the extracted Preview.pdf if present
 *     previewImg: Blob | null,   // jpg preview if no PDF
 *   }
 *
 * Strategy:
 *   1. Look for index.xml.gz (iWork '09 format)  → parse for structure
 *   2. Else, look for Preview.pdf                → extract text via PDF.js
 *   3. Else, look for preview.jpg                → return image only
 */
(function (global) {
  'use strict';

  async function extract(file, opts = {}) {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.keys(zip.files);

    // Hunt for the visual preview alongside the structural data
    const pdfName = firstMatch(entries, [
      /^Preview\.pdf$/i,
      /^QuickLook\/Preview\.pdf$/i,
      /Preview\.pdf$/i,
    ]);
    const jpgName = firstMatch(entries, [
      /^preview\.jpg$/i,
      /^preview-web\.jpg$/i,
      /^QuickLook\/Thumbnail\.jpg$/i,
      /^preview-micro\.jpg$/i,
    ]);
    const xmlGzName = firstMatch(entries, [
      /^index\.xml\.gz$/i,
      /^Index\.xml\.gz$/i,
    ]);
    const xmlName = firstMatch(entries, [
      /^index\.xml$/i,
      /^Index\.xml$/i,
    ]);

    const result = {
      title: file.name.replace(/\.(pages|key|numbers)$/i, ''),
      blocks: [],
      source: 'none',
      pdfBlob: null,
      previewImg: null,
      warnings: [],
    };

    if (pdfName) {
      const pBlob = await zip.files[pdfName].async('blob');
      result.pdfBlob = new Blob([pBlob], { type: 'application/pdf' });
    }
    if (jpgName) {
      const jBlob = await zip.files[jpgName].async('blob');
      result.previewImg = new Blob([jBlob], { type: 'image/jpeg' });
    }

    // 1) Try the structured XML path (best fidelity, only available in old format)
    if (xmlGzName || xmlName) {
      try {
        const raw = xmlGzName
          ? await zip.files[xmlGzName].async('uint8array')
          : await zip.files[xmlName].async('uint8array');
        const xmlText = xmlGzName ? gunzipToString(raw) : new TextDecoder().decode(raw);
        const parsed = parseIWorkXML(xmlText);
        if (parsed.blocks.length) {
          result.blocks = parsed.blocks;
          if (parsed.title) result.title = parsed.title;
          result.source = 'xml';
          return result;
        }
      } catch (err) {
        console.warn('XML extraction failed:', err);
        result.warnings.push('Structured XML extraction failed; fell back to PDF text.');
      }
    }

    // 2) Fall back to extracting text from the embedded PDF (new format usually)
    if (result.pdfBlob && opts.extractText !== false) {
      try {
        const blocks = await extractTextFromPDF(result.pdfBlob);
        if (blocks.length) {
          result.blocks = blocks;
          result.source = 'pdf';
          return result;
        }
      } catch (err) {
        console.warn('PDF text extraction failed:', err);
        result.warnings.push('Could not extract text from the embedded PDF preview.');
      }
    }

    // 3) Nothing structured — leave blocks empty, callers can fall back to the image
    return result;
  }

  // ---- XML path -----------------------------------------------------------

  function parseIWorkXML(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('XML parse error');

    const blocks = [];
    let title = null;

    // iWork '09 Pages uses sl:text-storage with sf:p (paragraph), sf:h1/h2/h3 (headings),
    // and sf:list-item. Namespaces vary slightly between Pages versions but the local names
    // are consistent. We walk using localName to be robust.
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT, null);
    let currentList = null;

    while (walker.nextNode()) {
      const el = walker.currentNode;
      const ln = el.localName;
      if (!ln) continue;

      // Heading?
      const headingMatch = ln.match(/^h([1-6])$/);
      if (headingMatch) {
        flushList();
        const text = collectText(el);
        if (text) {
          const level = Math.min(parseInt(headingMatch[1], 10), 3);
          if (!title && level === 1) title = text;
          blocks.push({ type: 'heading', level, text });
        }
        continue;
      }

      // List item?
      if (ln === 'list-item' || ln === 'li') {
        const text = collectText(el);
        if (text) {
          if (!currentList) currentList = { type: 'list', ordered: false, items: [] };
          currentList.items.push(text);
        }
        continue;
      }

      // Paragraph?
      if (ln === 'p' || ln === 'paragraph') {
        flushList();
        const text = collectText(el);
        if (text) blocks.push({ type: 'paragraph', text });
        continue;
      }
    }
    flushList();
    function flushList() {
      if (currentList && currentList.items.length) {
        blocks.push(currentList);
      }
      currentList = null;
    }
    // Deduplicate runs of identical paragraphs the XML sometimes nests
    return { blocks: dedupeAdjacent(blocks), title };
  }

  function collectText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function dedupeAdjacent(blocks) {
    const out = [];
    for (const b of blocks) {
      const last = out[out.length - 1];
      if (last && last.type === b.type && last.type !== 'list' && last.text === b.text) continue;
      out.push(b);
    }
    return out;
  }

  function gunzipToString(uint8) {
    if (!global.pako) throw new Error('pako not loaded');
    const inflated = global.pako.inflate(uint8);
    return new TextDecoder('utf-8').decode(inflated);
  }

  // ---- PDF path ------------------------------------------------------------
  // Lazy-load PDF.js worker once.
  let pdfjsReady = null;
  function ensurePdfJs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((resolve, reject) => {
      if (!global.pdfjsLib) return reject(new Error('pdfjsLib not loaded'));
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      resolve(global.pdfjsLib);
    });
    return pdfjsReady;
  }

  async function extractTextFromPDF(blob) {
    const pdfjs = await ensurePdfJs();
    const buf = await blob.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const blocks = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = groupLinesByY(content.items);
      for (const line of lines) {
        const text = line.text.trim();
        if (!text) continue;
        // Cheap heuristic: short isolated lines in bigger fonts are headings.
        const isShort = text.length < 70;
        const isBigFont = line.maxHeight > 18;
        const looksLikeHeading = isShort && isBigFont;
        if (looksLikeHeading) {
          blocks.push({
            type: 'heading',
            level: line.maxHeight > 26 ? 1 : line.maxHeight > 20 ? 2 : 3,
            text,
          });
        } else {
          blocks.push({ type: 'paragraph', text });
        }
      }
      if (p < doc.numPages) blocks.push({ type: 'paragraph', text: '' }); // page break gap
    }
    return mergeParagraphs(blocks);
  }

  // PDF.js returns text items with x/y coords; group items sharing a y baseline into lines.
  function groupLinesByY(items) {
    const lines = [];
    for (const it of items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const height = it.height || (it.transform[3] || 12);
      let line = lines.find((l) => Math.abs(l.y - y) < 2);
      if (!line) {
        line = { y, text: '', maxHeight: 0 };
        lines.push(line);
      }
      line.text += it.str;
      if (it.hasEOL) line.text += '\n';
      if (height > line.maxHeight) line.maxHeight = height;
    }
    // Sort top-to-bottom (PDF coords go up from origin)
    lines.sort((a, b) => b.y - a.y);
    return lines;
  }

  // Glue consecutive paragraph blocks together when there's no blank separator.
  function mergeParagraphs(blocks) {
    const out = [];
    for (const b of blocks) {
      const last = out[out.length - 1];
      if (
        b.type === 'paragraph' &&
        last &&
        last.type === 'paragraph' &&
        b.text &&
        last.text &&
        !/[.!?:]\s*$/.test(last.text)
      ) {
        last.text += ' ' + b.text;
      } else if (b.type === 'paragraph' && !b.text && last && last.type === 'paragraph' && !last.text) {
        // collapse multiple blanks
      } else {
        out.push({ ...b });
      }
    }
    // Drop trailing empties
    while (out.length && out[out.length - 1].type === 'paragraph' && !out[out.length - 1].text) {
      out.pop();
    }
    return out;
  }

  function firstMatch(entries, patterns) {
    for (const pat of patterns) {
      const m = entries.find((e) => pat.test(e));
      if (m) return m;
    }
    return null;
  }

  global.PagesExtractor = { extract };
})(window);
