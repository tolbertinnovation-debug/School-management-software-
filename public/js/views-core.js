/* Core views: login, dashboard, students, attendance. Each view renders into
   #view and wires its own handlers. All heavy lists work from the offline cache. */
const Views = {};
const $v = () => document.getElementById('view');
const E = UI.esc;

// ------------------------------------------------------------------ LOGIN
Views.login = () => {
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('bottomnav').style.display = 'none';
  $v().innerHTML = `
  <div class="login-wrap">
    <div class="login-logo">
      <span class="badge">🏫</span>
      <h1>Ma Weade School Suite</h1>
      <p class="muted">School management for Liberia — works offline</p>
    </div>
    <div class="card">
      <div class="tabbtns">
        <button id="tab-staff" class="active">👩🏾‍🏫 Staff</button>
        <button id="tab-parent">👪 Parent / Student</button>
      </div>
      <form id="staff-form">
        <label class="f"><span>Username</span><input type="text" id="l-user" autocomplete="username" required></label>
        <label class="f"><span>Password</span><input type="password" id="l-pass" autocomplete="current-password" required></label>
        <button class="btn" style="width:100%">Sign in</button>
      </form>
      <form id="parent-form" style="display:none">
        <label class="f"><span>Phone number (e.g. +231776…)</span><input type="tel" id="l-phone" autocomplete="tel" required></label>
        <label class="f"><span>PIN (4-6 digits)</span><input type="password" inputmode="numeric" maxlength="6" class="pin-input" id="l-pin" required></label>
        <button class="btn" style="width:100%">Open portal</button>
        <p class="muted" style="margin-top:8px">No PIN? Ask the school office to register your phone number.</p>
      </form>
      <p id="l-err" style="color:var(--red);margin-top:8px"></p>
    </div>
  </div>`;
  const swap = (staff) => {
    document.getElementById('staff-form').style.display = staff ? '' : 'none';
    document.getElementById('parent-form').style.display = staff ? 'none' : '';
    document.getElementById('tab-staff').classList.toggle('active', staff);
    document.getElementById('tab-parent').classList.toggle('active', !staff);
  };
  document.getElementById('tab-staff').onclick = () => swap(true);
  document.getElementById('tab-parent').onclick = () => swap(false);
  const err = (m) => { document.getElementById('l-err').textContent = m; };
  document.getElementById('staff-form').onsubmit = async (e) => {
    e.preventDefault(); err('');
    try {
      const data = await API.raw('POST', '/auth/login', {
        username: document.getElementById('l-user').value.trim(),
        password: document.getElementById('l-pass').value,
      });
      API.setSession(data); location.hash = '#/'; App.route();
    } catch (ex) { err(ex.offline ? 'No connection — connect once to sign in the first time.' : ex.message); }
  };
  document.getElementById('parent-form').onsubmit = async (e) => {
    e.preventDefault(); err('');
    try {
      const data = await API.raw('POST', '/auth/login-pin', {
        phone: document.getElementById('l-phone').value.trim(),
        pin: document.getElementById('l-pin').value,
      });
      API.setSession(data); location.hash = '#/'; App.route();
    } catch (ex) { err(ex.offline ? 'No connection — connect once to sign in the first time.' : ex.message); }
  };
};

