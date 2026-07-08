/* Remaining views: comms, transport, library, settings, parent portal, sync. */

// ------------------------------------------------------------------ COMMUNICATION
Views.comms = async () => {
  $v().innerHTML = UI.spin;
  const me = API.me();
  const [ann, msgs] = await Promise.all([
    API.get('/comms/announcements?limit=20'),
    App.can('school_admin', 'teacher', 'accountant') ? API.get('/comms/messages?limit=100') : Promise.resolve({ data: [] }),
  ]);
  const queued = (msgs.data || []).filter(m => m.status === 'queued').length;
  $v().innerHTML = `
    <div class="card"><h1>💬 Communication</h1>
      <div class="btn-row">
        ${App.can('school_admin', 'accountant') ? '<button class="btn small" id="c-bulk">📨 Bulk SMS</button>' : ''}
        ${App.can('school_admin', 'teacher') ? '<button class="btn small secondary" id="c-ann">📢 New announcement</button>' : ''}
        ${App.can('school_admin') ? '<button class="btn small danger" id="c-emergency">🚨 Emergency alert</button>' : ''}
      </div></div>
    ${queued ? `<div class="card"><h2>📤 SMS outbox — ${queued} waiting</h2>
      <p class="muted">No SMS gateway is connected (offline mode). Export the list and send from any phone, then mark as sent.</p>
      <div class="btn-row">
        <a class="btn small secondary" href="/api/comms/messages/export-queued" download>📥 Export queued as CSV</a>
        <button class="btn small secondary" id="c-marksent">✔ Mark all queued as sent</button>
      </div></div>` : ''}
    <div class="card"><h2>📢 Announcements</h2>
      ${(ann.data || []).map(a => `<div class="list-item" style="cursor:default"><span>📢</span>
        <div class="grow"><b>${E(a.title)}</b><div class="muted">${UI.dmy(a.publish_date)} · to ${E(a.audience)}</div>
        <div>${E(a.body)}</div></div></div>`).join('') || '<p class="muted">Nothing posted yet.</p>'}</div>
    ${(msgs.data || []).length ? `<div class="card"><h2>Recent messages</h2><div class="tablewrap"><table>
      <thead><tr><th>To</th><th>Message</th><th>Status</th></tr></thead>
      <tbody>${(msgs.data || []).slice(0, 50).map(m => `<tr>
        <td>${E(m.to_phone || m.to_user_name || '')}<div class="muted">${E(m.trigger || '')}</div></td>
        <td style="white-space:normal;max-width:280px">${E(m.body.slice(0, 90))}${m.body.length > 90 ? '…' : ''}</td>
        <td><span class="chip ${m.status === 'sent' || m.status === 'delivered' ? 'ok' : m.status === 'failed' ? 'bad' : 'warn'}">${E(m.status)}</span></td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
  const bulk = document.getElementById('c-bulk');
  if (bulk) bulk.onclick = async () => {
    const cls = await API.get('/academics/classes');
    UI.modal(`<h2>📨 Bulk SMS</h2><form id="bf">
      <label class="f"><span>Send to</span><select id="bf-to">
        <option value="all_parents">All parents</option>
        ${(cls.data || []).map(c => `<option value="class:${c.id}">Parents of ${E(c.name)}</option>`).join('')}
        <option value="staff">All staff</option></select></label>
      <label class="f"><span>Message (keep short — 1 SMS = 160 characters)</span>
        <textarea id="bf-body" rows="4" maxlength="320" required></textarea></label>
      <div class="btn-row"><button class="btn">Send</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('bf').onsubmit = async (e) => {
      e.preventDefault();
      const r = await API.post('/comms/bulk-sms', {
        to: document.getElementById('bf-to').value,
        body: document.getElementById('bf-body').value.trim(),
      }, { label: 'bulk SMS' });
      UI.close(); UI.toast(r.queued ? 'Will queue when online' : `${r.sms_queued} SMS queued ✓`); Views.comms();
    };
  };
  const annBtn = document.getElementById('c-ann');
  if (annBtn) annBtn.onclick = () => {
    UI.modal(`<h2>📢 New announcement</h2><form id="anf">
      <label class="f"><span>Title *</span><input type="text" id="an-title" required></label>
      <label class="f"><span>Message *</span><textarea id="an-body" rows="4" required></textarea></label>
      <label class="f"><span>Audience</span><select id="an-aud"><option value="all">Everyone</option>
        <option value="parents">Parents</option><option value="staff">Staff</option></select></label>
      <div class="btn-row"><button class="btn">Post</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('anf').onsubmit = async (e) => {
      e.preventDefault();
      await API.post('/comms/announcements', {
        title: document.getElementById('an-title').value.trim(),
        body: document.getElementById('an-body').value.trim(),
        audience: document.getElementById('an-aud').value,
      }, { label: 'announcement' });
      UI.close(); UI.toast('Posted ✓'); Views.comms();
    };
  };
  const emg = document.getElementById('c-emergency');
  if (emg) emg.onclick = () => {
    UI.modal(`<h2>🚨 Emergency alert</h2>
      <p class="muted">Sends an URGENT SMS to every parent and staff member. Use for closures and emergencies only.</p>
      <form id="ef"><label class="f"><span>Message *</span><textarea id="ef-body" rows="3" required
        placeholder="School closed tomorrow due to heavy flooding. Stay safe."></textarea></label>
      <div class="btn-row"><button class="btn danger">Send to everyone</button>
      <button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('ef').onsubmit = async (e) => {
      e.preventDefault();
      const r = await API.post('/comms/emergency', { body: document.getElementById('ef-body').value.trim() }, { label: 'emergency alert' });
      UI.close(); UI.toast(r.queued ? 'Will send when online' : `${r.sms_queued} alerts queued ✓`);
    };
  };
  const marksent = document.getElementById('c-marksent');
  if (marksent) marksent.onclick = async () => {
    const ids = (msgs.data || []).filter(m => m.status === 'queued').map(m => m.id);
    await API.post('/comms/messages/mark-sent', { message_ids: ids }, { label: 'mark sent' });
    UI.toast('Marked as sent ✓'); Views.comms();
  };
};

// ------------------------------------------------------------------ TRANSPORT
Views.transport = async () => {
  $v().innerHTML = UI.spin;
  const [routes, vehicles] = await Promise.all([API.get('/transport/routes'), API.get('/transport/vehicles')]);
  $v().innerHTML = `
    <div class="card"><h1>🚌 Transport</h1></div>
    ${(routes.data || []).map(r => {
      const stops = JSON.parse(r.stops_json || '[]');
      return `<div class="card"><h2>${E(r.name)}</h2>
        <p class="muted">${stops.map(s => `${E(s.name)} ${E(s.time || '')}`).join(' → ')}</p>
        <p>Fee: <b>${UI.money(r.fee_cents)}</b> / term</p>
        <div class="btn-row">
          <button class="btn small" data-roll="${r.id}">✅ Bus roll call</button>
          <button class="btn small secondary" data-roster="${r.id}">👥 Roster</button>
        </div></div>`;
    }).join('') || '<div class="card"><p class="muted">No routes yet.</p></div>'}
    <div class="card"><h2>Vehicles</h2>${(vehicles.data || []).map(vv => `
      <div class="list-item" style="cursor:default"><span>🚌</span><div class="grow"><b>${E(vv.plate_no)}</b>
      <div class="muted">${E(vv.model || '')} · ${vv.capacity || '?'} seats</div></div>
      <span class="chip ${vv.status === 'active' ? 'ok' : 'warn'}">${E(vv.status)}</span></div>`).join('')}</div>`;
  document.querySelectorAll('[data-roster]').forEach(b => b.onclick = async () => {
    const r = await API.get(`/transport/routes/${b.dataset.roster}/roster`);
    UI.modal(`<h2>Route roster</h2>${(r.data || []).map(x => `
      <div class="list-item" style="cursor:default"><div class="grow"><b>${E(x.first_name)} ${E(x.last_name)}</b>
      <div class="muted">${E(x.class_name || '')} · stop: ${E(x.stop || '?')}</div></div></div>`).join('') || '<p class="muted">Empty.</p>'}
      <div class="btn-row"><button class="btn secondary" data-close>Close</button></div>`);
  });
  document.querySelectorAll('[data-roll]').forEach(b => b.onclick = async () => {
    const routeId = Number(b.dataset.roll);
    const r = await API.get(`/transport/routes/${routeId}/roster`);
    const state = {};
    UI.modal(`<h2>Bus roll call — ${UI.dmy(UI.today())}</h2>
      <label class="f"><span>Trip</span><select id="br-trip"><option value="morning">Morning pickup</option>
      <option value="afternoon">Afternoon drop-off</option></select></label>
      ${(r.data || []).map(x => `<div class="list-item" style="cursor:default">
        <div class="grow">${E(x.first_name)} ${E(x.last_name)} <span class="muted">(${E(x.stop || '?')})</span></div>
        <div class="roll" data-sid="${x.student_id}">
          <button type="button" data-st="1">✓</button><button type="button" data-st="0">✗</button>
        </div></div>`).join('')}
      <div class="btn-row"><button class="btn" id="br-save">💾 Save</button></div>`);
    document.querySelectorAll('#modal .roll').forEach(el => {
      el.onclick = (e) => {
        const btn = e.target.closest('button'); if (!btn) return;
        state[el.dataset.sid] = btn.dataset.st === '1';
        el.querySelectorAll('button').forEach(x =>
          x.className = x === btn ? (btn.dataset.st === '1' ? 'sel-present' : 'sel-absent') : '');
      };
    });
    document.getElementById('br-save').onclick = async () => {
      const records = Object.entries(state).map(([student_id, boarded]) => ({ student_id: Number(student_id), boarded }));
      if (!records.length) return UI.toast('Mark someone first');
      const res = await API.post('/transport/bus-attendance/bulk', {
        route_id: routeId, date: UI.today(),
        trip: document.getElementById('br-trip').value, records,
      }, { label: 'bus roll call' });
      UI.close(); UI.toast(res.queued ? 'Saved offline ✓' : 'Saved ✓');
    };
  });
};

// ------------------------------------------------------------------ LIBRARY & INVENTORY
Views.library = async () => {
  $v().innerHTML = UI.spin;
  const [loans, low] = await Promise.all([
    API.get('/library/loans?open=1'), API.get('/library/assets-low-stock').catch(() => ({ data: [] })),
  ]);
  const overdue = (loans.data || []).filter(l => l.due_date < UI.today());
  $v().innerHTML = `
    <div class="card"><h1>📚 Library & inventory</h1>
      <div class="row"><input type="text" id="lb-q" class="grow" placeholder="🔍 Search books…"><button class="btn" id="lb-search">Go</button></div>
      <div class="btn-row">
        ${App.can('school_admin', 'teacher') ? '<button class="btn small" id="lb-addbook">➕ Add book</button>' : ''}
        ${App.can('school_admin') ? '<a class="btn small secondary" href="#/assets">🏷 Assets</a>' : ''}
      </div></div>
    <div class="card" id="lb-results"></div>
    <div class="card"><h2>Loans out (${(loans.data || []).length}) ${overdue.length ? `— <span style="color:var(--red)">${overdue.length} overdue</span>` : ''}</h2>
      ${(loans.data || []).map(l => `<div class="list-item" style="cursor:default"><span>${l.due_date < UI.today() ? '⏰' : '📖'}</span>
        <div class="grow"><b>${E(l.title)}</b><div class="muted">${E(l.student_name || l.staff_name || '')} · due ${UI.dmy(l.due_date)}</div></div>
        ${App.can('school_admin', 'teacher') ? `<button class="btn small" data-return="${l.id}">Return</button>` : ''}</div>`).join('') || '<p class="muted">Nothing out.</p>'}
    </div>
    ${(low.data || []).length ? `<div class="card"><h2>⚠️ Low stock</h2>
      ${(low.data || []).map(a => `<div class="list-item" style="cursor:default"><div class="grow">${E(a.name)}</div>
      <span class="chip warn">${a.quantity} left</span></div>`).join('')}</div>` : ''}`;
  async function search() {
    const q = document.getElementById('lb-q').value.trim();
    const r = await API.get(`/library/search?q=${encodeURIComponent(q)}`);
    document.getElementById('lb-results').innerHTML = (r.data || []).map(bk => `
      <div class="list-item" style="cursor:default"><span>📕</span>
        <div class="grow"><b>${E(bk.title)}</b><div class="muted">${E(bk.author || '')} · ${E(bk.category || '')} · shelf ${E(bk.shelf || '?')}</div></div>
        <span class="chip ${bk.available > 0 ? 'ok' : 'bad'}">${bk.available}/${bk.copies}</span>
        ${bk.available > 0 && App.can('school_admin', 'teacher') ? `<button class="btn small" data-borrow="${bk.id}" data-title="${E(bk.title)}">Lend</button>` : ''}
      </div>`).join('') || '<p class="muted">No books found.</p>';
    document.querySelectorAll('[data-borrow]').forEach(b => b.onclick = async () => {
      const stu = await API.get('/students?limit=2000');
      UI.modal(`<h2>Lend: ${b.dataset.title}</h2><form id="lnf">
        <label class="f"><span>Student</span><select id="ln-sid">${(stu.data || []).filter(s => s.status === 'active')
          .map(s => `<option value="${s.id}">${E(s.first_name)} ${E(s.last_name)} (${E(s.student_no)})</option>`).join('')}</select></label>
        <label class="f"><span>Due back</span><input type="date" id="ln-due"
          value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}"></label>
        <div class="btn-row"><button class="btn">Lend</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
      document.getElementById('lnf').onsubmit = async (e) => {
        e.preventDefault();
        const res = await API.post('/library/loans', {
          book_id: Number(b.dataset.borrow),
          student_id: Number(document.getElementById('ln-sid').value),
          due_date: document.getElementById('ln-due').value,
        }, { label: 'book loan' });
        UI.close(); UI.toast(res.queued ? 'Saved offline ✓' : 'Lent ✓'); Views.library();
      };
    });
  }
  document.getElementById('lb-search').onclick = search;
  document.getElementById('lb-q').onkeydown = (e) => { if (e.key === 'Enter') search(); };
  document.querySelectorAll('[data-return]').forEach(b => b.onclick = async () => {
    const r = await API.post(`/library/loans/${b.dataset.return}/return`, {}, { label: 'book return' });
    UI.toast(r.queued ? 'Saved offline ✓' : r.fine_cents ? `Returned — fine ${UI.money(r.fine_cents)} (${r.days_late} days late)` : 'Returned ✓');
    Views.library();
  });
  const addBook = document.getElementById('lb-addbook');
  if (addBook) addBook.onclick = () => {
    UI.modal(`<h2>Add book</h2><form id="bkf">
      <label class="f"><span>Title *</span><input type="text" id="bk-title" required></label>
      <div class="row">
        <label class="f grow"><span>Author</span><input type="text" id="bk-author"></label>
        <label class="f grow"><span>Category</span><input type="text" id="bk-cat"></label>
      </div>
      <div class="row">
        <label class="f grow"><span>Copies</span><input type="number" id="bk-copies" value="1" min="1"></label>
        <label class="f grow"><span>Shelf</span><input type="text" id="bk-shelf"></label>
      </div>
      <div class="btn-row"><button class="btn">💾 Save</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('bkf').onsubmit = async (e) => {
      e.preventDefault();
      await API.post('/library/books', {
        title: document.getElementById('bk-title').value.trim(),
        author: document.getElementById('bk-author').value.trim() || null,
        category: document.getElementById('bk-cat').value.trim() || null,
        copies: Number(document.getElementById('bk-copies').value),
        shelf: document.getElementById('bk-shelf').value.trim() || null,
      }, { label: 'book' });
      UI.close(); UI.toast('Book added ✓'); Views.library();
    };
  };
};

Views.assets = async () => {
  const r = await API.get('/library/assets');
  $v().innerHTML = `<div class="card"><h1>🏷 School assets</h1></div>
    <div class="card tablewrap"><table><thead><tr><th>Tag</th><th>Item</th><th class="num">Qty</th><th>Location</th><th>Condition</th></tr></thead>
    <tbody>${(r.data || []).map(a => `<tr><td>${E(a.tag_no || '')}</td><td>${E(a.name)}</td>
      <td class="num">${a.quantity}</td><td>${E(a.location || '')}</td>
      <td><span class="chip ${a.condition === 'good' ? 'ok' : a.condition === 'fair' ? 'warn' : 'bad'}">${E(a.condition)}</span></td></tr>`).join('')}
    </tbody></table></div>`;
};

// ------------------------------------------------------------------ SETTINGS
Views.settings = async () => {
  $v().innerHTML = UI.spin;
  const me = API.me();
  const sch = await API.get('/settings/school').catch(() => ({ data: API.school() || {} }));
  const s = sch.data || {};
  const dark = localStorage.getItem('theme') === 'dark';
  $v().innerHTML = `
    <div class="card"><h1>⚙️ Settings</h1>
      <label class="f"><input type="checkbox" id="set-dark" ${dark ? 'checked' : ''}> 🌙 Dark mode (saves battery)</label>
      <div class="btn-row">
        <button class="btn small secondary" id="set-pass">🔑 Change my ${me.role === 'parent' || me.role === 'student' ? 'PIN' : 'password'}</button>
        <button class="btn small secondary" id="set-logout">🚪 Sign out</button>
      </div></div>
    ${App.can('school_admin') ? `
    <div class="card"><h2>School profile</h2><form id="spf">
      <label class="f"><span>School name</span><input type="text" id="sp-name" value="${E(s.name || '')}"></label>
      <div class="row">
        <label class="f grow"><span>EMIS code</span><input type="text" id="sp-emis" value="${E(s.emis_code || '')}"></label>
        <label class="f grow"><span>County</span><input type="text" id="sp-county" value="${E(s.county || '')}"></label>
      </div>
      <label class="f"><span>Address</span><input type="text" id="sp-addr" value="${E(s.address || '')}"></label>
      <div class="row">
        <label class="f grow"><span>Phone</span><input type="tel" id="sp-phone" value="${E(s.phone || '')}"></label>
        <label class="f grow"><span>Principal</span><input type="text" id="sp-principal" value="${E(s.principal || '')}"></label>
      </div>
      <button class="btn small">💾 Save profile</button></form></div>
    <div class="card"><h2>Academic year</h2>
      <p class="muted">Create the new year, switch the current semester, and run end-of-year promotion.</p>
      <a class="btn small secondary" href="#/yearend">📆 Year & promotion</a>
      <a class="btn small secondary" href="#/timetable">🗓 Timetable editor</a></div>
    <div class="card"><h2>Backup & data</h2>
      <p class="muted">The database is backed up automatically. Take a manual snapshot before big changes and copy it to a USB drive.</p>
      <div class="btn-row"><button class="btn small" id="set-backup">💾 Backup now</button></div>
      <p id="backup-out" class="muted"></p></div>
    <div class="card"><h2>Users & roles</h2><div id="set-users">${UI.spin}</div>
      <button class="btn small" id="set-adduser">➕ Add staff account</button></div>` : ''}
    <div class="card"><h2>About</h2>
      <p class="muted">Ma Weade School Suite v1.0 — offline-first school management for Liberia.<br>
      Signed in as <b>${E(me.name)}</b> (${E(me.role.replace('_', ' '))}).<br>
      <a href="#/sync">📶 Sync status</a> · <a href="/docs/user-manuals/${me.role === 'school_admin' ? 'school-admin' : me.role === 'accountant' ? 'accountant' : ['parent', 'student'].includes(me.role) ? 'parent' : 'teacher'}.md" target="_blank">📖 User manual</a></p></div>`;
  document.getElementById('set-dark').onchange = (e) => {
    localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
    document.documentElement.dataset.theme = e.target.checked ? 'dark' : 'light';
  };
  document.getElementById('set-logout').onclick = () => { API.clearSession(); location.hash = '#/login'; App.route(); };
  document.getElementById('set-pass').onclick = () => {
    const isPin = ['parent', 'student'].includes(me.role);
    UI.modal(`<h2>Change ${isPin ? 'PIN' : 'password'}</h2><form id="cpf">
      <label class="f"><span>Current ${isPin ? 'PIN' : 'password'}</span><input type="password" id="cp-cur"></label>
      <label class="f"><span>New ${isPin ? 'PIN (4-6 digits)' : 'password (8+ characters)'}</span><input type="password" id="cp-new" required></label>
      <div class="btn-row"><button class="btn">Change</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('cpf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.raw('POST', isPin ? '/auth/change-pin' : '/auth/change-password', {
          current: document.getElementById('cp-cur').value, next: document.getElementById('cp-new').value,
        });
        UI.close(); UI.toast('Changed ✓');
      } catch (ex) { UI.toast(ex.message); }
    };
  };
  const spf = document.getElementById('spf');
  if (spf) spf.onsubmit = async (e) => {
    e.preventDefault();
    await API.put('/settings/school', {
      name: document.getElementById('sp-name').value.trim(),
      emis_code: document.getElementById('sp-emis').value.trim(),
      county: document.getElementById('sp-county').value.trim(),
      address: document.getElementById('sp-addr').value.trim(),
      phone: document.getElementById('sp-phone').value.trim(),
      principal: document.getElementById('sp-principal').value.trim(),
    }, { label: 'school profile' });
    UI.toast('Saved ✓');
  };
  const bk = document.getElementById('set-backup');
  if (bk) bk.onclick = async () => {
    try {
      const r = await API.post('/settings/backup', {}, { queueable: false });
      document.getElementById('backup-out').textContent = `✓ ${r.file} — ${r.note}`;
    } catch (e) { UI.toast(e.message); }
  };
  if (App.can('school_admin')) {
    const usersEl = document.getElementById('set-users');
    try {
      const u = await API.get('/users');
      usersEl.innerHTML = (u.data || []).filter(x => ['school_admin', 'teacher', 'accountant'].includes(x.role)).map(x => `
        <div class="list-item" style="cursor:default"><div class="grow"><b>${E(x.full_name)}</b>
        <div class="muted">${E(x.role.replace('_', ' '))} · ${E(x.username || x.phone || '')}</div></div>
        <span class="chip ${x.active ? 'ok' : 'bad'}">${x.active ? 'active' : 'disabled'}</span></div>`).join('');
    } catch (e) { usersEl.innerHTML = `<p class="muted">${E(e.message)}</p>`; }
    document.getElementById('set-adduser').onclick = () => {
      UI.modal(`<h2>Add staff account</h2><form id="auf">
        <label class="f"><span>Full name *</span><input type="text" id="au-name" required></label>
        <label class="f"><span>Role</span><select id="au-role"><option value="teacher">Teacher</option>
          <option value="accountant">Accountant / Bursar</option><option value="school_admin">School Admin</option></select></label>
        <div class="row">
          <label class="f grow"><span>Username *</span><input type="text" id="au-user" required></label>
          <label class="f grow"><span>Password (8+) *</span><input type="text" id="au-pass" required></label>
        </div>
        <label class="f"><span>Phone</span><input type="tel" id="au-phone"></label>
        <div class="btn-row"><button class="btn">Create</button><button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
      document.getElementById('auf').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await API.post('/users', {
            full_name: document.getElementById('au-name').value.trim(),
            role: document.getElementById('au-role').value,
            username: document.getElementById('au-user').value.trim(),
            password: document.getElementById('au-pass').value,
            phone: document.getElementById('au-phone').value.trim() || null,
          }, { queueable: false });
          UI.close(); UI.toast('Account created ✓'); Views.settings();
        } catch (ex) { UI.toast(ex.message); }
      };
    };
  }
};

// ------------------------------------------------------------------ PARENT PORTAL
Views.portal = async () => {
  $v().innerHTML = UI.spin;
  let d;
  try { d = await API.get('/portal/home'); }
  catch (e) { $v().innerHTML = `<div class="card"><p>${E(e.message)}</p></div>`; return; }
  $v().innerHTML = `
    ${UI.cachedNote(d)}
    <div class="card"><h1>🏫 ${E((d.school || {}).name || '')}</h1>
      <p class="muted">${E((d.term || {}).name || '')} ${d.school && d.school.phone ? '· ☎ ' + E(d.school.phone) : ''}</p></div>
    ${(d.children || []).map(c => `
      <div class="card">
        <div class="row">${UI.avatar(c.photo_path, c.name)}
          <div class="grow"><h2>${E(c.name)}</h2><p class="muted">${E(c.class_name || '')} · ${E(c.student_no)}</p></div></div>
        <div class="tiles" style="margin-top:10px">
          <div class="tile"><div class="num">${c.attendance.present}</div><div class="lbl">Days present</div></div>
          <div class="tile"><div class="num" style="color:${c.attendance.absent > 3 ? 'var(--red)' : 'inherit'}">${c.attendance.absent}</div><div class="lbl">Days absent</div></div>
          <div class="tile"><div class="num">${UI.money(c.fees.balance_cents)}</div><div class="lbl">Fees balance</div></div>
          <div class="tile"><div class="num">${c.report_card ? (c.report_card.average ?? '—') + '%' : '—'}</div><div class="lbl">${c.report_card ? `Average (rank ${c.report_card.rank ?? '—'}/${c.report_card.class_size ?? '—'})` : 'No report card yet'}</div></div>
        </div>
        <div class="btn-row">
          <button class="btn small secondary" data-child="${c.id}">📋 Details</button>
          ${c.report_card ? `<a class="btn small" href="#/reportcards?student=${c.id}">📄 Report card</a>` : ''}
        </div>
      </div>`).join('')}
    <div class="card"><h2>📢 School announcements</h2>
      ${(d.announcements || []).map(a => `<div class="list-item" style="cursor:default"><span>📢</span>
        <div class="grow"><b>${E(a.title)}</b><div class="muted">${UI.dmy(a.publish_date)}</div><div>${E(a.body)}</div></div></div>`).join('')
        || '<p class="muted">No announcements.</p>'}</div>
    <div class="card"><h2>📅 Coming up</h2>
      ${(d.events || []).map(ev => `<div class="list-item" style="cursor:default"><span>📅</span>
        <div class="grow"><b>${E(ev.title)}</b><div class="muted">${UI.dmy(ev.start_date)}</div></div></div>`).join('')
        || '<p class="muted">Nothing scheduled.</p>'}</div>`;
  document.querySelectorAll('[data-child]').forEach(b => b.onclick = () => Views.child({ id: b.dataset.child }));
};

Views.child = async ({ id }) => {
  $v().innerHTML = UI.spin;
  const d = await API.get(`/portal/child/${id}`);
  $v().innerHTML = `
    <div class="card"><a href="#/">← Back</a><h1>${E(d.student.name)}</h1>
      <p class="muted">${E(d.student.class_name || '')} · ${E(d.student.student_no)}</p></div>
    <div class="card"><h2>Recent attendance</h2>
      <div class="row" style="gap:4px;flex-wrap:wrap">${(d.attendance || []).slice(0, 30).map(a =>
        `<span class="chip ${a.status === 'present' ? 'ok' : a.status === 'absent' ? 'bad' : 'warn'}" title="${E(a.date)}">${UI.dmy(a.date).slice(0, 6)} ${a.status[0].toUpperCase()}</span>`).join('') || '<p class="muted">Not marked yet.</p>'}</div></div>
    <div class="card"><h2>Payments received</h2>
      ${(d.payments || []).map(p => `<div class="list-item" style="cursor:default"><span>🧾</span>
        <div class="grow"><b>${UI.money(p.amount_cents)}</b><div class="muted">${UI.dmy(p.date)} · ${E(p.method)} · ${E(p.receipt_no)}</div></div></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
    <div class="card"><h2>Report cards</h2>
      ${(d.report_cards || []).map(rc => `<div class="list-item" data-nav="#/reportcards?student=${id}">
        <span>📄</span><div class="grow"><b>${E(rc.year_name)} — ${E(rc.term_name)}</b>
        <div class="muted">Average ${rc.average ?? '—'}% · rank ${rc.rank ?? '—'}/${rc.class_size ?? '—'}</div></div></div>`).join('') || '<p class="muted">None published yet.</p>'}</div>
    ${(d.discipline || []).length ? `<div class="card"><h2>Discipline notes</h2>
      ${d.discipline.map(x => `<div class="list-item" style="cursor:default"><span>⚠️</span>
      <div class="grow"><b>${E(x.category || '')}</b> — ${E(x.description)}<div class="muted">${UI.dmy(x.date)} · ${E(x.action || '')}</div></div></div>`).join('')}</div>` : ''}`;
};

// ------------------------------------------------------------------ YEAR-END / ROLLOVER (admin)
Views.yearend = async () => {
  $v().innerHTML = UI.spin;
  const [yrs, cls] = await Promise.all([API.get('/academics/years'), API.get('/academics/classes')]);
  const years = yrs.data || [];
  const classes = cls.data || [];
  const termsByYear = {};
  for (const y of years.slice(0, 4)) {
    const t = await API.get(`/academics/terms?academic_year_id=${y.id}`).catch(() => ({ data: [] }));
    termsByYear[y.id] = t.data || [];
  }
  $v().innerHTML = `
    <div class="card"><h1>📆 Academic year & promotion</h1>
      <p class="muted">End-of-year order: 1) finish and publish report cards → 2) promote each class →
      3) create the new year → 4) make its first term current.</p></div>
    <div class="card"><h2>Years & terms</h2>
      ${years.map(y => `
        <div style="margin-bottom:10px">
          <b>${E(y.name)}</b> ${y.is_current ? '<span class="chip ok">current year</span>' : ''}
          <div class="muted">${UI.dmy(y.start_date)} → ${UI.dmy(y.end_date)}</div>
          <div class="row" style="margin-top:4px">${(termsByYear[y.id] || []).map(t => `
            <span class="chip ${t.is_current ? 'ok' : 'neutral'}">${E(t.name)}</span>
            ${!t.is_current ? `<button class="btn small secondary" data-curterm="${t.id}">make current</button>` : ''}`).join('')}
          </div>
        </div>`).join('') || '<p class="muted">No years yet.</p>'}
      <button class="btn small" id="ye-newyear">➕ New academic year</button>
    </div>
    <div class="card"><h2>Promote a class</h2>
      <div class="row">
        <label class="f grow"><span>From class</span><select id="ye-from">
          ${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select></label>
        <label class="f grow"><span>Promoted students go to</span><select id="ye-to">
          <option value="">— (graduating class)</option>
          ${classes.map(c => `<option value="${c.id}">${E(c.name)}</option>`).join('')}</select></label>
      </div>
      <button class="btn small secondary" id="ye-load">Load students</button>
      <div id="ye-students" style="margin-top:10px"></div>
    </div>`;

  document.querySelectorAll('[data-curterm]').forEach(b => b.onclick = async () => {
    await API.put(`/academics/terms/${b.dataset.curterm}`, { is_current: 1 }, { queueable: false });
    UI.toast('Current term updated ✓'); Views.yearend();
  });

  document.getElementById('ye-newyear').onclick = () => {
    const y = new Date().getFullYear();
    UI.modal(`<h2>New academic year</h2><form id="nyf">
      <label class="f"><span>Name</span><input type="text" id="ny-name" value="${y}/${y + 1}" required></label>
      <div class="row">
        <label class="f grow"><span>Starts</span><input type="date" id="ny-start" value="${y}-09-01" required></label>
        <label class="f grow"><span>Ends</span><input type="date" id="ny-end" value="${y + 1}-07-10" required></label>
      </div>
      <label class="f"><input type="checkbox" id="ny-current" checked> Make this the current year</label>
      <label class="f"><input type="checkbox" id="ny-terms" checked> Create two semesters automatically</label>
      <div class="btn-row"><button class="btn">Create</button>
      <button type="button" class="btn secondary" data-close>Cancel</button></div></form>`);
    document.getElementById('nyf').onsubmit = async (e) => {
      e.preventDefault();
      const start = document.getElementById('ny-start').value, end = document.getElementById('ny-end').value;
      if (end <= start) return UI.toast('End date must be after start date');
      try {
        const yr = await API.post('/academics/years', {
          name: document.getElementById('ny-name').value.trim(),
          start_date: start, end_date: end,
          is_current: document.getElementById('ny-current').checked ? 1 : 0,
        }, { queueable: false });
        if (document.getElementById('ny-terms').checked) {
          // split the year at the new-year boundary: S1 ends late Jan, S2 starts early Feb
          const janEnd = `${start.slice(0, 4) * 1 + 1}-01-31`;
          const febStart = `${start.slice(0, 4) * 1 + 1}-02-09`;
          await API.post('/academics/terms', {
            academic_year_id: yr.data.id, name: 'First Semester', seq: 1,
            start_date: start, end_date: janEnd,
            is_current: document.getElementById('ny-current').checked ? 1 : 0,
          }, { queueable: false });
          await API.post('/academics/terms', {
            academic_year_id: yr.data.id, name: 'Second Semester', seq: 2,
            start_date: febStart, end_date: end, is_current: 0,
          }, { queueable: false });
        }
        UI.close(); UI.toast('Academic year created ✓'); Views.yearend();
      } catch (ex) { UI.toast(ex.message); }
    };
  };

  document.getElementById('ye-load').onclick = async () => {
    const fromId = Number(document.getElementById('ye-from').value);
    const out = document.getElementById('ye-students');
    out.innerHTML = UI.spin;
    const r = await API.get(`/students?class_id=${fromId}&limit=200`);
    const students = (r.data || []).filter(s => s.status === 'active');
    if (!students.length) { out.innerHTML = '<p class="muted">No active students in this class.</p>'; return; }
    const state = Object.fromEntries(students.map(s => [s.id, 'promoted']));
    out.innerHTML = `
      ${students.map(s => `
        <div class="list-item" style="cursor:default"><div class="grow">${E(s.first_name)} ${E(s.last_name)}</div>
        <select data-decide="${s.id}" style="max-width:150px">
          <option value="promoted">Promote</option>
          <option value="retained">Retain</option>
          <option value="conditional">Conditional</option>
          <option value="graduated">Graduate</option>
        </select></div>`).join('')}
      <div class="btn-row"><button class="btn" id="ye-apply">✔ Apply decisions (${students.length})</button></div>`;
    out.querySelectorAll('[data-decide]').forEach(sel => sel.onchange = () => { state[sel.dataset.decide] = sel.value; });
    document.getElementById('ye-apply').onclick = async () => {
      const toId = Number(document.getElementById('ye-to').value) || null;
      const promotedCount = Object.values(state).filter(d => d === 'promoted' || d === 'conditional').length;
      if (promotedCount && !toId && !confirm('No target class chosen — promoted students will keep their current class. Continue?')) return;
      if (!confirm(`Apply ${students.length} promotion decisions? Promoted/conditional students move to the selected class; graduates leave the roll.`)) return;
      const yearId = (years.find(y => y.is_current) || {}).id || null;
      const res = await API.post('/grades/promotions/bulk', {
        from_class_id: fromId, to_class_id: toId, year_id: yearId,
        decisions: Object.entries(state).map(([student_id, decision]) => ({ student_id: Number(student_id), decision })),
      }, { queueable: false });
      UI.toast(`Recorded ${res.decided} decisions ✓`);
      out.innerHTML = '<p class="muted">Done. Load another class to continue.</p>';
    };
  };
};

// ------------------------------------------------------------------ SYNC STATUS
Views.sync = async () => {
  const ops = await DB.outboxAll();
  $v().innerHTML = `
    <div class="card"><h1>📶 Sync status</h1>
      <p>${navigator.onLine ? '🟢 Connected' : '🔴 Offline'} — ${ops.length} change(s) waiting to upload.</p>
      <div class="btn-row"><button class="btn" id="sy-now">🔄 Sync now</button></div></div>
    <div class="card">${ops.map(o => `<div class="list-item" style="cursor:default"><span>⏳</span>
      <div class="grow"><b>${E(o.label)}</b><div class="muted">${new Date(o.at).toLocaleString()}</div></div></div>`).join('')
      || '<p class="muted">Everything is uploaded. ✓</p>'}</div>
    <div class="card"><h2>How offline mode works</h2>
      <p class="muted">Screens you have opened are saved on this phone and keep working without network.
      Roll call, scores, payments and other changes made offline are stored here and uploaded automatically
      the moment the connection returns — nothing is lost when the power or network goes off.</p></div>`;
  document.getElementById('sy-now').onclick = async () => {
    const r = await API.sync();
    UI.toast(r.done ? `Synced ${r.done} ✓` : navigator.onLine ? 'Nothing to sync' : 'Still offline — will retry automatically');
    Views.sync();
  };
};
