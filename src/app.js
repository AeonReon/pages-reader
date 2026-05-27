/* app.js — wires the UI to extractor + converters.
 * Single-file path: drop one file → view inline → export menu.
 * Batch path:        drop several → list view → pick one format → download zip.
 */
(function () {
  'use strict';

  // ---- DOM refs ----------------------------------------------------------
  const dropZone   = document.getElementById('dropZone');
  const pickBtn    = document.getElementById('pickBtn');
  const fileInput  = document.getElementById('fileInput');
  const statusEl   = document.getElementById('status');

  const viewer     = document.getElementById('viewer');
  const viewerBody = document.getElementById('viewerBody');
  const fileNameEl = document.getElementById('fileName');
  const fileMetaEl = document.getElementById('fileMeta');
  const openTabBtn = document.getElementById('openTabBtn');
  const exportBtn  = document.getElementById('exportBtn');
  const exportMenu = document.getElementById('exportMenu');
  const closeBtn   = document.getElementById('closeBtn');

  const batch      = document.getElementById('batch');
  const batchList  = document.getElementById('batchList');
  const batchTitle = document.getElementById('batchTitle');
  const batchSub   = document.getElementById('batchSub');
  const batchFormatBtn   = document.getElementById('batchFormatBtn');
  const batchFormatMenu  = document.getElementById('batchFormatMenu');
  const batchFormatLabel = document.getElementById('batchFormatLabel');
  const batchConvertBtn  = document.getElementById('batchConvertBtn');
  const batchClearBtn    = document.getElementById('batchClearBtn');

  // ---- State -------------------------------------------------------------
  // Single-file state
  let viewBlobUrl = null;        // blob URL of the PDF or image currently shown
  let currentFile = null;        // File
  let currentDoc  = null;        // extractor output

  // Batch state
  let batchItems = [];           // [{ file, status, doc?, error? }]
  let batchFormat = 'docx';

  // ---- Helpers -----------------------------------------------------------
  function setStatus(kind, html) {
    statusEl.className = 'status show ' + kind;
    statusEl.innerHTML = html;
  }
  function clearStatus() {
    statusEl.className = 'status';
    statusEl.innerHTML = '';
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function isPagesFile(name) {
    return /\.(pages|key|numbers)$/i.test(name);
  }
  function baseName(name) {
    return name.replace(/\.(pages|key|numbers)$/i, '');
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function revokeView() {
    if (viewBlobUrl) { URL.revokeObjectURL(viewBlobUrl); viewBlobUrl = null; }
  }
  function showViewer() { viewer.classList.add('show'); }
  function hideViewer() { viewer.classList.remove('show'); viewerBody.innerHTML = ''; }
  function showBatch()  { batch.classList.add('show'); }
  function hideBatch()  { batch.classList.remove('show'); batchList.innerHTML = ''; }

  // ---- Drop / pick wiring ------------------------------------------------
  ['dragenter', 'dragover'].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.add('is-drag');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      if (ev === 'dragleave' && e.target !== dropZone) return;
      dropZone.classList.remove('is-drag');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) handleFiles(files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (files.length) handleFiles(files);
  });

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) handleFiles(files);
    fileInput.value = '';
  });

  // ---- Single-file flow --------------------------------------------------
  async function handleFiles(files) {
    const valid = files.filter((f) => isPagesFile(f.name));
    const skipped = files.length - valid.length;

    if (!valid.length) {
      setStatus('warn',
        "Those don't look like Pages files. This reader opens " +
        '<code>.pages</code>, <code>.key</code> and <code>.numbers</code>.');
      return;
    }

    if (valid.length === 1) {
      if (skipped) {
        setStatus('warn', `Skipped ${skipped} non-Pages file${skipped > 1 ? 's' : ''}.`);
      } else {
        clearStatus();
      }
      hideBatch();
      await openSingle(valid[0]);
    } else {
      hideViewer();
      revokeView();
      clearStatus();
      if (skipped) {
        setStatus('warn', `Skipped ${skipped} non-Pages file${skipped > 1 ? 's' : ''}. Queued ${valid.length} for batch convert.`);
      }
      openBatch(valid);
    }
  }

  async function openSingle(file) {
    revokeView();
    hideViewer();
    setStatus('info', `Opening <strong>${escapeHtml(file.name)}</strong>…`);
    currentFile = file;
    currentDoc = null;

    let doc;
    try {
      doc = await PagesExtractor.extract(file);
    } catch (err) {
      console.error(err);
      setStatus('error', "Couldn't read that file. It may be corrupted or not a real Pages document.");
      return;
    }
    currentDoc = doc;

    // Render the visual preview
    fileNameEl.textContent = file.name;

    if (doc.pdfBlob) {
      viewBlobUrl = URL.createObjectURL(doc.pdfBlob);
      const embed = document.createElement('embed');
      embed.src = viewBlobUrl + '#toolbar=1&navpanes=0';
      embed.type = 'application/pdf';
      viewerBody.innerHTML = '';
      viewerBody.appendChild(embed);
      fileMetaEl.textContent =
        fmtSize(file.size) + ' · ' +
        (doc.source === 'xml'
          ? `${doc.blocks.length} blocks · PDF preview + structured text`
          : doc.source === 'pdf'
          ? `${doc.blocks.length} blocks · PDF preview + extracted text`
          : 'PDF preview only');
      showViewer();
      clearStatus();
      enableExports(true);
    } else if (doc.previewImg) {
      viewBlobUrl = URL.createObjectURL(doc.previewImg);
      const img = document.createElement('img');
      img.className = 'preview'; img.src = viewBlobUrl; img.alt = file.name;
      viewerBody.innerHTML = '';
      viewerBody.appendChild(img);
      fileMetaEl.textContent = fmtSize(file.size) + ' · Image preview only';
      showViewer();
      setStatus('warn',
        'This document has no embedded PDF — showing the image preview Pages stored. ' +
        'Text export options are limited. To get a clean PDF, open it on a Mac with Pages and re-save with ' +
        '<em>"Include preview in document"</em> turned on.');
      enableExports(doc.blocks.length > 0); // text only if we somehow got blocks
    } else {
      // No preview at all
      const entries = await listZipEntries(file);
      const sample = entries.slice(0, 10).map((e) => '<code>' + escapeHtml(e) + '</code>').join(', ');
      setStatus('error',
        'No preview found inside this <code>.pages</code> file. ' +
        'It was saved without the "Include preview" option. ' +
        'Open it on a Mac with Pages and re-save with that option on, or export to PDF directly.<br><br>' +
        (sample ? '<span style="opacity:.7">Contents: ' + sample + (entries.length > 10 ? ' …' : '') + '</span>' : ''));
      enableExports(false);
    }
  }

  function enableExports(on) {
    const buttons = exportMenu.querySelectorAll('button[data-fmt]');
    buttons.forEach((b) => {
      const fmt = b.dataset.fmt;
      // PDF is enabled when we have a pdfBlob; text formats need blocks
      if (fmt === 'pdf') b.disabled = !(currentDoc && currentDoc.pdfBlob);
      else b.disabled = !(on && currentDoc && currentDoc.blocks.length);
    });
    exportBtn.disabled = !on && !(currentDoc && currentDoc.pdfBlob);
  }

  async function listZipEntries(file) {
    try {
      const z = await JSZip.loadAsync(file);
      return Object.keys(z.files);
    } catch { return []; }
  }

  // ---- Export menu (single file) -----------------------------------------
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportMenu.classList.toggle('show');
    exportBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.contains(e.target) && e.target !== exportBtn) {
      exportMenu.classList.remove('show');
      exportBtn.setAttribute('aria-expanded', 'false');
    }
    if (!batchFormatMenu.contains(e.target) && e.target !== batchFormatBtn) {
      batchFormatMenu.classList.remove('show');
      batchFormatBtn.setAttribute('aria-expanded', 'false');
    }
  });
  exportMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn || btn.disabled) return;
    exportMenu.classList.remove('show');
    await exportCurrent(btn.dataset.fmt);
  });

  async function exportCurrent(fmt) {
    if (!currentDoc || !currentFile) return;
    const stem = baseName(currentFile.name);
    try {
      if (fmt === 'pdf') {
        if (!currentDoc.pdfBlob) throw new Error('No PDF inside this file.');
        downloadBlob(currentDoc.pdfBlob, stem + '.pdf');
      } else if (fmt === 'txt') {
        downloadBlob(PagesConverters.toText(currentDoc), stem + '.txt');
      } else if (fmt === 'md') {
        downloadBlob(PagesConverters.toMarkdown(currentDoc), stem + '.md');
      } else if (fmt === 'html') {
        downloadBlob(PagesConverters.toHTML(currentDoc), stem + '.html');
      } else if (fmt === 'docx') {
        const blob = await PagesConverters.toDOCX(currentDoc);
        downloadBlob(blob, stem + '.docx');
      }
      setStatus('good', `Exported <strong>${stem}.${fmt === 'docx' ? 'docx' : fmt}</strong>`);
      setTimeout(() => statusEl.classList.contains('good') && clearStatus(), 3000);
    } catch (err) {
      console.error(err);
      setStatus('error', 'Export failed: ' + escapeHtml(err.message || String(err)));
    }
  }

  openTabBtn.addEventListener('click', () => {
    if (viewBlobUrl) window.open(viewBlobUrl, '_blank', 'noopener');
  });
  closeBtn.addEventListener('click', () => {
    hideViewer(); revokeView();
    currentFile = null; currentDoc = null;
    clearStatus();
  });

  // ---- Batch flow --------------------------------------------------------
  function openBatch(files) {
    batchItems = files.map((f) => ({ file: f, status: 'pending' }));
    renderBatch();
    showBatch();
    // Pre-extract each in the background to validate
    Promise.all(batchItems.map(async (it) => {
      try {
        it.doc = await PagesExtractor.extract(it.file, { extractText: false });
        it.status = 'ready';
      } catch (err) {
        it.error = err.message || String(err);
        it.status = 'error';
      }
      renderBatch();
    }));
  }

  function renderBatch() {
    const counts = batchItems.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {});
    const parts = [];
    if (counts.ready)   parts.push(`${counts.ready} ready`);
    if (counts.pending) parts.push(`${counts.pending} reading…`);
    if (counts.working) parts.push(`${counts.working} converting…`);
    if (counts.done)    parts.push(`${counts.done} done`);
    if (counts.error)   parts.push(`${counts.error} failed`);
    batchTitle.textContent =
      `${batchItems.length} file${batchItems.length === 1 ? '' : 's'}` +
      (parts.length ? ' · ' + parts.join(' · ') : '');
    batchSub.textContent = counts.done
      ? 'Conversion complete. Hit Clear to drop another batch.'
      : 'Pick a format and download a zip of all conversions.';

    batchList.innerHTML = batchItems.map((it) => `
      <div class="file-row">
        <div class="pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="info">
          <div class="name">${escapeHtml(it.file.name)}</div>
          <div class="meta">${fmtSize(it.file.size)}${it.error ? ' · ' + escapeHtml(it.error) : ''}</div>
        </div>
        <div class="state ${it.status}">${
          it.status === 'pending' ? 'Reading…' :
          it.status === 'working' ? 'Converting…' :
          it.status === 'ready'   ? 'Ready' :
          it.status === 'done'    ? 'Done' :
          'Failed'
        }</div>
      </div>
    `).join('');
  }

  batchFormatBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = batchFormatMenu.classList.toggle('show');
    batchFormatBtn.setAttribute('aria-expanded', String(open));
  });
  batchFormatMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn) return;
    batchFormat = btn.dataset.fmt;
    batchFormatLabel.textContent = btn.querySelector('.fmt-tag').textContent.replace('.', '').toUpperCase();
    batchFormatMenu.classList.remove('show');
    batchFormatBtn.setAttribute('aria-expanded', 'false');
  });

  batchClearBtn.addEventListener('click', () => {
    batchItems = [];
    hideBatch();
    clearStatus();
  });

  batchConvertBtn.addEventListener('click', async () => {
    if (!batchItems.length) return;
    batchConvertBtn.disabled = true;
    setStatus('info', `Converting ${batchItems.length} file${batchItems.length === 1 ? '' : 's'} to ${batchFormat.toUpperCase()}…`);

    const zip = new JSZip();
    let made = 0;
    for (const it of batchItems) {
      if (it.status === 'error') continue;
      it.status = 'working'; renderBatch();
      try {
        // For PDF batch, the pdfBlob is already cached; for text formats we need full extraction.
        if (batchFormat !== 'pdf' && !it.doc.blocks.length) {
          it.doc = await PagesExtractor.extract(it.file);
        }
        const stem = baseName(it.file.name);
        let outBlob, outName;
        if (batchFormat === 'pdf') {
          if (!it.doc.pdfBlob) throw new Error('no embedded PDF');
          outBlob = it.doc.pdfBlob; outName = stem + '.pdf';
        } else if (batchFormat === 'txt') {
          outBlob = PagesConverters.toText(it.doc); outName = stem + '.txt';
        } else if (batchFormat === 'md') {
          outBlob = PagesConverters.toMarkdown(it.doc); outName = stem + '.md';
        } else if (batchFormat === 'html') {
          outBlob = PagesConverters.toHTML(it.doc); outName = stem + '.html';
        } else if (batchFormat === 'docx') {
          outBlob = await PagesConverters.toDOCX(it.doc); outName = stem + '.docx';
        }
        zip.file(outName, outBlob);
        it.status = 'done'; made++;
      } catch (err) {
        it.status = 'error'; it.error = err.message || String(err);
      }
      renderBatch();
    }

    if (!made) {
      setStatus('error', 'No files could be converted.');
      batchConvertBtn.disabled = false;
      return;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(zipBlob, `pages-converted-${batchFormat}-${stamp}.zip`);
    setStatus('good', `Converted ${made} file${made === 1 ? '' : 's'} → ZIP downloaded.`);
    batchConvertBtn.disabled = false;
  });

  // ---- Service worker ----------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