// ------------------------------------------------------------------ DASHBOARD
Views.dashboard = async () => {
  $v().innerHTML = UI.spin;
  const me = API.me();
  let d;
  try { d = await API.get('/reports/dashboard'); }
  catch (e) { $v().innerHTML = `<div class="card"><p>${E(e.message)}</p></div>`; return; }
  const enr = d.enrollment || {};
  const att = d.attendance_today || {};
  const attPct = att.marked ? Math.round(att.present / att.marked * 100) : null;
  const actions = [
    ['#/attendance', '✅', 'Roll Call'], ['#/students', '🧑🏾‍🎓', 'Students'],
    ['#/gradebook', '📝', 'Grades'], ['#/fees', '💰', 'Fees'],
    ['#/comms', '💬', 'Messages'], ['#/reports', '📊', 'Reports'],
    ['#/staff', '👩🏾‍🏫', 'Staff'], ['#/library', '📚', 'Library'],
    ['#/transport', '🚌', 'Transport'], ['#/settings', '⚙️', 'Settings'],
  ].filter(([h]) => App.canSee(h));
  $v().innerHTML = `
    ${UI.cachedNote(d)}
    <div class="tiles">
      <div class="tile"><div class="num">${enr.total ?? '—'}</div><div class="lbl">Students (${enr.female ?? 0} girls · ${enr.male ?? 0} boys)</div></div>
      <div class="tile"><div class="num">${attPct === null ? '—' : attPct + '%'}</div><div class="lbl">Present today (${att.marked || 0} marked)</div></div>
      <div class="tile"><div class="num">${UI.money(d.fees_this_month_cents)}</div><div class="lbl">Fees collected this month</div></div>
      <div class="tile"><div class="num">${d.collection && d.collection.rate != null ? d.collection.rate + '%' : '—'}</div><div class="lbl">Fee collection rate</div></div>
    </div>
    <div class="card"><h2>Quick actions</h2><div class="actions">
      ${actions.map(([h, i, l]) => `<a class="action" href="${h}"><span class="ico">${i}</span><span class="lbl">${l}</span></a>`).join('')}
    </div></div>
    <div class="card"><h2>Enrollment by class — girls vs boys</h2>
      ${UI.barChart((d.enrollment_by_class || []).map(c => ({ label: c.name, value: c.girls || 0, value2: (c.students || 0) - (c.girls || 0) })), { series: ['Girls', 'Boys'] })}
    </div>
    <div class="card"><h2>Coming up</h2>
      ${(d.upcoming_events || []).map(ev => `<div class="list-item"><span>${ev.kind === 'holiday' ? '🎉' : ev.kind === 'exam' ? '📝' : '📅'}</span><div class="grow"><b>${E(ev.title)}</b><div class="muted">${UI.dmy(ev.start_date)}</div></div></div>`).join('') || '<p class="muted">Nothing scheduled.</p>'}
    </div>
    ${d.sms_queued ? `<div class="card"><p>📨 <b>${d.sms_queued}</b> SMS waiting in the outbox. <a href="#/comms">Review</a></p></div>` : ''}
  `;
};

// ------------------------------------------------------------------ STUDENTS
Views.students = async () => {
  $v().innerHTML = UI.spin;
  const [stu, cls] = await Promise.all([API.get('/students?limit=2000'), API.get('/academics/classes')]);
  const classes = cls.data || [];
  const byId = Object.fromEntries(classes.map(c => [c.id, c.name]));
  const render = () => {
    const q = (document.getElementById('s-q')?.value || '').toLowerCase();
    const cf = document.getElementById('s-class')?.value || '';
    const rows = (stu.data || []).filter(s =>
      (!q || `${s.first_name} ${s.last_name} ${s.student_no}`.toLowerCase().includes(q)) &&
      (!cf || String(s.class_id) === cf) && s.status === 'active');
    document.getElementById('s-list').innerHTML = rows.slice(0, 200).map(s => `
      <div class="list-item" data-nav="#/student/${s.id}">
        ${UI.avatar(s.photo_path, s.first_name + ' ' + s.last_name)}
        <div class="grow"><b>${E(s.first_name)} ${E(s.last_name)}</b>
          <div class="muted">${E(byId[s.class_id] || 'No class')} · ${E(s.student_no)}</div></div>
        <span class="muted">${s.gender === 'F' ? '♀' : s.gender === 'M' ? '♂' : ''}</span>
      </div>`).join('') || '<p class="muted">No students match.</p>';
    document.getElementById('s-count').textContent = `${rows.length} student(s)`;
  };
  $v().innerHTML = `
    ${UI.cachedNote(stu)}
    <div class="card">
      <div class="row">
        <input type="text" id="s-q" class="grow" placeholder="🔍 Search name or ID…">
        <select id="s-class" style="max-width:150px"><option value="">All classes</option>
          ${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select>
      </div>
      <div class="btn-row">
        ${App.can('school_admin', 'teacher') ? '<button class="btn" id="s-add">➕ Enroll student</button>' : ''}
        ${App.can('school_admin') ? '<button class="btn secondary" id="s-import">📥 Import CSV</button><a class="btn secondary" href="/api/students/export/csv" download>📤 Export</a>' : ''}
      </div>
      <p class="muted" id="s-count"></p>
    </div>
    <div class="card" id="s-list"></div>`;
  render();
  document.getElementById('s-q').oninput = render;
  document.getElementById('s-class').onchange = render;
  const add = document.getElementById('s-add');
  if (add) add.onclick = () => Views.studentForm(null, classes);
  const imp = document.getElementById('s-import');
  if (imp) imp.onclick = () => Views.importStudents(classes);
};

