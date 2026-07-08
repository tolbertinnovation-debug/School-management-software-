/* Money views: fees & payments, expenses, reports & analytics. */

// ------------------------------------------------------------------ FEES
Views.fees = async ({ student } = {}) => {
  $v().innerHTML = UI.spin;
  const [cur, defs] = await Promise.all([
    API.get('/academics/current'),
    API.get('/finance/defaulters?term_id=' + ((await API.get('/academics/current')).term || {}).id).catch(() => ({ data: [] })),
  ]);
  const term = cur.term || {};
  $v().innerHTML = `
    <div class="card"><h1>💰 Fees — ${E(term.name || '')}</h1>
      <div class="btn-row">
        <button class="btn small" id="f-pay">💵 Record payment</button>
        ${App.can('school_admin', 'accountant') ? `
        <button class="btn small secondary" id="f-invoices">🧾 Generate invoices</button>
        <button class="btn small secondary" id="f-structure">🏷 Fee structure</button>
        <a class="btn small secondary" href="#/expenses">📉 Expenses</a>` : ''}
      </div></div>
    <div class="card">
      <h2>Fee defaulters (${(defs.data || []).length})</h2>
      ${(defs.data || []).length ? `<div class="btn-row"><button class="btn small secondary" id="f-remind">📨 SMS reminder to all</button></div>` : ''}
      <div class="tablewrap"><table><thead><tr><th>Student</th><th>Class</th><th class="num">Balance</th><th></th></tr></thead>
      <tbody>${(defs.data || []).slice(0, 100).map(d => `
        <tr><td>${E(d.first_name)} ${E(d.last_name)}</td><td>${E(d.class_name || '')}</td>
        <td class="num"><b>${UI.money(d.balance_cents)}</b></td>
        <td><button class="btn small" data-paysid="${d.student_id}" data-name="${E(d.first_name)} ${E(d.last_name)}">Pay</button></td></tr>`).join('')}
      </tbody></table></div>
      ${!(defs.data || []).length ? '<p class="muted">🎉 No outstanding balances for this term.</p>' : ''}
    </div>`;

  async function paymentModal(studentId, name) {
    let stu = null;
    if (!studentId) {
      const r = await API.get('/students?limit=2000');
      stu = (r.data || []).filter(s => s.status === 'active');
    }
    UI.modal(`<h2>💵 Record payment</h2><form id="pf">
      ${studentId
        ? `<p><b>${E(name)}</b></p><input type="hidden" id="pf-sid" value="${studentId}">`
        : `<label class="f"><span>Student</span><select id="pf-sid">${stu.map(s =>
            `<option value="${s.id}">${E(s.first_name)} ${E(s.last_name)} (${E(s.student_no)})</option>`).join('')}</select></label>`}
      <div id="pf-bal" class="muted"></div>
      <label class="f"><span>Amount (${(API.school() || {}).currency || 'LRD'})</span>
        <input type="number" id="pf-amount" min="1" step="0.01" required></label>
      <label class="f"><span>Method</span><select id="pf-method">
        <option value="cash">💵 Cash</option>
        <option value="momo_mtn">📱 Lonestar MTN Mobile Money</option>
        <option value="momo_orange">📱 Orange Money</option>
        <option value="bank">🏦 Bank deposit</option>
        <option value="cheque">Cheque</option></select></label>
      <label class="f" id="pf-ref-wrap" style="display:none"><span>Transaction ID / slip number</span>
        <input type="text" id="pf-ref" placeholder="from the confirmation SMS"></label>
      <label class="f"><span>Payer name (optional)</span><input type="text" id="pf-payer"></label>
      <div class="btn-row"><button class="btn">💾 Save & receipt</button>
      <button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    const methodEl = document.getElementById('pf-method');
    methodEl.onchange = () => {
      document.getElementById('pf-ref-wrap').style.display = methodEl.value === 'cash' ? 'none' : '';
    };
    const sidEl = document.getElementById('pf-sid');
    async function showBal() {
      try {
        const st = await API.get(`/finance/statement/${sidEl.value}`);
        document.getElementById('pf-bal').textContent = `Current balance: ${UI.money(st.balance_cents)}`;
      } catch { /* offline without cache */ }
    }
    if (sidEl.tagName === 'SELECT') sidEl.onchange = showBal;
    showBal();
    document.getElementById('pf').onsubmit = async (e) => {
      e.preventDefault();
      const sid = Number(sidEl.value);
      // attach open invoice automatically if we have it cached
      let invoiceId = null;
      try {
        const st = await API.get(`/finance/statement/${sid}`);
        const open = (st.invoices || []).find(i => ['open', 'partial'].includes(i.status));
        invoiceId = open ? open.id : null;
      } catch { /* fine — payment without invoice link */ }
      const r = await API.post('/finance/payments', {
        student_id: sid, invoice_id: invoiceId,
        amount_cents: Math.round(Number(document.getElementById('pf-amount').value) * 100),
        method: methodEl.value,
        reference: document.getElementById('pf-ref').value.trim() || null,
        payer_name: document.getElementById('pf-payer').value.trim() || null,
      }, { label: 'payment' });
      UI.close();
      if (r.queued) { UI.toast('Payment saved offline — receipt prints after sync ✓', 5000); return; }
      UI.toast(`Receipt ${r.data.receipt_no} ✓ (SMS sent to guardians)`);
      Views.printReceipt(r.data.id);
    };
  }
  document.getElementById('f-pay').onclick = () => paymentModal(student || null, '');
  document.querySelectorAll('[data-paysid]').forEach(b =>
    b.onclick = () => paymentModal(Number(b.dataset.paysid), b.dataset.name));
  if (student) paymentModal(Number(student), '');

  const remind = document.getElementById('f-remind');
  if (remind) remind.onclick = async () => {
    if (!confirm(`Queue a fee reminder SMS to guardians of ${(defs.data || []).length} students?`)) return;
    const r = await API.post('/finance/defaulters/remind', {
      student_ids: (defs.data || []).map(d => d.student_id),
    }, { label: 'fee reminders' });
    UI.toast(r.queued ? 'Will send when online' : `${r.sms_queued} reminder SMS queued ✓`);
  };

  const inv = document.getElementById('f-invoices');
  if (inv) inv.onclick = async () => {
    if (!confirm(`Generate ${term.name || 'term'} invoices for all active students from the fee structure? Existing invoices are kept.`)) return;
    const r = await API.post('/finance/invoices/generate', { term_id: term.id }, { label: 'invoices' });
    UI.toast(r.queued ? 'Will generate when online' : `Created ${r.created} invoices (${r.skipped} already existed) ✓`);
  };

  const struct = document.getElementById('f-structure');
  if (struct) struct.onclick = async () => {
    const fs = await API.get(`/finance/fee-structures?term_id=${term.id}`);
    UI.modal(`<h2>🏷 Fee structure — ${E(term.name || '')}</h2>
      <div class="tablewrap"><table><thead><tr><th>Fee</th><th>Level</th><th class="num">Amount</th></tr></thead>
      <tbody>${(fs.data || []).map(f => `<tr><td>${E(f.name)}</td><td>${f.class_level === '*' ? 'All' : 'Grade ' + E(f.class_level)}</td>
        <td class="num">${UI.money(f.amount_cents)}</td></tr>`).join('')}</tbody></table></div>
      <form id="fsf"><h3 style="margin-top:12px">Add fee item</h3>
        <div class="row">
          <label class="f grow"><span>Name</span><input type="text" id="fs-name" placeholder="Tuition" required></label>
          <label class="f"><span>Level (* = all)</span><input type="text" id="fs-level" value="*" style="width:80px"></label>
          <label class="f grow"><span>Amount</span><input type="number" id="fs-amt" min="0" step="0.01" required></label>
        </div>
        <div class="btn-row"><button class="btn">Add</button><button type="button" class="btn secondary" data-close>Close</button></div></form>`);
    document.getElementById('fsf').onsubmit = async (e) => {
      e.preventDefault();
      await API.post('/finance/fee-structures', {
        term_id: term.id, name: document.getElementById('fs-name').value.trim(),
        class_level: document.getElementById('fs-level').value.trim() || '*',
        amount_cents: Math.round(Number(document.getElementById('fs-amt').value) * 100),
      }, { label: 'fee item' });
      UI.close(); UI.toast('Fee item added ✓');
    };
  };
};

Views.printReceipt = async (paymentId) => {
  const d = await API.get(`/finance/payments/${paymentId}/receipt`);
  const p = d.receipt, sch = d.school || {};
  const METHOD = { cash: 'Cash', bank: 'Bank deposit', momo_mtn: 'Lonestar MTN MoMo', momo_orange: 'Orange Money', cheque: 'Cheque', other: 'Other' };
  UI.printDoc('Receipt', `
    <div class="head"><h2>${E(sch.name || '')}</h2>
      <div class="muted">${E(sch.address || '')} · ${E(sch.phone || '')}</div>
      <b>OFFICIAL RECEIPT ${E(p.receipt_no)}</b></div>
    <table><tbody>
      <tr><td>Date</td><td>${UI.dmy(p.date)}</td></tr>
      <tr><td>Received from</td><td>${E(p.payer_name || 'Guardian of ' + p.first_name + ' ' + p.last_name)}</td></tr>
      <tr><td>For student</td><td>${E(p.first_name)} ${E(p.last_name)} (${E(p.student_no)}, ${E(p.class_name || '')})</td></tr>
      <tr><td>Amount</td><td><b>${UI.money(p.amount_cents)}</b></td></tr>
      <tr><td>Method</td><td>${METHOD[p.method] || p.method}${p.reference ? ' — ref ' + E(p.reference) : ''}</td></tr>
      <tr><td>Received by</td><td>${E(p.received_by_name || '')}</td></tr>
    </tbody></table>
    <div class="sig"><span>Bursar signature</span><span>School stamp</span></div>`);
};

// ------------------------------------------------------------------ EXPENSES
Views.expenses = async () => {
  $v().innerHTML = UI.spin;
  const r = await API.get('/finance/expenses?limit=100');
  $v().innerHTML = `
    <div class="card"><h1>📉 Expenses</h1><button class="btn small" id="ex-new">➕ Record expense</button></div>
    <div class="card tablewrap"><table>
      <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${(r.data || []).map(x => `<tr><td>${UI.dmy(x.date)}</td><td>${E(x.category)}</td>
        <td>${E(x.description || '')}<div class="muted">${E(x.paid_to || '')}</div></td>
        <td class="num">${UI.money(x.amount_cents)}</td></tr>`).join('')}</tbody></table></div>`;
  document.getElementById('ex-new').onclick = () => {
    UI.modal(`<h2>Record expense</h2><form id="exf">
      <div class="row">
        <label class="f grow"><span>Date</span><input type="date" id="ex-date" value="${UI.today()}"></label>
        <label class="f grow"><span>Category</span><select id="ex-cat">
          <option>salaries</option><option>supplies</option><option>maintenance</option>
          <option>utilities</option><option>transport</option><option>other</option></select></label>
      </div>
      <label class="f"><span>Description</span><input type="text" id="ex-desc" required></label>
      <div class="row">
        <label class="f grow"><span>Amount</span><input type="number" id="ex-amt" min="0.01" step="0.01" required></label>
        <label class="f grow"><span>Paid to</span><input type="text" id="ex-to"></label>
      </div>
      <div class="btn-row"><button class="btn">💾 Save</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('exf').onsubmit = async (e) => {
      e.preventDefault();
      const res = await API.post('/finance/expenses', {
        date: document.getElementById('ex-date').value,
        category: document.getElementById('ex-cat').value,
        description: document.getElementById('ex-desc').value.trim(),
        amount_cents: Math.round(Number(document.getElementById('ex-amt').value) * 100),
        paid_to: document.getElementById('ex-to').value.trim() || null,
      }, { label: 'expense' });
      UI.close(); UI.toast(res.queued ? 'Saved offline ✓' : 'Expense recorded ✓'); Views.expenses();
    };
  };
};

// ------------------------------------------------------------------ REPORTS & ANALYTICS
Views.reports = async () => {
  $v().innerHTML = UI.spin;
  const [fin, att, enr, cur] = await Promise.all([
    API.get('/finance/summary').catch(() => null),
    API.get('/reports/attendance-trends').catch(() => ({ data: [] })),
    API.get('/reports/enrollment').catch(() => null),
    API.get('/academics/current').catch(() => ({})),
  ]);
  const months = (att.data || []).map(m => ({
    label: m.month, value: m.marked ? Math.round((m.present + m.late) / m.marked * 100) : 0,
  }));
  $v().innerHTML = `
    <div class="card"><h1>📊 Reports & EMIS</h1>
      <div class="btn-row">
        <a class="btn small secondary" href="/api/reports/emis/enrollment" download>📤 EMIS enrollment CSV</a>
        <a class="btn small secondary" href="/api/reports/emis/staff" download>📤 EMIS staff CSV</a>
        <a class="btn small secondary" href="/api/reports/emis/register" download>📤 Student register CSV</a>
        ${App.can('school_admin') ? '<a class="btn small secondary" href="#/audit">🔍 Audit log</a>' : ''}
      </div>
      <p class="muted">CSV files load directly into the Ministry of Education LEMIS census templates.</p>
    </div>
    ${fin ? `<div class="card"><h2>Income vs expenditure</h2>
      <div class="tiles">
        <div class="tile"><div class="num">${UI.money(fin.income_cents)}</div><div class="lbl">Fee income</div></div>
        <div class="tile"><div class="num">${UI.money(fin.donations_cents)}</div><div class="lbl">Donations & grants</div></div>
        <div class="tile"><div class="num">${UI.money(fin.expenses_cents)}</div><div class="lbl">Expenses</div></div>
        <div class="tile"><div class="num">${UI.money(fin.net_cents)}</div><div class="lbl">Net position</div></div>
      </div>
      <h3>Monthly cash flow</h3>
      ${UI.barChart((fin.cash_flow || []).slice(-6).map(m => ({ label: m.month, value: m.income_cents, value2: m.expense_cents })), { series: ['Income', 'Expenses'], money: true })}
      <h3>Expenses by category</h3>
      ${UI.barChart((fin.expenses_by_category || []).map(c => ({ label: c.category, value: c.cents })), { series: ['Expenses'], money: true })}
    </div>` : ''}
    <div class="card"><h2>Attendance rate by month</h2>${UI.lineChart(months, { suffix: '%' })}</div>
    ${enr ? `<div class="card"><h2>Welfare tracking</h2>
      <div class="tiles">
        <div class="tile"><div class="num">${enr.welfare.ovc || 0}</div><div class="lbl">OVC students supported</div></div>
        <div class="tile"><div class="num">${enr.welfare.reentries || 0}</div><div class="lbl">Girls re-entered after pregnancy</div></div>
        <div class="tile"><div class="num">${enr.welfare.disability || 0}</div><div class="lbl">Students with disability</div></div>
        <div class="tile"><div class="num">${(enr.by_status.find(s => s.status === 'withdrawn') || {}).n || 0}</div><div class="lbl">Withdrawals</div></div>
      </div></div>` : ''}
    <div class="card"><h2>Academic performance by class & subject</h2>
      <div id="perf-out"><button class="btn small secondary" id="perf-load">Load for current term</button></div></div>`;
  document.getElementById('perf-load').onclick = async () => {
    const termId = (cur.term || {}).id;
    if (!termId) return UI.toast('No current term set');
    const p = await API.get(`/reports/performance?term_id=${termId}`);
    document.getElementById('perf-out').innerHTML = `
      <div class="tablewrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th class="num">Avg %</th></tr></thead>
      <tbody>${(p.data || []).map(x => `<tr><td>${E(x.class_name)}</td><td>${E(x.subject_name)}</td>
        <td class="muted">${E(x.teacher_name || '')}</td>
        <td class="num"><span class="chip ${x.avg_pct >= 80 ? 'ok' : x.avg_pct >= 70 ? 'warn' : 'bad'}">${x.avg_pct ?? '—'}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  };
};

Views.audit = async () => {
  $v().innerHTML = UI.spin;
  const r = await API.get('/reports/audit');
  $v().innerHTML = `<div class="card"><h1>🔍 Audit log</h1><p class="muted">Every change: who, what, when.</p></div>
    <div class="card tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead>
    <tbody>${(r.data || []).map(a => `<tr><td class="muted">${E((a.at || '').slice(0, 16))}</td>
      <td>${E(a.user_name || '')}<div class="muted">${E(a.role || '')}</div></td>
      <td>${E(a.action)}${a.entity ? `<div class="muted">${E(a.entity)} #${E(a.entity_id || '')}</div>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
};
