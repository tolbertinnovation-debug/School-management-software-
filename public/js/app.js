/* Router + app shell. Role decides which navigation and start screen you get. */
const App = (() => {
  const ROUTES = {
    '/login': Views.login,
    '/': null,                 // resolved by role below
    '/students': Views.students,
    '/student': Views.student,
    '/attendance': Views.attendance,
    '/attreport': Views.attreport,
    '/gradebook': Views.gradebook,
    '/reportcards': Views.reportcards,
    '/timetable': Views.timetable,
    '/staff': Views.staff,
    '/leaves': Views.leaves,
    '/payroll': Views.payroll,
    '/fees': Views.fees,
    '/expenses': Views.expenses,
    '/comms': Views.comms,
    '/transport': Views.transport,
    '/library': Views.library,
    '/assets': Views.assets,
    '/reports': Views.reports,
    '/audit': Views.audit,
    '/settings': Views.settings,
    '/yearend': Views.yearend,
    '/sync': Views.sync,
    '/child': Views.child,
  };

  // which roles may open which route (client-side courtesy; the API enforces)
  const ACCESS = {
    '/students': ['school_admin', 'teacher', 'accountant', 'county_officer', 'super_admin'],
    '/student': ['school_admin', 'teacher', 'accountant', 'county_officer', 'super_admin'],
    '/attendance': ['school_admin', 'teacher', 'super_admin'],
    '/attreport': ['school_admin', 'teacher', 'county_officer', 'super_admin'],
    '/gradebook': ['school_admin', 'teacher', 'county_officer', 'super_admin'],
    '/staff': ['school_admin', 'teacher', 'accountant', 'county_officer', 'super_admin'],
    '/leaves': ['school_admin', 'teacher', 'super_admin'],
    '/payroll': ['school_admin', 'accountant', 'super_admin'],
    '/fees': ['school_admin', 'accountant', 'super_admin'],
    '/expenses': ['school_admin', 'accountant', 'county_officer', 'super_admin'],
    '/comms': ['school_admin', 'teacher', 'accountant', 'super_admin'],
    '/transport': ['school_admin', 'teacher', 'super_admin'],
    '/library': ['school_admin', 'teacher', 'accountant', 'student', 'super_admin'],
    '/assets': ['school_admin', 'super_admin'],
    '/reports': ['school_admin', 'accountant', 'teacher', 'county_officer', 'super_admin'],
    '/audit': ['school_admin', 'county_officer', 'super_admin'],
    '/yearend': ['school_admin', 'super_admin'],
  };

  const NAV_STAFF = [
    ['#/', '🏠', 'Home'], ['#/students', '🧑🏾‍🎓', 'Students'], ['#/attendance', '✅', 'Roll call'],
    ['#/gradebook', '📝', 'Grades'], ['#/settings', '⚙️', 'More'],
  ];
  const NAV_ACCT = [
    ['#/', '🏠', 'Home'], ['#/fees', '💰', 'Fees'], ['#/expenses', '📉', 'Expenses'],
    ['#/reports', '📊', 'Reports'], ['#/settings', '⚙️', 'More'],
  ];
  const NAV_PARENT = [
    ['#/', '🏠', 'Home'], ['#/reportcards', '📄', 'Reports'], ['#/settings', '⚙️', 'More'],
  ];

  function can(...roles) {
    const me = API.me();
    return me && (me.role === 'super_admin' || roles.includes(me.role));
  }
  function canSee(hash) {
    const path = hash.replace('#', '').split('?')[0];
    const allow = ACCESS[path];
    if (!allow) return true;
    const me = API.me();
    return me && allow.includes(me.role);
  }

  function renderShell() {
    const me = API.me();
    const top = document.getElementById('topbar');
    const nav = document.getElementById('bottomnav');
    if (!me) { top.style.display = 'none'; nav.style.display = 'none'; return; }
    top.style.display = '';
    nav.style.display = '';
    const school = API.school();
    top.querySelector('.title').textContent = school ? school.name : 'School Suite';
    const items = me.role === 'accountant' ? NAV_ACCT
      : ['parent', 'student'].includes(me.role) ? NAV_PARENT : NAV_STAFF;
    const cur = location.hash.split('?')[0] || '#/';
    nav.innerHTML = items.filter(([h]) => canSee(h)).map(([h, i, l]) =>
      `<a href="${h}" class="${cur === h ? 'active' : ''}"><span class="ico">${i}</span>${l}</a>`).join('');
  }

  function parseHash() {
    const h = location.hash.slice(1) || '/';
    const [pathPart, queryPart] = h.split('?');
    const segs = pathPart.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
    if (segs.length >= 2) return { path: '/' + segs[0], args: { id: segs[1], ...params } };
    return { path: '/' + (segs[0] || ''), args: params };
  }

  async function route() {
    const me = API.me();
    let { path, args } = parseHash();
    if (!me) { Views.login(); return; }
    if (path === '/login') { location.hash = '#/'; path = '/'; }
    renderShell();
    let view = ROUTES[path];
    if (path === '/' || !view) {
      view = ['parent', 'student'].includes(me.role) ? Views.portal : Views.dashboard;
    }
    if (!canSee('#' + path)) { view = ['parent', 'student'].includes(me.role) ? Views.portal : Views.dashboard; }
    try { await view(args); }
    catch (e) {
      console.error(e);
      document.getElementById('view').innerHTML =
        `<div class="card"><p>${UI.esc(e.message || 'Something went wrong.')}</p>
         <button class="btn small secondary" data-retry>Try again</button></div>`;
    }
    API.updatePendingBadge();
  }

  // Global click delegation (keeps the strict CSP: no inline handlers anywhere)
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { location.hash = nav.dataset.nav; return; }
    if (e.target.closest('[data-close]')) { UI.close(); return; }
    if (e.target.closest('[data-retry]')) { route(); return; }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => {
    const gear = document.getElementById('topbar-settings');
    if (gear) gear.onclick = () => { location.hash = '#/settings'; };
    // theme
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.dataset.theme = saved;
    else if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
    // service worker
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    route();
    API.sync();
  });

  return { route, can, canSee };
})();
