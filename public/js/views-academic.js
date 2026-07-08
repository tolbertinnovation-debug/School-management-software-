/* Academic views: gradebook, report cards, timetable, staff & payroll. */

// ------------------------------------------------------------------ GRADEBOOK
Views.gradebook = async () => {
  $v().innerHTML = UI.spin;
  const [cls, cur, yrs] = await Promise.all([
    API.get('/academics/classes'), API.get('/academics/current'), API.get('/academics/years'),
  ]);
  const classes = cls.data || [];
  const yearIds = (yrs.data || []).map(y => y.id);
  let terms = [];
  for (const yid of yearIds.slice(0, 2)) {
    const t = await API.get(`/academics/terms?academic_year_id=${yid}`).catch(() => ({ data: [] }));
    terms = terms.concat(t.data || []);
  }
  const curTerm = cur.term ? cur.term.id : (terms[0] || {}).id;
  $v().innerHTML = `
    <div class="card"><h1>📝 Gradebook</h1>
      <div class="row">
        <select id="g-class" class="grow">${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select>
        <select id="g-term" class="grow">${terms.map(t => `<option value="${t.id}" ${t.id === curTerm ? 'selected' : ''}>${E(t.name)}</option>`).join('')}</select>
      </div>
      <div class="btn-row">
        ${App.can('school_admin', 'teacher') ? '<button class="btn small" id="g-newasm">➕ New assessment</button>' : ''}
        <button class="btn small secondary" id="g-compute">📊 Computed grades</button>
        ${App.can('school_admin', 'teacher') ? '<button class="btn small secondary" id="g-gencards">📄 Generate report cards</button>' : ''}
        ${App.can('school_admin') ? '<button class="btn small secondary" id="g-publish">📣 Publish + SMS parents</button>' : ''}
      </div>
    </div>
    <div class="card" id="g-list">${UI.spin}</div>`;
  const classId = () => Number(document.getElementById('g-class').value);
  const termId = () => Number(document.getElementById('g-term').value);

  async function loadAssessments() {
    const el = document.getElementById('g-list');
    el.innerHTML = UI.spin;
    const r = await API.get(`/grades/assessments?class_id=${classId()}&term_id=${termId()}&limit=100`);
    const subs = await API.get('/academics/subjects');
    const subName = Object.fromEntries((subs.data || []).map(s => [s.id, s.name]));
    el.innerHTML = `<h2>Assessments</h2>` + ((r.data || []).map(a => `
      <div class="list-item" data-aid="${a.id}">
        <span>${{ quiz: '❓', test: '📃', assignment: '📚', project: '🛠', exam: '🎓' }[a.kind] || '📃'}</span>
        <div class="grow"><b>${E(a.title)}</b>
          <div class="muted">${E(subName[a.subject_id] || '')} · ${E(a.kind)} · max ${a.max_score}</div></div>
        <span class="btn small secondary">Enter scores</span>
      </div>`).join('') || '<p class="muted">No assessments yet for this class & term.</p>');
    el.querySelectorAll('[data-aid]').forEach(row => {
      row.onclick = () => Views.scoreEntry(Number(row.dataset.aid));
    });
  }
  document.getElementById('g-class').onchange = loadAssessments;
  document.getElementById('g-term').onchange = loadAssessments;

  const newBtn = document.getElementById('g-newasm');
  if (newBtn) newBtn.onclick = async () => {
    const subs = await API.get('/academics/subjects');
    UI.modal(`<h2>New assessment</h2><form id="af">
      <label class="f"><span>Subject</span><select id="af-sub">${(subs.data || []).map(s => `<option value="${s.id}">${E(s.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Type</span><select id="af-kind">
        <option value="quiz">Quiz (CA)</option><option value="test">Class test (CA)</option>
        <option value="assignment">Assignment (CA)</option><option value="project">Project (CA)</option>
        <option value="exam">Semester exam</option></select></label>
      <label class="f"><span>Title *</span><input type="text" id="af-title" required placeholder="Quiz 2 — Fractions"></label>
      <div class="row">
        <label class="f grow"><span>Max score</span><input type="number" id="af-max" value="100" min="1"></label>
        <label class="f grow"><span>Date</span><input type="date" id="af-date" value="${UI.today()}"></label>
      </div>
      <div class="btn-row"><button class="btn">💾 Create</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('af').onsubmit = async (e) => {
      e.preventDefault();
      const r = await API.post('/grades/assessments', {
        class_id: classId(), term_id: termId(),
        subject_id: Number(document.getElementById('af-sub').value),
        kind: document.getElementById('af-kind').value,
        title: document.getElementById('af-title').value.trim(),
        max_score: Number(document.getElementById('af-max').value),
        date: document.getElementById('af-date').value,
      }, { label: 'assessment' });
      UI.close(); UI.toast(r.queued ? 'Saved offline ✓' : 'Assessment created ✓');
      loadAssessments();
    };
  };

  document.getElementById('g-compute').onclick = async () => {
    const el = document.getElementById('g-list');
    el.innerHTML = UI.spin;
    const g = await API.get(`/grades/gradebook?class_id=${classId()}&term_id=${termId()}`);
    const subjects = g.subjects || [];
    el.innerHTML = `<h2>Computed grades (CA ${Math.round((g.config?.ca_weight || .4) * 100)}% + Exam ${Math.round((g.config?.exam_weight || .6) * 100)}%)</h2>
      <div class="tablewrap"><table><thead><tr><th>Student</th>${subjects.map(s => `<th class="num">${E(s.name.slice(0, 8))}</th>`).join('')}<th class="num">Avg</th><th class="num">Rank</th></tr></thead>
      <tbody>${(g.students || []).map(st => {
        const r = (g.results || {})[st.id] || { subjects: {} };
        return `<tr><td>${E(st.first_name)} ${E(st.last_name)}</td>
          ${subjects.map(s => {
            const x = r.subjects[s.id];
            return `<td class="num">${x ? `${x.final} <span class="muted">${x.letter}</span>` : '—'}</td>`;
          }).join('')}
          <td class="num"><b>${r.average ?? '—'}</b></td><td class="num">${r.rank ?? '—'}</td></tr>`;
      }).join('')}</tbody></table></div>
      <button class="btn small secondary" id="g-back">← Back to assessments</button>`;
    document.getElementById('g-back').onclick = loadAssessments;
  };

  const gen = document.getElementById('g-gencards');
  if (gen) gen.onclick = async () => {
    const r = await API.post('/grades/report-cards/generate', { class_id: classId(), term_id: termId() }, { label: 'report cards' });
    UI.toast(r.queued ? 'Will generate when online' : `Generated ${r.generated} report cards ✓`);
  };
  const pub = document.getElementById('g-publish');
  if (pub) pub.onclick = async () => {
    if (!confirm('Publish report cards to the parent portal and send SMS notifications?')) return;
    const r = await API.post('/grades/report-cards/publish', { class_id: classId(), term_id: termId() }, { label: 'publish cards' });
    UI.toast(r.queued ? 'Will publish when online' : `Published ${r.published} ✓ (${r.sms_queued} SMS queued)`);
  };
  loadAssessments();
};

// Score entry grid for one assessment
Views.scoreEntry = async (assessmentId) => {
  const r = await API.get(`/grades/assessments/${assessmentId}/scores`);
  const a = r.assessment;
  UI.modal(`<h2>${E(a.title)}</h2><p class="muted">Max score: ${a.max_score}. Leave blank if not taken.</p>
    <form id="scf"><div class="tablewrap"><table>
      <thead><tr><th>Student</th><th style="width:110px">Score</th></tr></thead>
      <tbody>${(r.data || []).map(s => `
        <tr><td>${E(s.first_name)} ${E(s.last_name)}</td>
        <td><input type="number" inputmode="decimal" step="0.5" min="0" max="${a.max_score}"
             data-sid="${s.student_id}" value="${s.score ?? ''}" style="min-height:38px"></td></tr>`).join('')}
      </tbody></table></div>
      <div class="btn-row"><button class="btn">💾 Save scores</button>
      <button type="button" class="btn secondary" data-close>Close</button></div></form>`);
  document.getElementById('scf').onsubmit = async (e) => {
    e.preventDefault();
    const scores = [...document.querySelectorAll('#scf input[data-sid]')].map(i => ({
      student_id: Number(i.dataset.sid), score: i.value === '' ? null : Number(i.value),
    }));
    const res = await API.post(`/grades/assessments/${assessmentId}/scores`, { scores }, { label: 'scores' });
    UI.close();
    UI.toast(res.queued ? 'Scores saved offline ✓' : `Saved ${res.saved} scores ✓${res.rejected ? ` (${res.rejected} out of range, skipped)` : ''}`);
  };
};

// ------------------------------------------------------------------ REPORT CARDS
Views.reportcards = async ({ student } = {}) => {
  $v().innerHTML = UI.spin;
  const isParent = ['parent', 'student'].includes(API.me().role);
  let students = [];
  if (isParent) {
    const home = await API.get('/portal/home');
    students = (home.children || []).map(c => ({ id: c.id, name: c.name }));
  } else {
    const r = await API.get('/students?limit=2000');
    students = (r.data || []).filter(s => s.status === 'active').map(s => ({ id: s.id, name: `${s.first_name} ${s.last_name}` }));
  }
  const yrs = await API.get('/academics/years');
  let terms = [];
  for (const y of (yrs.data || []).slice(0, 2)) {
    const t = await API.get(`/academics/terms?academic_year_id=${y.id}`).catch(() => ({ data: [] }));
    terms = terms.concat((t.data || []).map(x => ({ ...x, year: y.name })));
  }
  $v().innerHTML = `
    <div class="card"><h1>📄 Report cards</h1>
      <div class="row">
        <select id="rc-student" class="grow">${students.map(s => `<option value="${s.id}" ${String(s.id) === String(student) ? 'selected' : ''}>${E(s.name)}</option>`).join('')}</select>
        <select id="rc-term" class="grow">${terms.map(t => `<option value="${t.id}">${E(t.year)} — ${E(t.name)}</option>`).join('')}</select>
      </div>
      <div class="btn-row"><button class="btn" id="rc-view">View</button></div>
    </div>
    <div id="rc-out"></div>`;
  document.getElementById('rc-view').onclick = async () => {
    const sid = document.getElementById('rc-student').value;
    const tid = document.getElementById('rc-term').value;
    const out = document.getElementById('rc-out');
    out.innerHTML = UI.spin;
    let d;
    try { d = await API.get(`/grades/report-cards/${sid}/${tid}`); }
    catch (e) { out.innerHTML = `<div class="card"><p>${E(e.message)}</p></div>`; return; }
    const c = d.card;
    const rows = Object.entries(c.data).map(([subId, x]) =>
      ({ name: d.subjects[subId] || `Subject ${subId}`, ...x }));
    const html = `
      <div class="print-head">
        <h2>${E((d.school || {}).name || '')}</h2>
        <div class="muted">${E((d.school || {}).address || '')} · ${E((d.school || {}).phone || '')}</div>
        <b>STUDENT REPORT CARD — ${E(c.year_name)} ${E(c.term_name)}</b>
      </div>
      <p><b>${E(c.first_name)} ${E(c.middle_name || '')} ${E(c.last_name)}</b> · ${E(c.class_name || '')} · ID ${E(c.student_no)}</p>
      <table><thead><tr><th>Subject</th><th>CA (40%)</th><th>Exam (60%)</th><th>Final</th><th>Grade</th><th>Remark</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${E(r.name)}</td><td>${r.ca ?? '—'}</td><td>${r.exam ?? '—'}</td>
        <td><b>${r.final}</b></td><td>${E(r.letter)}</td><td>${E(r.remark)}</td></tr>`).join('')}</tbody></table>
      <p><b>Average: ${c.average ?? '—'}%</b> · Rank: ${c.rank ?? '—'} of ${c.class_size ?? '—'}
         · Days present: ${c.days_present ?? '—'} · absent: ${c.days_absent ?? '—'}</p>
      <p><b>Sponsor's remarks:</b> ${E(c.remarks || '—')}</p>
      <div class="sig"><span>Class Sponsor</span><span>Principal</span></div>`;
    out.innerHTML = `<div class="card">
      ${c.published ? '<span class="chip ok">published</span>' : '<span class="chip warn">draft — not yet visible to parents</span>'}
      <div class="print-doc" style="margin-top:10px">${html}</div>
      <div class="btn-row no-print"><button class="btn" id="rc-print">🖨 Print / PDF</button></div></div>`;
    document.getElementById('rc-print').onclick = () => UI.printDoc('Report card', html);
  };
  if (student) document.getElementById('rc-view').click();
};

// ------------------------------------------------------------------ TIMETABLE
Views.timetable = async () => {
  const cls = await API.get('/academics/classes');
  const classes = cls.data || [];
  $v().innerHTML = `
    <div class="card"><h1>🗓 Timetable</h1>
      <select id="tt-class">${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select>
    </div><div class="card tablewrap" id="tt-out"></div>`;
  const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  async function load() {
    const r = await API.get(`/academics/timetable-grid?class_id=${document.getElementById('tt-class').value}`);
    const byDay = {};
    for (const s of r.data || []) (byDay[s.weekday] ||= []).push(s);
    document.getElementById('tt-out').innerHTML = Object.keys(byDay).length
      ? Object.entries(byDay).map(([d, slots]) => `
        <h3 style="margin:10px 0 4px">${DAYS[d]}</h3>
        <table><tbody>${slots.map(s => `<tr><td>${E(s.start_time)}–${E(s.end_time)}</td>
          <td><b>${E(s.subject_name)}</b></td><td class="muted">${E(s.teacher_name || '')}</td><td class="muted">${E(s.room || '')}</td></tr>`).join('')}
        </tbody></table>`).join('')
      : '<p class="muted">No timetable set for this class yet. The administrator can add periods in Settings → Timetable.</p>';
  }
  document.getElementById('tt-class').onchange = load;
  load();
};

// ------------------------------------------------------------------ STAFF
Views.staff = async () => {
  $v().innerHTML = UI.spin;
  const r = await API.get('/staff/directory/list');
  $v().innerHTML = `
    ${UI.cachedNote(r)}
    <div class="card"><h1>👩🏾‍🏫 Staff</h1>
      <div class="btn-row">
        ${App.can('school_admin') ? `<button class="btn small" id="stf-att">✅ Staff attendance today</button>` : ''}
        <a class="btn small secondary" href="#/leaves">🏖 Leave requests</a>
        ${App.can('school_admin', 'accountant') ? '<a class="btn small secondary" href="#/payroll">💵 Payroll</a>' : ''}
      </div></div>
    <div class="card">${(r.data || []).map(s => `
      <div class="list-item" style="cursor:default">
        ${UI.avatar(null, s.full_name)}
        <div class="grow"><b>${E(s.full_name || s.staff_no)}</b>
          <div class="muted">${E(s.position || '')} · ${E(s.qualification || '')} · ${E(s.payroll_type)} payroll</div></div>
        ${s.phone ? `<a class="btn small secondary" href="tel:${E(s.phone)}">📞</a>` : ''}
      </div>`).join('')}</div>`;
  const attBtn = document.getElementById('stf-att');
  if (attBtn) attBtn.onclick = async () => {
    const sheet = await API.get(`/staff/attendance/sheet?date=${UI.today()}`);
    const state = {};
    for (const row of sheet.data || []) state[row.staff_id] = row.status || null;
    UI.modal(`<h2>Staff attendance — ${UI.dmy(UI.today())}</h2>
      ${(sheet.data || []).map(row => `
        <div class="list-item" style="cursor:default"><div class="grow">${E(row.full_name || row.staff_no)}</div>
        <div class="roll" data-sid="${row.staff_id}">
          ${['present', 'absent', 'late', 'leave'].map(st => `<button type="button" data-st="${st}"
            class="${state[row.staff_id] === st ? 'sel-' + (st === 'leave' ? 'excused' : st) : ''}">${st[0].toUpperCase()}</button>`).join('')}
        </div></div>`).join('')}
      <div class="btn-row"><button class="btn" id="stf-save">💾 Save</button></div>`);
    document.querySelectorAll('#modal .roll').forEach(el => {
      el.onclick = (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        state[el.dataset.sid] = btn.dataset.st;
        el.querySelectorAll('button').forEach(b =>
          b.className = b.dataset.st === btn.dataset.st ? 'sel-' + (btn.dataset.st === 'leave' ? 'excused' : btn.dataset.st) : '');
      };
    });
    document.getElementById('stf-save').onclick = async () => {
      const records = Object.entries(state).filter(([, st]) => st)
        .map(([staff_id, status]) => ({ staff_id: Number(staff_id), status }));
      const res = await API.post('/staff/attendance/bulk', { date: UI.today(), records }, { label: 'staff attendance' });
      UI.close(); UI.toast(res.queued ? 'Saved offline ✓' : 'Saved ✓');
    };
  };
};

// Leaves
Views.leaves = async () => {
  $v().innerHTML = UI.spin;
  const [lv, dir] = await Promise.all([API.get('/staff/leaves?limit=100'), API.get('/staff/directory/list')]);
  const staffName = Object.fromEntries((dir.data || []).map(s => [s.id, s.full_name || s.staff_no]));
  const isAdmin = App.can('school_admin');
  $v().innerHTML = `
    <div class="card"><h1>🏖 Leave management</h1>
      <button class="btn small" id="lv-new">➕ Request leave</button></div>
    <div class="card">${(lv.data || []).map(l => `
      <div class="list-item" style="cursor:default"><span>${{ sick: '🤒', annual: '🌴', maternity: '🤱', emergency: '🚨', study: '📖' }[l.kind] || '🏖'}</span>
        <div class="grow"><b>${E(staffName[l.staff_id] || ('Staff #' + l.staff_id))}</b> — ${E(l.kind)}
          <div class="muted">${UI.dmy(l.start_date)} → ${UI.dmy(l.end_date)} ${l.reason ? '· ' + E(l.reason) : ''}</div></div>
        ${l.status === 'pending' && isAdmin
          ? `<button class="btn small" data-approve="${l.id}">✔</button><button class="btn small danger" data-reject="${l.id}">✖</button>`
          : `<span class="chip ${l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'bad' : 'warn'}">${E(l.status)}</span>`}
      </div>`).join('') || '<p class="muted">No leave requests.</p>'}</div>`;
  document.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    await API.put(`/staff/leaves/${b.dataset.approve}`, { status: 'approved' }, { label: 'leave approval' });
    UI.toast('Approved ✓'); Views.leaves();
  });
  document.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
    await API.put(`/staff/leaves/${b.dataset.reject}`, { status: 'rejected' }, { label: 'leave rejection' });
    UI.toast('Rejected'); Views.leaves();
  });
  document.getElementById('lv-new').onclick = () => {
    UI.modal(`<h2>Request leave</h2><form id="lf">
      <label class="f"><span>Staff member</span><select id="lf-staff">${(dir.data || []).map(s => `<option value="${s.id}">${E(s.full_name || s.staff_no)}</option>`).join('')}</select></label>
      <label class="f"><span>Type</span><select id="lf-kind"><option>sick</option><option>annual</option><option>maternity</option><option>emergency</option><option>study</option></select></label>
      <div class="row">
        <label class="f grow"><span>From</span><input type="date" id="lf-from" required></label>
        <label class="f grow"><span>To</span><input type="date" id="lf-to" required></label>
      </div>
      <label class="f"><span>Reason</span><input type="text" id="lf-reason"></label>
      <div class="btn-row"><button class="btn">Submit</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      await API.post('/staff/leaves', {
        staff_id: Number(document.getElementById('lf-staff').value),
        kind: document.getElementById('lf-kind').value,
        start_date: document.getElementById('lf-from').value,
        end_date: document.getElementById('lf-to').value,
        reason: document.getElementById('lf-reason').value.trim() || null,
      }, { label: 'leave request' });
      UI.close(); UI.toast('Request submitted ✓'); Views.leaves();
    };
  };
};

// Payroll
Views.payroll = async () => {
  $v().innerHTML = UI.spin;
  const period = new Date().toISOString().slice(0, 7);
  const [slips, dir] = await Promise.all([API.get('/staff/payroll?limit=200'), API.get('/staff/directory/list')]);
  const staffName = Object.fromEntries((dir.data || []).map(s => [s.id, s.full_name || s.staff_no]));
  $v().innerHTML = `
    <div class="card"><h1>💵 Payroll (school-funded staff)</h1>
      <p class="muted">Government payroll teachers are tracked in Staff — the school does not compute their pay.</p>
      <div class="row"><input type="month" id="pr-period" value="${period}" style="max-width:180px">
      <button class="btn" id="pr-gen">Generate drafts</button></div></div>
    <div class="card tablewrap"><table>
      <thead><tr><th>Staff</th><th>Period</th><th class="num">Net</th><th>Status</th><th></th></tr></thead>
      <tbody>${(slips.data || []).map(p => `
        <tr><td>${E(staffName[p.staff_id] || ('#' + p.staff_id))}</td><td>${E(p.period)}</td>
        <td class="num">${UI.money(p.net_cents)}</td>
        <td><span class="chip ${p.status === 'paid' ? 'ok' : p.status === 'approved' ? 'warn' : 'neutral'}">${E(p.status)}</span></td>
        <td><button class="btn small secondary" data-slip="${p.id}">🖨</button>
            ${p.status !== 'paid' ? `<button class="btn small" data-pay="${p.id}">Mark paid</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  document.getElementById('pr-gen').onclick = async () => {
    const r = await API.post('/staff/payroll/generate', { period: document.getElementById('pr-period').value }, { label: 'payroll' });
    UI.toast(r.queued ? 'Will generate when online' : `Created ${r.created} draft payslips ✓`);
    if (!r.queued) Views.payroll();
  };
  document.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
    await API.put(`/staff/payroll/${b.dataset.pay}`, { status: 'paid' }, { label: 'payslip paid' });
    UI.toast('Marked paid ✓'); Views.payroll();
  });
  document.querySelectorAll('[data-slip]').forEach(b => b.onclick = async () => {
    const d = await API.get(`/staff/payroll/${b.dataset.slip}/slip`);
    const s = d.slip, sch = d.school || {};
    UI.printDoc('Payslip', `
      <div class="head"><h2>${E(sch.name || '')}</h2><b>PAYSLIP — ${E(s.period)}</b></div>
      <p><b>${E(s.full_name || '')}</b> · ${E(s.position || '')} · Staff No ${E(s.staff_no || '')}</p>
      <table><tbody>
        <tr><td>Basic salary</td><td style="text-align:right">${UI.money(s.gross_cents)}</td></tr>
        ${s.allowances.map(a => `<tr><td>+ ${E(a.name)}</td><td style="text-align:right">${UI.money(a.cents)}</td></tr>`).join('')}
        ${s.deductions.map(a => `<tr><td>− ${E(a.name)}</td><td style="text-align:right">${UI.money(a.cents)}</td></tr>`).join('')}
        <tr><td><b>NET PAY</b></td><td style="text-align:right"><b>${UI.money(s.net_cents)}</b></td></tr>
      </tbody></table>
      <p class="muted">Paid to: ${E(s.bank_or_momo || 'cash')} · Status: ${E(s.status)}${s.paid_date ? ' on ' + UI.dmy(s.paid_date) : ''}</p>
      <div class="sig"><span>Bursar</span><span>Employee</span></div>`);
  });
};
