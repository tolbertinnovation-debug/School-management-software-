/* Small UI helpers: escaping, toasts, modals, money/date formatting and
   dependency-free SVG charts (bar + line) following the app palette. */
const UI = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 3200) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, ms);
  }

  function modal(html) {
    close();
    const back = document.createElement('div');
    back.className = 'modal-back'; back.id = 'modal';
    back.innerHTML = `<div class="modal">${html}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.body.appendChild(back);
    return back;
  }
  function close() { const m = document.getElementById('modal'); if (m) m.remove(); }

  const CUR = () => (API.school() && API.school().currency) || 'LRD';
  const money = (cents) => `${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CUR()}`;
  const dmy = (iso) => iso ? new Date(iso + (iso.length === 10 ? 'T12:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);

  const initials = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (photo, name) => photo
    ? `<span class="avatar"><img src="/uploads/${esc(photo)}" alt=""></span>`
    : `<span class="avatar">${esc(initials(name))}</span>`;

  // ---------------- charts (series colors are the validated palette slots) ----------------
  const S1 = 'var(--blue)', S2 = 'var(--aqua)';

  // Horizontal bars with direct value labels. rows: [{label, value, value2?}]
  function barChart(rows, { series = ['Value'], money: isMoney = false, height } = {}) {
    if (!rows.length) return '<p class="muted">No data yet.</p>';
    const max = Math.max(...rows.flatMap(r => [r.value || 0, r.value2 || 0]), 1);
    const rowH = 26, gap = 6, labelW = 92, valueW = 66;
    const twoSeries = rows.some(r => r.value2 !== undefined);
    const bandH = twoSeries ? rowH * 2 - 8 : rowH;
    const H = height || rows.length * (bandH + gap) + 4;
    const W = 340;
    const barW = W - labelW - valueW;
    const fmt = v => isMoney ? (v / 100).toLocaleString() : v.toLocaleString();
    let y = 2, bars = '';
    for (const r of rows) {
      const w1 = Math.max(2, (r.value / max) * barW);
      bars += `<text x="${labelW - 6}" y="${y + 14}" text-anchor="end">${esc(String(r.label).slice(0, 14))}</text>` +
        `<rect x="${labelW}" y="${y + 3}" width="${w1}" height="${twoSeries ? rowH - 12 : rowH - 8}" rx="4" fill="${S1}"></rect>` +
        `<text class="val" x="${labelW + w1 + 5}" y="${y + 14}">${fmt(r.value || 0)}</text>`;
      if (twoSeries) {
        const w2 = Math.max(2, ((r.value2 || 0) / max) * barW);
        bars += `<rect x="${labelW}" y="${y + rowH - 6}" width="${w2}" height="${rowH - 12}" rx="4" fill="${S2}"></rect>` +
          `<text class="val" x="${labelW + w2 + 5}" y="${y + rowH + 5}">${fmt(r.value2 || 0)}</text>`;
      }
      y += bandH + gap;
    }
    const legend = twoSeries
      ? `<div class="legend"><span><span class="sw" style="background:${S1}"></span>${esc(series[0])}</span>` +
        `<span><span class="sw" style="background:${S2}"></span>${esc(series[1])}</span></div>` : '';
    return `${legend}<svg class="chart" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(series.join(' and '))} chart" style="max-height:${Math.min(H, 420)}px">${bars}</svg>`;
  }

  // Simple monthly trend line. points: [{label, value}], as percentage or count.
  function lineChart(points, { suffix = '' } = {}) {
    if (points.length < 2) return '<p class="muted">Not enough data yet.</p>';
    const W = 340, H = 130, padL = 30, padB = 18, padT = 8;
    const max = Math.max(...points.map(p => p.value), 1);
    const x = i => padL + i * (W - padL - 8) / (points.length - 1);
    const y = v => padT + (1 - v / max) * (H - padT - padB);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const grid = [0, 0.5, 1].map(f =>
      `<line class="grid" x1="${padL}" y1="${y(max * f)}" x2="${W - 8}" y2="${y(max * f)}"></line>` +
      `<text x="${padL - 4}" y="${y(max * f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
    const dots = points.map((p, i) =>
      `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${S1}"><title>${esc(p.label)}: ${p.value}${suffix}</title></circle>`).join('');
    const labels = points.map((p, i) =>
      (points.length <= 8 || i % 2 === 0) ? `<text x="${x(i)}" y="${H - 3}" text-anchor="middle">${esc(String(p.label).slice(-5))}</text>` : '').join('');
    const last = points[points.length - 1];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="trend chart">${grid}` +
      `<path d="${path}" fill="none" stroke="${S1}" stroke-width="2"></path>${dots}${labels}` +
      `<text class="val" x="${x(points.length - 1)}" y="${y(last.value) - 8}" text-anchor="end">${last.value}${suffix}</text></svg>`;
  }

  // Open a print-friendly window for receipts / report cards / payslips.
  function printDoc(title, bodyHtml) {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to print'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        body{font-family:system-ui,sans-serif;color:#000;margin:24px;font-size:14px}
        table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:5px 8px;text-align:left;font-size:13px}
        .head{text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:14px}
        .head h2{margin:2px 0}.muted{color:#444;font-size:12px}.sig{margin-top:44px;display:flex;justify-content:space-between}
        .sig span{border-top:1px solid #000;padding-top:4px;width:40%;text-align:center;font-size:12px}
        @media print{button{display:none}}
      </style></head><body>${bodyHtml}
      <button id="print-btn" style="margin-top:18px;padding:10px 20px">🖨 Print / Save as PDF</button>
      </body></html>`);
    w.document.close();
    // bound from the opener because the app CSP forbids inline handlers
    const btn = w.document.getElementById('print-btn');
    if (btn) btn.addEventListener('click', () => w.print());
  }

  const spin = '<div class="card"><p class="muted">Loading…</p></div>';
  const cachedNote = (d) => d && d._cached
    ? `<p class="muted">⚠ Showing saved copy from ${new Date(d._cachedAt).toLocaleString()} — will refresh when back online.</p>` : '';

  return { esc, toast, modal, close, money, dmy, today, avatar, initials, barChart, lineChart, printDoc, spin, cachedNote };
})();