Views.studentForm = (student, classes) => {
  const s = student || {};
  UI.modal(`
    <h2>${s.id ? 'Edit student' : 'Enroll new student'}</h2>
    <form id="sf">
      <div class="row">
        <label class="f grow"><span>First name *</span><input type="text" id="sf-first" value="${E(s.first_name || '')}" required></label>
        <label class="f grow"><span>Last name *</span><input type="text" id="sf-last" value="${E(s.last_name || '')}" required></label>
      </div>
      <div class="row">
        <label class="f grow"><span>Sex</span><select id="sf-gender">
          <option value="">—</option><option value="F" ${s.gender === 'F' ? 'selected' : ''}>Female</option>
          <option value="M" ${s.gender === 'M' ? 'selected' : ''}>Male</option></select></label>
        <label class="f grow"><span>Date of birth</span><input type="date" id="sf-dob" value="${E(s.dob || '')}"></label>
      </div>
      <label class="f"><span>Class</span><select id="sf-class">
        <option value="">—</option>${classes.map(c => `<option value="${c.id}" ${s.class_id === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Community / address</span><input type="text" id="sf-addr" value="${E(s.address || '')}"></label>
      <label class="f"><span>County of origin</span><input type="text" id="sf-county" value="${E(s.county || '')}" placeholder="Montserrado"></label>
      ${App.can('school_admin') ? `
      <div class="row">
        <label class="f"><input type="checkbox" id="sf-ovc" ${s.ovc_flag ? 'checked' : ''}> OVC (orphaned/vulnerable) — confidential</label>
      </div>
      <label class="f"><span>Medical notes</span><input type="text" id="sf-medical" value="${E(s.medical_notes || '')}"></label>` : ''}
      <div class="btn-row">
        <button class="btn">💾 Save</button>
        <button type="button" class="btn secondary" data-close>Cancel</button>
      </div>
    </form>`);
  document.getElementById('sf').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      first_name: document.getElementById('sf-first').value.trim(),
      last_name: document.getElementById('sf-last').value.trim(),
      gender: document.getElementById('sf-gender').value || null,
      dob: document.getElementById('sf-dob').value || null,
      class_id: Number(document.getElementById('sf-class').value) || null,
      address: document.getElementById('sf-addr').value.trim() || null,
      county: document.getElementById('sf-county').value.trim() || null,
    };
    if (document.getElementById('sf-ovc')) {
      body.ovc_flag = document.getElementById('sf-ovc').checked ? 1 : 0;
      body.medical_notes = document.getElementById('sf-medical').value.trim() || null;
    }
    const r = s.id ? await API.put(`/students/${s.id}`, body, { label: 'student update' })
      : await API.post('/students', body, { label: 'new student' });
    UI.close();
    UI.toast(r.queued ? 'Saved offline — will upload when online' : 'Student saved ✓');
    if (s.id) Views.student({ id: s.id }); else Views.students();
  };
};

Views.importStudents = (classes) => {
  UI.modal(`
    <h2>Import students from CSV</h2>
    <p class="muted">Columns (first row): first_name, last_name, gender (M/F), dob (YYYY-MM-DD),
      class_name, county, address. Excel: save as CSV first.</p>
    <input type="file" id="imp-file" accept=".csv,text/csv">
    <div class="btn-row"><button class="btn" id="imp-go">📥 Import</button>
    <button class="btn secondary" data-close>Cancel</button></div>
    <p id="imp-out" class="muted"></p>`);
  document.getElementById('imp-go').onclick = async () => {
    const f = document.getElementById('imp-file').files[0];
    if (!f) return UI.toast('Choose a CSV file first');
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const head = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows = lines.slice(1).map(l => {
      // simple CSV parse with quoted-field support
      const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      return Object.fromEntries(head.map((h, i) => [h, cells[i] || '']));
    });
    try {
      const r = await API.post('/students/import', { rows }, { queueable: false });
      document.getElementById('imp-out').textContent =
        `Imported ${r.created}. Skipped ${r.skipped}. ${(r.errors || []).join(' ')}`;
      UI.toast(`Imported ${r.created} students ✓`);
    } catch (e) { document.getElementById('imp-out').textContent = e.message; }
  };
};

// ------------------------------------------------------------------ STUDENT DETAIL
Views.student = async ({ id }) => {
  $v().innerHTML = UI.spin;
  const [sd, cls] = await Promise.all([API.get(`/students/${id}`), API.get('/academics/classes')]);
  const s = sd.data;
  const classes = cls.data || [];
  const className = (classes.find(c => c.id === s.class_id) || {}).name || 'No class';
  const [guard, stmt, disc] = await Promise.all([
    API.get(`/students/${id}/guardians`).catch(() => ({ data: [] })),
    API.get(`/finance/statement/${id}`).catch(() => null),
    API.get(`/students/${id}/discipline`).catch(() => ({ data: [] })),
  ]);
  const isAdmin = App.can('school_admin');
  $v().innerHTML = `
    <div class="card">
      <div class="row">
        ${UI.avatar(s.photo_path, s.first_name + ' ' + s.last_name)}
        <div class="grow">
          <h1>${E(s.first_name)} ${E(s.middle_name || '')} ${E(s.last_name)}</h1>
          <p class="muted">${E(className)} · ID ${E(s.student_no)} · ${s.gender === 'F' ? 'Female' : s.gender === 'M' ? 'Male' : ''} ${s.dob ? '· born ' + UI.dmy(s.dob) : ''}</p>
          <p>${s.status !== 'active' ? `<span class="chip bad">${E(s.status)}</span>` : '<span class="chip ok">active</span>'}
             ${s.ovc_flag && isAdmin ? '<span class="chip warn">OVC support</span>' : ''}
             ${s.pregnancy_flag && isAdmin ? '<span class="chip warn">re-entry program</span>' : ''}</p>
        </div>
      </div>
      <div class="btn-row no-print">
        ${App.can('school_admin', 'teacher') ? `<button class="btn small" id="st-edit">✏️ Edit</button>
        <button class="btn small secondary" id="st-photo">📷 Photo</button>` : ''}
        <button class="btn small secondary" id="st-card">🪪 ID card</button>
        <a class="btn small secondary" href="#/reportcards?student=${s.id}">📄 Report cards</a>
        ${isAdmin ? `<button class="btn small secondary" id="st-transfer">🔁 Transfer/Withdraw</button>` : ''}
      </div>
      <input type="file" id="st-photo-file" accept="image/*" capture="environment" style="display:none">
    </div>

    <div class="card"><h2>Guardians</h2>
      ${(guard.data || []).map(g => `<div class="list-item"><span>👪</span><div class="grow">
        <b>${E(g.full_name)}</b> <span class="muted">(${E(g.relation || 'guardian')})</span>
        <div class="muted">${E(g.phone || 'no phone')} ${g.is_primary ? '· primary' : ''}</div></div>
        ${g.phone ? `<a href="tel:${E(g.phone)}" class="btn small secondary">📞</a>` : ''}</div>`).join('') || '<p class="muted">None recorded.</p>'}
      ${App.can('school_admin', 'teacher') ? '<button class="btn small" id="st-addg">➕ Add guardian</button>' : ''}
    </div>

    ${stmt ? `<div class="card"><h2>Fees</h2>
      <div class="row"><div class="tile grow"><div class="num">${UI.money(stmt.balance_cents)}</div><div class="lbl">Balance due</div></div>
      <div class="tile grow"><div class="num">${UI.money(stmt.paid_cents)}</div><div class="lbl">Paid so far</div></div></div>
      ${App.can('school_admin', 'accountant') ? `<div class="btn-row"><a class="btn small" href="#/fees?student=${s.id}">💵 Record payment</a></div>` : ''}
    </div>` : ''}

    <div class="card"><h2>Discipline log</h2>
      ${(disc.data || []).slice(0, 5).map(dd => `<div class="list-item"><span>⚠️</span><div class="grow">
        <b>${E(dd.category || 'note')}</b> — ${E(dd.description)}<div class="muted">${UI.dmy(dd.date)} · ${E(dd.action || '')}</div></div></div>`).join('') || '<p class="muted">No entries. 👍</p>'}
      ${App.can('school_admin', 'teacher') ? '<button class="btn small secondary" id="st-disc">➕ Log incident</button>' : ''}
    </div>`;
  const edit = document.getElementById('st-edit');
  if (edit) edit.onclick = () => Views.studentForm(s, classes);
  const addg = document.getElementById('st-addg');
  if (addg) addg.onclick = () => {
    UI.modal(`<h2>Add guardian</h2><form id="gf">
      <label class="f"><span>Full name *</span><input type="text" id="gf-name" required></label>
      <label class="f"><span>Relation</span><select id="gf-rel"><option>mother</option><option>father</option><option>aunt</option><option>uncle</option><option>grandparent</option><option>guardian</option></select></label>
      <label class="f"><span>Phone (becomes their portal login)</span><input type="tel" id="gf-phone" placeholder="+2317…"></label>
      <label class="f"><span>Portal PIN (4-6 digits, optional — default: last 4 of phone)</span><input type="text" inputmode="numeric" id="gf-pin" maxlength="6"></label>
      <div class="btn-row"><button class="btn">💾 Save</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('gf').onsubmit = async (e) => {
      e.preventDefault();
      const r = await API.post(`/students/${id}/guardians`, {
        full_name: document.getElementById('gf-name').value.trim(),
        relation: document.getElementById('gf-rel').value,
        phone: document.getElementById('gf-phone').value.trim() || null,
        pin: document.getElementById('gf-pin').value.trim() || null,
        is_primary: !(guard.data || []).length,
      }, { label: 'guardian' });
      UI.close(); UI.toast(r.queued ? 'Saved offline ✓' : (r.note || 'Guardian added ✓'), 5000);
      Views.student({ id });
    };
  };
  const photoBtn = document.getElementById('st-photo');
  if (photoBtn) {
    const fileEl = document.getElementById('st-photo-file');
    photoBtn.onclick = () => fileEl.click();
    fileEl.onchange = async () => {
      const f = fileEl.files[0]; if (!f) return;
      // client-side compression to ~300x300 JPEG for low bandwidth
      const img = await createImageBitmap(f);
      const size = 300, canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const r = await API.post(`/students/${id}/photo`, { image: dataUrl }, { label: 'photo' });
      UI.toast(r.queued ? 'Photo saved offline ✓' : 'Photo saved ✓');
      Views.student({ id });
    };
  }
  const discBtn = document.getElementById('st-disc');
  if (discBtn) discBtn.onclick = () => {
    UI.modal(`<h2>Log discipline incident</h2><form id="df">
      <label class="f"><span>Category</span><select id="df-cat"><option>lateness</option><option>fighting</option><option>dress code</option><option>disrespect</option><option>property damage</option><option>other</option></select></label>
      <label class="f"><span>What happened? *</span><textarea id="df-desc" rows="3" required></textarea></label>
      <label class="f"><span>Action taken</span><input type="text" id="df-act" placeholder="counseling, parent conference…"></label>
      <label class="f"><input type="checkbox" id="df-vis" checked> Visible to parent in portal</label>
      <div class="btn-row"><button class="btn">💾 Save</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('df').onsubmit = async (e) => {
      e.preventDefault();
      await API.post(`/students/${id}/discipline`, {
        category: document.getElementById('df-cat').value,
        description: document.getElementById('df-desc').value.trim(),
        action: document.getElementById('df-act').value.trim() || null,
        visible_to_parent: document.getElementById('df-vis').checked ? 1 : 0,
      }, { label: 'discipline' });
      UI.close(); UI.toast('Logged ✓'); Views.student({ id });
    };
  };
  const trans = document.getElementById('st-transfer');
  if (trans) trans.onclick = () => {
    UI.modal(`<h2>Transfer / withdrawal</h2><form id="tf">
      <label class="f"><span>Type</span><select id="tf-kind">
        <option value="transfer_out">Transfer out to another school</option>
        <option value="withdrawal">Withdrawal</option>
        <option value="reentry">Re-entry (return to school)</option></select></label>
      <label class="f"><span>Other school (if transfer)</span><input type="text" id="tf-school"></label>
      <label class="f"><span>Reason</span><input type="text" id="tf-reason"></label>
      <div class="btn-row"><button class="btn danger">Confirm</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('tf').onsubmit = async (e) => {
      e.preventDefault();
      await API.post(`/students/${id}/transfer`, {
        kind: document.getElementById('tf-kind').value,
        other_school: document.getElementById('tf-school').value.trim() || null,
        reason: document.getElementById('tf-reason').value.trim() || null,
      }, { label: 'transfer' });
      UI.close(); UI.toast('Status updated ✓'); Views.student({ id });
    };
  };
  document.getElementById('st-card').onclick = () => {
    const sch = API.school() || {};
    UI.printDoc('Student ID', `
      <div style="border:2px solid #000;border-radius:10px;max-width:340px;padding:14px">
        <div class="head"><h2>${E(sch.name || 'School')}</h2><div class="muted">Student Identification Card</div></div>
        <p><b>${E(s.first_name)} ${E(s.last_name)}</b><br>Class: ${E(className)}<br>ID: <b>${E(s.student_no)}</b></p>
        <svg width="220" height="48">${E(s.student_no).split('').map((ch, i) =>
          `<rect x="${i * 7}" y="0" width="${(ch.charCodeAt(0) % 4) + 1}" height="40" fill="#000"></rect>`).join('')}
          <text x="0" y="48" font-size="10">${E(s.student_no)}</text></svg>
        <p class="muted">If found, return to ${E(sch.address || 'the school')}. ${E(sch.phone || '')}</p>
      </div>`);
  };
};

// ------------------------------------------------------------------ ATTENDANCE (roll call)
Views.attendance = async () => {
  $v().innerHTML = UI.spin;
  const cls = await API.get('/academics/classes');
  const classes = cls.data || [];
  $v().innerHTML = `
    <div class="card">
      <h1>✅ Daily roll call</h1>
      <div class="row">
        <select id="a-class" class="grow">${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select>
        <input type="date" id="a-date" value="${UI.today()}" style="max-width:170px">
      </div>
      <div class="btn-row">
        <button class="btn small secondary" id="a-allpresent">✅ Mark all present</button>
        <a class="btn small secondary" href="#/attreport">📈 Reports</a>
      </div>
    </div>
    <div class="card" id="a-sheet"><p class="muted">Pick a class.</p></div>
    <div class="no-print" style="position:sticky;bottom:70px">
      <button class="btn" id="a-save" style="width:100%">💾 Save roll call</button>
    </div>`;
  const state = {};   // student_id -> status
  let sheet = [];
  async function load() {
    const classId = document.getElementById('a-class').value;
    const date = document.getElementById('a-date').value;
    if (!classId || !date) return;
    document.getElementById('a-sheet').innerHTML = UI.spin;
    let resp;
    try { resp = await API.get(`/students/attendance/sheet?class_id=${classId}&date=${date}`); }
    catch (e) { document.getElementById('a-sheet').innerHTML = `<p>${E(e.message)}</p>`; return; }
    sheet = resp.data || [];
    for (const r of sheet) state[r.student_id] = r.status || null;
    document.getElementById('a-sheet').innerHTML = UI.cachedNote(resp) + sheet.map(r => `
      <div class="list-item" style="cursor:default">
        ${UI.avatar(r.photo_path, r.first_name + ' ' + r.last_name)}
        <div class="grow"><b>${E(r.first_name)} ${E(r.last_name)}</b></div>
        <div class="roll" data-sid="${r.student_id}">
          ${['present', 'absent', 'late', 'excused'].map(st =>
            `<button type="button" title="${st}" data-st="${st}" class="${state[r.student_id] === st ? 'sel-' + st : ''}">${st[0].toUpperCase()}</button>`).join('')}
        </div>
      </div>`).join('') || '<p class="muted">No active students in this class.</p>';
    document.querySelectorAll('.roll').forEach(el => {
      el.onclick = (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        const sid = el.dataset.sid, st = btn.dataset.st;
        state[sid] = st;
        el.querySelectorAll('button').forEach(b => b.className = b.dataset.st === st ? 'sel-' + st : '');
      };
    });
  }
  document.getElementById('a-class').onchange = load;
  document.getElementById('a-date').onchange = load;
  document.getElementById('a-allpresent').onclick = () => {
    for (const r of sheet) state[r.student_id] = 'present';
    document.querySelectorAll('.roll').forEach(el => {
      el.querySelectorAll('button').forEach(b => b.className = b.dataset.st === 'present' ? 'sel-present' : '');
    });
  };
  document.getElementById('a-save').onclick = async () => {
    const records = Object.entries(state).filter(([, st]) => st)
      .map(([student_id, status]) => ({ student_id: Number(student_id), status }));
    if (!records.length) return UI.toast('Nothing marked yet');
    const r = await API.post('/students/attendance/bulk', {
      class_id: Number(document.getElementById('a-class').value),
      date: document.getElementById('a-date').value, records,
    }, { label: 'roll call' });
    UI.toast(r.queued ? 'Roll call saved offline — will sync ✓'
      : `Saved ✓ ${r.sms_queued ? `(${r.sms_queued} absence SMS queued)` : ''}`);
  };
  load();
};

// Attendance reports
Views.attreport = async () => {
  const cls = await API.get('/academics/classes');
  const classes = cls.data || [];
  const first = new Date(); first.setDate(1);
  $v().innerHTML = `
    <div class="card"><h1>📈 Attendance report</h1>
      <div class="row">
        <label class="f grow"><span>From</span><input type="date" id="r-from" value="${first.toISOString().slice(0, 10)}"></label>
        <label class="f grow"><span>To</span><input type="date" id="r-to" value="${UI.today()}"></label>
      </div>
      <div class="row">
        <select id="r-class" class="grow"><option value="">All classes</option>
          ${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select>
        <button class="btn" id="r-go">Run</button>
      </div>
    </div>
    <div class="card tablewrap" id="r-out"><p class="muted">Choose dates and press Run.</p></div>`;
  document.getElementById('r-go').onclick = async () => {
    const from = document.getElementById('r-from').value, to = document.getElementById('r-to').value;
    const cf = document.getElementById('r-class').value;
    document.getElementById('r-out').innerHTML = UI.spin;
    const r = await API.get(`/students/attendance/report?from=${from}&to=${to}${cf ? '&class_id=' + cf : ''}`);
    const rows = (r.data || []).filter(x => x.days_marked > 0);
    document.getElementById('r-out').innerHTML = `
      <table><thead><tr><th>Student</th><th>Class</th><th class="num">P</th><th class="num">A</th><th class="num">L</th><th class="num">%</th></tr></thead>
      <tbody>${rows.map(x => {
        const pct = x.days_marked ? Math.round((x.present + x.late) / x.days_marked * 100) : 0;
        return `<tr><td>${E(x.first_name)} ${E(x.last_name)}</td><td>${E(x.class_name || '')}</td>
          <td class="num">${x.present}</td><td class="num">${x.absent}</td><td class="num">${x.late}</td>
          <td class="num"><span class="chip ${pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'bad'}">${pct}%</span></td></tr>`;
      }).join('')}</tbody></table>
      ${rows.length === 0 ? '<p class="muted">No attendance marked in this period.</p>' : ''}`;
  };
};
