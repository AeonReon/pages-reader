/* converters.js — turn normalized {blocks} into txt/markdown/html/docx blobs.
 * DOCX is hand-rolled OOXML (the actual file is a zip of XML — JSZip handles that).
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    }[c]));
  }

  // ---- Plain text ---------------------------------------------------------
  function toText(doc) {
    const lines = [];
    for (const b of doc.blocks) {
      if (b.type === 'heading') {
        lines.push('');
        lines.push(b.text);
        lines.push('='.repeat(Math.min(b.text.length, 60)));
        lines.push('');
      } else if (b.type === 'paragraph') {
        lines.push(b.text);
        lines.push('');
      } else if (b.type === 'list') {
        for (const it of b.items) lines.push((b.ordered ? '  - ' : '  • ') + it);
        lines.push('');
      }
    }
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    return new Blob([text], { type: 'text/plain;charset=utf-8' });
  }

  // If the first block is a level-1 heading that matches the title, skip it
  // when also emitting a separate title — otherwise the doc renders twice.
  function blocksToEmit(doc) {
    const blocks = doc.blocks;
    if (
      doc.title &&
      blocks.length &&
      blocks[0].type === 'heading' &&
      blocks[0].level === 1 &&
      blocks[0].text === doc.title
    ) {
      return blocks.slice(1);
    }
    return blocks;
  }

  // ---- Markdown -----------------------------------------------------------
  function toMarkdown(doc) {
    const lines = [];
    if (doc.title) {
      lines.push('# ' + doc.title);
      lines.push('');
    }
    for (const b of blocksToEmit(doc)) {
      if (b.type === 'heading') {
        lines.push('#'.repeat(b.level + 1) + ' ' + b.text);
        lines.push('');
      } else if (b.type === 'paragraph') {
        lines.push(b.text);
        lines.push('');
      } else if (b.type === 'list') {
        b.items.forEach((it, i) =>
          lines.push((b.ordered ? `${i + 1}. ` : '- ') + it));
        lines.push('');
      }
    }
    const md = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    return new Blob([md], { type: 'text/markdown;charset=utf-8' });
  }

  // ---- HTML (self-contained, printable) -----------------------------------
  function toHTML(doc) {
    const body = blocksToEmit(doc).map((b) => {
      if (b.type === 'heading') {
        const tag = 'h' + Math.min(b.level + 1, 6);
        return `<${tag}>${escapeHtml(b.text)}</${tag}>`;
      }
      if (b.type === 'paragraph') {
        return b.text ? `<p>${escapeHtml(b.text)}</p>` : '';
      }
      if (b.type === 'list') {
        const tag = b.ordered ? 'ol' : 'ul';
        return `<${tag}>${b.items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</${tag}>`;
      }
      return '';
    }).join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(doc.title || 'Document')}</title>
<style>
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
         max-width: 720px; margin: 48px auto; padding: 0 24px; color: #1f1a28; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.4em; }
  h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
  p { margin: 0 0 1em; }
  ul, ol { margin: 0 0 1em 1.5em; }
  li { margin: 0.25em 0; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
${doc.title ? `<h1>${escapeHtml(doc.title)}</h1>\n` : ''}${body}
</body>
</html>
`;
    return new Blob([html], { type: 'text/html;charset=utf-8' });
  }

  // ---- DOCX (minimal valid OOXML) -----------------------------------------
  // DOCX is a zip with:
  //   [Content_Types].xml
  //   _rels/.rels
  //   word/document.xml          <- the content
  //   word/_rels/document.xml.rels
  //   word/styles.xml            <- heading styles
  // We hand-roll all of it. ~150 lines.
  async function toDOCX(doc) {
    const zip = new JSZip();

    zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
    zip.file('_rels/.rels', ROOT_RELS_XML);
    zip.file('word/_rels/document.xml.rels', WORD_RELS_XML);
    zip.file('word/styles.xml', STYLES_XML);
    zip.file('word/document.xml', buildDocumentXml(doc));

    return zip.generateAsync({
      type: 'blob',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  function buildDocumentXml(doc) {
    const paras = [];
    if (doc.title) paras.push(headingPara(doc.title, 1));
    for (const b of blocksToEmit(doc)) {
      if (b.type === 'heading') {
        paras.push(headingPara(b.text, b.level));
      } else if (b.type === 'paragraph') {
        paras.push(bodyPara(b.text || ''));
      } else if (b.type === 'list') {
        for (const it of b.items) paras.push(listPara(it, b.ordered));
      }
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paras.join('\n')}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
  }

  function headingPara(text, level) {
    const style = 'Heading' + Math.min(level, 3);
    return `    <w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }
  function bodyPara(text) {
    return `    <w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }
  function listPara(text, ordered) {
    const marker = ordered ? '1. ' : '• ';
    return `    <w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(marker + text)}</w:t></w:r></w:p>`;
  }

  const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const WORD_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica" w:cs="Helvetica"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="480" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/></w:rPr>
  </w:style>
</w:styles>`;

  global.PagesConverters = {
    toText,
    toMarkdown,
    toHTML,
    toDOCX,
  };
})(window);
