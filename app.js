// CourseMap: single script for the login page, the student portal and the admin console.
// Sections: 1 shared data/auth, 2 boot, 3 login, 4 student portal, 5 admin console.

// ======================================================================
// 1. Shared data and auth
// ======================================================================
// CourseMap: shared module used by the login page, the student portal and the admin console.
// Everything is front-end only (localStorage), so the demo accounts below are NOT real security.
(function (root) {
  'use strict';

  var KEYS = {
    session: 'coursemap-session-v1',
    state: 'coursemap-state-v1',          // the student's plan (written by student, decision by admin)
    custom: 'coursemap-custom-subjects-v1', // subjects added from the admin Curriculum page
    admin: 'coursemap-admin-v1',           // admin decisions on seeded applications / requests
    accounts: 'coursemap-accounts-v1'      // student accounts created from the sign-up form
  };

  // ---------- Demo accounts ----------
  var DEMO_STUDENT = {
    id: '2025-10482', password: 'student123',
    fullName: 'Lanz Manuel I. Salvacion', initials: 'LS',
    program: 'BS Information Technology', year: '2nd Year', standing: 'Regular', isDemo: true
  };
  // The signed-in student. Starts as the built-in account and is replaced by the real one once a session exists.
  var STUDENT = Object.assign({}, DEMO_STUDENT);
  var PROGRAMS = ['BS Information Technology', 'BS Computer Science', 'BS Information Systems'];
  var YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', '6th Year', '7th Year', '8th Year'];
  var ADMIN = {
    id: 'admin-001', password: 'admin123',
    fullName: 'Alex Rivera', initials: 'AR', title: 'Admissions Officer'
  };

  // ---------- Safe storage ----------
  function area(kind) { try { return root[kind]; } catch (e) { return null; } }
  function read(kind, key) { try { var a = area(kind); return a ? a.getItem(key) : null; } catch (e) { return null; } }
  function write(kind, key, value) {
    try { var a = area(kind); if (!a) return false; a.setItem(key, value); return true; } catch (e) { return false; }
  }
  function remove(kind, key) { try { var a = area(kind); if (a) a.removeItem(key); } catch (e) { /* ignore */ } }
  function readJSON(key, fallback) {
    try { var raw = read('localStorage', key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { return write('localStorage', key, JSON.stringify(value)); }

  // ---------- Student accounts ----------
  function registeredStudents() {
    var list = readJSON(KEYS.accounts, []);
    return (Array.isArray(list) ? list : []).filter(function (a) {
      return a && typeof a.id === 'string' && typeof a.password === 'string' && typeof a.fullName === 'string';
    }).map(function (a) { return Object.assign({}, a, { isDemo: false }); });
  }

  /** Every student account this browser has seen (created from the sign-up form or signed in). */
  function studentAccounts() { return registeredStudents(); }

  function findStudent(id) {
    id = String(id || '').trim().toLowerCase();
    var all = studentAccounts();
    for (var i = 0; i < all.length; i++) if (all[i].id.toLowerCase() === id) return all[i];
    return null;
  }

  /** Each student keeps their own plan. The built-in student keeps the original key. */
  function stateKey(id) { return id === DEMO_STUDENT.id ? KEYS.state : KEYS.state + ':' + id; }

  function initialsFor(name) {
    var p = String(name).trim().split(/\s+/);
    return ((p[0] || '')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  // ---------- Server calls (api/*.php on XAMPP, database system_enrollment) ----------
  function api(name, payload, done) {
    var opts = payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {};
    var parts = String(name).split('?');          // 'admin_subjects?curriculum_id=1' -> api/admin_subjects.php?curriculum_id=1
    var url = 'api/' + parts[0] + '.php' + (parts[1] ? '?' + parts[1] : '');
    fetch(url, opts)
      .then(function (r) {
        return r.text().then(function (text) {
          var res;
          try { res = JSON.parse(text); } catch (e) {
            res = { ok: false, field: '', error: 'The server sent an unexpected reply from ' + url + '. Check that Apache/PHP and MySQL are running and that system_enrollment is imported.' };
          }
          res._status = r.status;
          return res;
        });
      })
      .then(function (res) { done(res); }, function () {
        done({ ok: false, field: '', error: 'Cannot reach the server. Start Apache and MySQL in XAMPP and open http://localhost/Info_man/' });
      });
  }

  /** Sends a FormData (file upload) to api/<name>.php. A lost PHP session (401) signs the person out. */
  function apiUpload(name, formData, done) {
    var url = 'api/' + name + '.php';
    fetch(url, { method: 'POST', body: formData })
      .then(function (r) {
        return r.text().then(function (text) {
          var res;
          try { res = JSON.parse(text); } catch (e) { res = { ok: false, field: '', error: 'The server sent an unexpected reply from ' + url + '.' }; }
          res._status = r.status;
          return res;
        });
      })
      .then(function (res) {
        if (res && res._status === 401) { signOut(); return; }
        done(res);
      }, function () { done({ ok: false, field: '', error: 'Cannot reach the server. Start Apache and MySQL in XAMPP.' }); });
  }

  /** Same as api(), but a lost PHP session (401) signs the person out instead of showing empty pages. */
  function apiAuth(name, payload, done) {
    api(name, payload, function (res) {
      if (res && res._status === 401) { signOut(); return; }
      done(res);
    });
  }

  /** Programs (curriculum rows) for the sign-up list. */
  function loadPrograms(done) { api('programs', null, function (res) { done(res.ok ? res.programs : [], res.ok ? (res.colleges || []) : []); }); }

  /** Keeps a local copy of the profile (never the password) so the rest of the portal can find the student. */
  function cacheAccount(a) {
    var list = readJSON(KEYS.accounts, []);
    if (!Array.isArray(list)) list = [];
    var acct = { id: a.id, password: '', fullName: a.fullName, initials: a.initials,
                 program: a.program, year: a.year, standing: a.regStatus === 'Irregular' ? 'Irregular' : 'Regular', createdAt: new Date().toISOString() };
    var found = false;
    list = list.map(function (x) {
      if (x && x.id === a.id) { found = true; return Object.assign({}, x, acct, { createdAt: x.createdAt || acct.createdAt }); }
      return x;
    });
    if (!found) list.push(acct);
    writeJSON(KEYS.accounts, list);
  }

  /** Reads a curriculum checklist PDF in the browser. done(error, grades) where grades = [ { code, grade } ]. */
  function readChecklist(file, done) {
    if (!window.pdfjsLib) return done('The PDF reader did not load. Check your internet connection and refresh.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var VALID = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00', '5.00', 'INC', 'DO'];
    var grades = [];

    file.arrayBuffer().then(function (buffer) {
      return pdfjsLib.getDocument({ data: buffer }).promise;
    }).then(function (pdf) {
      var jobs = [];
      for (var n = 1; n <= pdf.numPages; n++) jobs.push(pdf.getPage(n).then(function (page) { return page.getTextContent(); }));
      return Promise.all(jobs);
    }).then(function (pages) {
      pages.forEach(function (page) {
        var items = page.items.map(function (i) { return { text: i.str.trim(), x: i.transform[4], y: i.transform[5] }; })
                              .filter(function (i) { return i.text !== ''; });

        // find the left edge of the COURSE CODE column and of the GRADE column
        var codeX = null, gradeX = null;
        items.forEach(function (i) {
          if (i.text === 'COURSE CODE' && codeX === null) codeX = i.x;
          if (i.text === 'GRADE' && gradeX === null) gradeX = i.x;
        });
        if (codeX === null || gradeX === null) return;

        // course codes sit in the first column, grades in the last column
        var codes = items.filter(function (i) { return Math.abs(i.x - codeX) < 40 && /^[A-Z]+(_[A-Z0-9]+|[0-9])(\.\d)?$/.test(i.text); });
        var marks = items.filter(function (i) { return i.x > gradeX - 30; });

        marks.forEach(function (m) {
          var grade = m.text.toUpperCase();
          if (/^\d+(\.\d+)?$/.test(grade)) grade = parseFloat(grade).toFixed(2);
          if (VALID.indexOf(grade) === -1) return;

          // the grade belongs to the course code on the same row (closest y)
          var best = null;
          codes.forEach(function (c) {
            if (best === null || Math.abs(c.y - m.y) < Math.abs(best.y - m.y)) best = c;
          });
          if (best && Math.abs(best.y - m.y) < 10) grades.push({ code: best.text, grade: grade });
        });
      });
      done(grades.length ? '' : 'We could not find any grades in that file. Upload the curriculum checklist PDF.', grades);
    }).catch(function () {
      done('We could not read that file. Upload the curriculum checklist as a PDF.', []);
    });
  }

  /** Sends a sign-up for the admin to check (the account is created on approval). done receives { id, firstName } on success or { error, field } on failure. */
  function registerStudent(v, done) {
    var last = String(v.lastName || '').trim(), first = String(v.firstName || '').trim();
    if (!last) return done({ error: 'Enter your last name.', field: 'last' });
    if (!first) return done({ error: 'Enter your first name.', field: 'first' });
    var sid = String(v.id || '').trim();
    if (!/^[0-9]{4}-[0-9]{5}$/.test(sid)) return done({ error: 'Student ID must look like 2024-00001.', field: 'id' });
    if (!v.curriculumId) return done({ error: 'Choose your college, then your program.', field: 'program' });
    var yearLevel = YEARS.indexOf(v.year) + 1;
    if (!yearLevel) return done({ error: 'Choose your year level.', field: 'year' });
    var regStatus = String(v.regStatus || '');
    if (regStatus !== 'Regular' && regStatus !== 'Irregular') return done({ error: 'Choose Regular or Irregular.', field: 'status' });
    if (regStatus === 'Regular' && yearLevel > 4) return done({ error: 'Regular students are up to 4th year. Choose Irregular for 5th year and up.', field: 'year' });
    if (yearLevel !== 1 && (!v.file || !v.grades || !v.grades.length)) return done({ error: 'Upload your curriculum checklist (PDF).', field: 'file' });
    var pw = String(v.password || '');
    if (pw.length < 8) return done({ error: 'Your password needs at least 8 characters.', field: 'password' });
    if (pw !== String(v.confirm || '')) return done({ error: 'The two passwords don’t match.', field: 'confirm' });

    // the PDF goes with the form: the admin checks it before the account is created
    var fd = new FormData();
    fd.append('lastName', last); fd.append('firstName', first); fd.append('middleName', v.middleName || '');
    fd.append('id', sid); fd.append('curriculumId', v.curriculumId); fd.append('yearLevel', yearLevel);
    fd.append('regStatus', regStatus); fd.append('grades', JSON.stringify(v.grades || []));
    fd.append('password', pw); fd.append('confirm', v.confirm || '');
    if (yearLevel !== 1 && v.file) fd.append('file', v.file);
    apiUpload('register', fd, function (res) {
      if (!res.ok) return done({ error: res.error, field: res.field || '' });
      // no account yet: it is created when an admin approves the PDF, so there is nothing to cache here
      done({ id: res.account.id, firstName: res.account.firstName, program: res.account.program, year: res.account.year, regStatus: res.account.regStatus });
    });
  }

  // ---------- Session / auth ----------
  function home() { return 'index.html'; }

  function getSession() {
    var raw = read('localStorage', KEYS.session) || read('sessionStorage', KEYS.session);
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      return s && (s.role === 'student' || s.role === 'admin') ? s : null;
    } catch (e) { return null; }
  }

  /** Checks the ID and password in MySQL. done receives an error message, or null when signed in. */
  function signIn(role, id, password, remember, done) {
    id = String(id || '').trim();
    if (!id || !password) return done('Enter your ' + (role === 'admin' ? 'Admissions ID' : 'Student ID') + ' and password.');
    api('login', { role: role, id: id, password: password }, function (res) {
      if (!res.ok) return done(res.error || 'That ID and password don’t match. Please try again.');
      var u = res.user;
      if (role === 'student') cacheAccount(u);
      var payload = JSON.stringify({ role: role, id: u.id, at: Date.now(), admin: role === 'admin' ? u : undefined });
      remove('localStorage', KEYS.session);
      remove('sessionStorage', KEYS.session);
      if (!write(remember ? 'localStorage' : 'sessionStorage', KEYS.session, payload)) {
        return done('Your browser is blocking storage, so we can’t keep you signed in.');
      }
      done(null);
    });
  }

  /** Reloads the single page: with no session it shows the login screen. */
  function restart() { try { root.location.hash = ''; } catch (e) { /* ignore */ } root.location.reload(); }

  function signOut() {
    remove('localStorage', KEYS.session);
    remove('sessionStorage', KEYS.session);
    // end the php session as well (api/logout.php), then show the login screen
    api('logout', {}, function () { restart(); });
  }

  /** True when the signed-in role matches. (index.html only shows the matching screen, so no redirect is needed.) */
  function requireRole(role) {
    var s = getSession();
    return !!(s && s.role === role);
  }

  // ---------- Icons (one sprite for every page) ----------
  var SPRITE =
    '<svg class="sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
    '<symbol id="i-cap" viewBox="0 0 24 24"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></symbol>' +
    '<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></symbol>' +
    '<symbol id="i-book" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></symbol>' +
    '<symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></symbol>' +
    '<symbol id="i-grid" viewBox="0 0 24 24"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></symbol>' +
    '<symbol id="i-calendar" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></symbol>' +
    '<symbol id="i-file" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></symbol>' +
    '<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></symbol>' +
    '<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>' +
    '<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>' +
    '<symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>' +
    '<symbol id="i-down" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>' +
    '<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></symbol>' +
    '<symbol id="i-spark" viewBox="0 0 24 24"><path d="M9.94 14.7 12 21l2.06-6.3L20 12.5l-5.94-2.2L12 4l-2.06 6.3L4 12.5z"/></symbol>' +
    '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></symbol>' +
    '<symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></symbol>' +
    '<symbol id="i-logout" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></symbol>' +
    '<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></symbol>' +
    '<symbol id="i-eyeoff" viewBox="0 0 24 24"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c4.5 0 8.4 2.7 10 7a11.8 11.8 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12c1.6 4.3 5.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/></symbol>' +
    '<symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></symbol>' +
    '<symbol id="i-edit" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></symbol>' +
    '<symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></symbol>' +
    '<symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></symbol>' +
    '</svg>';

  root.CM = {
    KEYS: KEYS, STUDENT: STUDENT, ADMIN: ADMIN, SPRITE: SPRITE, PROGRAMS: PROGRAMS, YEARS: YEARS,
    api: api, apiAuth: apiAuth, apiUpload: apiUpload,
    studentAccounts: studentAccounts, registerStudent: registerStudent, readChecklist: readChecklist, loadPrograms: loadPrograms, stateKey: stateKey,
    readJSON: readJSON, writeJSON: writeJSON,
    getSession: getSession, restart: restart, signIn: signIn, signOut: signOut, requireRole: requireRole, home: home
  };

  // A student who is signed in becomes the current student (name, program and plan all follow the account).
  var current = getSession();
  if (current && current.role === 'student') {
    var acct = findStudent(current.id);
    if (acct) Object.assign(STUDENT, acct);
  }
  // A signed-in admin takes the name and title that came from the admin_user table.
  if (current && current.role === 'admin' && current.admin) Object.assign(ADMIN, current.admin);
})(typeof window !== 'undefined' ? window : this);

// ======================================================================
// 2. Boot
// ======================================================================
// ---------- Boot: one page, three screens. Keep only the screen for the current session. ----------
(function () {
  'use strict';
  var s = window.CM.getSession();
  var role = s ? s.role : 'login';
  ['login', 'student', 'admin'].forEach(function (r) {
    var el = document.getElementById(r + '-root');
    if (r !== role && el) el.parentNode.removeChild(el);
  });
  document.body.className = role === 'login' ? 'auth-page' : role === 'admin' ? 'admin' : '';
  if (role === 'login') document.title = 'Sign in · CourseMap';
})();

// ======================================================================
// 3. Login
// ======================================================================
// CourseMap login page: Student / Admin tabs, validation and redirect.
(function () {
  'use strict';

  // Already signed in? Go straight to the right portal.
  if (CM.getSession()) return;   // boot code already removed the login screen

  var ROLES = {
    student: { label: 'Student ID', placeholder: 'Enter your student ID', button: 'Sign in to student portal' },
    admin:   { label: 'Admissions ID', placeholder: 'Enter your admissions ID', button: 'Sign in to admin portal' }
  };

  var role = 'student';
  var form = document.getElementById('login-form');
  var idInput = document.getElementById('login-id');
  var pwInput = document.getElementById('login-pw');
  var msg = document.getElementById('form-msg');
  var tabs = document.querySelectorAll('.role-tab');

  // sprite + footer year
  var holder = document.querySelector('[data-mount="sprite"]');
  holder.insertAdjacentHTML('afterend', CM.SPRITE);
  holder.parentNode.removeChild(holder);
  document.getElementById('year').textContent = new Date().getFullYear();

  function showMessage(text) {
    msg.textContent = text || '';
    msg.hidden = !text;
    form.querySelectorAll('.auth-field').forEach(function (f) { f.classList.toggle('has-error', !!text); });
  }

  function setRole(next) {
    role = next;
    var cfg = ROLES[role];
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-role') === role;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.getElementById('id-label').textContent = cfg.label;
    idInput.placeholder = cfg.placeholder;
    document.getElementById('submit-label').textContent = cfg.button;
    idInput.value = '';
    pwInput.value = '';
    showMessage('');
    idInput.focus();
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { setRole(t.getAttribute('data-role')); });
  });

  // show / hide password
  var toggle = document.getElementById('pw-toggle');
  toggle.addEventListener('click', function () {
    var show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.querySelector('use').setAttribute('href', show ? '#i-eyeoff' : '#i-eye');
  });

  document.getElementById('forgot').addEventListener('click', function (e) {
    e.preventDefault();
    msg.textContent = 'To reset your password, contact the Registrar’s Office or support@coursemap.example.';
    msg.hidden = false;
    msg.classList.add('ok');
  });

  form.addEventListener('input', function () { msg.classList.remove('ok'); if (!msg.hidden) showMessage(''); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.classList.remove('ok');
    var submitBtn = document.getElementById('submit');
    submitBtn.disabled = true;
    CM.signIn(role, idInput.value, pwInput.value, document.getElementById('remember').checked, function (error) {
      if (error) { submitBtn.disabled = false; showMessage(error); (idInput.value ? pwInput : idInput).focus(); return; }
      showMessage('');
      CM.restart();
    });
  });

  // ---------- Create a student account ----------
  var wrap = document.getElementById('auth-wrap');
  var views = { signin: document.getElementById('signin-view'), signup: document.getElementById('signup-view'),
                done: document.getElementById('signup-done') };
  var suForm = document.getElementById('signup-form');
  var suMsg = document.getElementById('su-msg');
  var suPw = document.getElementById('su-pw');

  function showView(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    wrap.classList.toggle('is-wide', name !== 'signin');
    document.title = (name === 'signin' ? 'Sign in' : name === 'signup' ? 'Create account' : 'Registration submitted') + ' · CourseMap';
    window.scrollTo(0, 0);
  }

  // College -> Program dropdowns. Both lists come from the database, so they only show what exists in the system.
  var programList = [];
  var suCollege = document.getElementById('su-college'), suProgram = document.getElementById('su-program');
  function addOption(select, value, text) {
    var o = document.createElement('option'); o.value = value; o.textContent = text; select.appendChild(o);
  }
  /** The Program list follows the chosen college and stays locked until one is picked. */
  function fillPrograms() {
    var cid = suCollege.value;
    suProgram.innerHTML = '';
    if (!cid) { addOption(suProgram, '', 'Choose college first'); suProgram.disabled = true; return; }
    addOption(suProgram, '', 'Select program');
    programList.forEach(function (p) { if (String(p.college_id) === cid) addOption(suProgram, String(p.curriculum_id), p.curriculum_name); });
    suProgram.disabled = false;
  }
  CM.loadPrograms(function (list, colleges) {
    programList = list;
    colleges.forEach(function (c) {          // a college with no program yet would be a dead end for a new student
      if (list.some(function (p) { return String(p.college_id) === String(c.college_id); })) addOption(suCollege, String(c.college_id), c.college_name);
    });
    fillPrograms();
  });
  suCollege.addEventListener('change', fillPrograms);
  var suYear = document.getElementById('su-year');
  var suFileField = document.getElementById('su-file-field');
  var suFirstYearNote = document.getElementById('su-first-year-note');
  CM.YEARS.forEach(function (y) { suYear.insertAdjacentHTML('beforeend', '<option>' + y + '</option>'); });
  function updateChecklistRequirement() {
    var firstYear = suYear.value === '1st Year';
    suFileField.hidden = firstYear;
    suFirstYearNote.hidden = !firstYear;
    document.getElementById('su-file').required = !firstYear;
    if (firstYear) document.getElementById('su-file').value = '';
  }
  suYear.addEventListener('change', updateChecklistRequirement);
  updateChecklistRequirement();

  function suError(text, field) {
    suMsg.textContent = text || '';
    suMsg.hidden = !text;
    suForm.querySelectorAll('.auth-field').forEach(function (f) {
      f.classList.toggle('has-error', !!text && f.getAttribute('data-field') === field);
    });
  }

  // password strength hint (length plus a mix of letters, digits and symbols)
  function strength(pw) {
    if (!pw) return 0;
    var n = 0;
    if (pw.length >= 8) n++;
    if (pw.length >= 12) n++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) n++;
    return pw.length < 8 ? 1 : Math.max(2, n);
  }
  suPw.addEventListener('input', function () {
    var n = strength(suPw.value);
    var meter = document.getElementById('pw-meter');
    meter.setAttribute('data-level', String(n));
    document.getElementById('pw-meter-text').textContent = ['', 'Too short', 'Okay', 'Good', 'Strong'][n];
  });

  document.getElementById('su-toggle').addEventListener('click', function () {
    var show = suPw.type === 'password';
    suPw.type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show));
    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    this.querySelector('use').setAttribute('href', show ? '#i-eyeoff' : '#i-eye');
  });

  suForm.addEventListener('input', function () { if (!suMsg.hidden) suError(''); });

  suForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = document.getElementById('su-submit');
    var file = document.getElementById('su-file').files[0];
    var isFirstYear = suYear.value === '1st Year';
    if (!isFirstYear && !file) { suError('Upload your curriculum checklist (PDF).', 'file'); return; }
    btn.disabled = true;

    function submitRegistration(grades) {

      CM.registerStudent({
        lastName: document.getElementById('su-last').value, firstName: document.getElementById('su-first').value,
        middleName: document.getElementById('su-middle').value, id: document.getElementById('su-id').value,
        curriculumId: suProgram.value, year: document.getElementById('su-year').value,
        regStatus: document.getElementById('su-status').value, grades: grades, file: file,
        password: suPw.value, confirm: document.getElementById('su-confirm').value
      }, function (res) {
        btn.disabled = false;
        if (res.error) {
          if (res.field === 'program' && !suCollege.value) res.field = 'college';   // the Program list is locked until a college is picked
          suError(res.error, res.field);
          var target = { college: 'su-college', last: 'su-last', first: 'su-first', middle: 'su-middle', id: 'su-id', program: 'su-program', year: 'su-year', status: 'su-status', file: 'su-file', password: 'su-pw', confirm: 'su-confirm' }[res.field];
          if (target) document.getElementById(target).focus();
          return;
        }
        document.getElementById('done-name').textContent = res.firstName;
        document.getElementById('done-id').textContent = res.id;
        document.getElementById('done-meta').textContent = res.program + ' · ' + res.year + ' · ' + res.regStatus;
        suForm.reset();
        fillPrograms();
        suPw.dispatchEvent(new Event('input'));
        showView('done');
        document.getElementById('done-continue').setAttribute('data-id', res.id);
        document.getElementById('done-continue').focus();
      });
    }
    if (isFirstYear) submitRegistration([]);
    else CM.readChecklist(file, function (problem, grades) {
      if (problem) { btn.disabled = false; suError(problem, 'file'); return; }
      submitRegistration(grades);
    });
  });

  document.getElementById('create-account').addEventListener('click', function (e) {
    e.preventDefault(); suError(''); showView('signup'); document.getElementById('su-last').focus();
  });
  document.getElementById('back-signin').addEventListener('click', function (e) {
    e.preventDefault(); showView('signin'); setRole('student');
  });
  document.getElementById('done-continue').addEventListener('click', function () {
    var id = this.getAttribute('data-id') || '';
    showView('signin'); setRole('student');
    idInput.value = id;
    pwInput.focus();
  });

  // the "Create an account" line only belongs to the student tab
  var baseSetRole = setRole;
  setRole = function (next) { baseSetRole(next); document.getElementById('create-line').hidden = next === 'admin'; };

  // /index.html#admin opens on the Admin tab, #signup opens the create-account form
  setRole(window.location.hash === '#admin' ? 'admin' : 'student');
  if (window.location.hash === '#signup') showView('signup');
  else idInput.blur();
})();

// ======================================================================
// 4. Student portal
// ======================================================================
// CourseMap Student Portal: plain JavaScript version.
// Replaces the Spring Boot backend (PortalService, controllers) and the Thymeleaf
// templates. Data and planning rules live here; pages are rendered in the browser.
(function () {
  'use strict';

  // ==== LOGIC START ====

  // ---------- Constants ----------
  var DEFAULT_MAX_UNITS = 18;   // 24 once an Overload form is approved (the server sends enrollment.max_units)

  // Shared module (shared.js): demo accounts, curriculum (with the sections and rooms the admin
  // manages) and the session. In a plain Node test there is no window, so fall back to empty data.
  var CM = (typeof window !== 'undefined' && window.CM) ? window.CM : null;
  var STUDENT = CM ? CM.STUDENT : { fullName: '', initials: '', program: '' };

  // Signed-out visitors, and admins, are sent to the right page before anything renders.
  if (CM && !CM.requireRole('student')) return;

  // The topbar starts with an empty list; notifications() fills it from the term and the adviser's decision.
  var NOTIFICATIONS = [];

  // ---------- Server data (api/*.php, database system_enrollment) ----------
  // Everything below comes from MySQL: the study plan with grades (study_plan.php), the open sections
  // (sections.php) and the student's own plan (enrollment.php). Nothing here is sample data.
  var SERVER = { loaded: false, error: null, terms: [], sections: [], enrollment: null, gwa: null, term: null, yearLevel: 0, baseMaxUnits: 0, canOverload: false };
  var TONE_LIST = ['green', 'purple', 'orange', 'blue', 'yellow', 'red'];
  var DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  var YEAR_NAMES = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year', 6: '6th Year', 7: '7th Year', 8: '8th Year' };

  var subjectsCache = [];     // subjects of the study plan with their open sections
  function baseUnits() { return SERVER.baseMaxUnits || DEFAULT_MAX_UNITS; }   // the term total of the regular study plan (18 from 5th year up)
  function maxUnits() { return (SERVER.enrollment && SERVER.enrollment.max_units) || baseUnits(); }
  var state = { forms: [], plan: [], items: [], status: 'Draft', submitted: false, decision: null, sentBack: false, remarks: '', submittedAt: null, coreqs: [] };

  function clock(t) {         // '13:30' -> '1:30 PM'
    var p = String(t).split(':'), h = parseInt(p[0], 10), ap = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + (p[1] || '00') + ' ' + ap;
  }
  function minutes(t) { var p = String(t).split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10); }
  function badgeOf(code) { var m = /^[A-Za-z]+/.exec(code); return m ? m[0].toUpperCase() : String(code).slice(0, 3).toUpperCase(); }
  function toneOf(code) {
    var b = badgeOf(code), h = 0;
    for (var i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) % 997;
    return TONE_LIST[h % TONE_LIST.length];
  }
  function semLabel(sem) { return sem === '1st' ? 'First Semester' : sem === '2nd' ? 'Second Semester' : sem === 'Summer' ? 'Summer' : String(sem || ''); }
  function dashYears(ay) { return String(ay || '').replace('-', '–'); }

  /** One schedule row (one section on one day) becomes one choice in the Schedule menu. */
  function optionFromRow(r, left) {
    return {
      id: String(r.schedule_id), scheduleId: parseInt(r.schedule_id, 10),
      label: r.day_of_week + ' · ' + clock(r.start_time) + '–' + clock(r.end_time),
      days: [r.day_of_week], day: r.day_of_week, slot: clock(r.start_time),
      start: minutes(r.start_time), end: minutes(r.end_time),
      section: r.block_section, room: r.room_or_mode, spotsLeft: left
    };
  }

  function buildSubjects() {
    var bySubject = {};
    SERVER.sections.forEach(function (r) {
      (bySubject[r.subject_id] = bySubject[r.subject_id] || []).push(optionFromRow(r, parseInt(r.available_slots, 10)));
    });
    var list = [];
    SERVER.terms.forEach(function (t) {
      t.subjects.forEach(function (s) {
        var all = s.prereqs || [], missing = s.missingPrereqs || [];
        var status, label;
        if (s.passed) { status = 'PASSED'; label = 'Passed' + (s.grade ? ' · ' + s.grade : ''); }
        else if (s.offeredNow === false) { status = 'SEMESTER'; label = 'Opens in ' + semLabel(t.semester); }
        else if (missing.length) { status = 'NOT_TAKEN'; label = missing.join(', '); }
        else if (!s.eligible && s.minYearStanding) { status = 'STANDING'; label = (YEAR_NAMES[s.minYearStanding] || 'Higher year') + ' standing'; }
        else if (all.length) { status = 'COMPLETED'; label = all.join(', '); }
        else { status = 'NONE'; label = null; }
        list.push({
          subjectId: s.subjectId, code: s.code, title: s.title, units: s.units, isAcademic: s.isAcademic !== false,
          description: (YEAR_NAMES[t.year] || ('Year ' + t.year)) + ' · ' + semLabel(t.semester) + (s.isAcademic === false ? ' · NSTP' : ''),
          prereqLabel: label, prereqStatus: status, passed: !!s.passed, grade: s.grade, remark: s.remark,
          eligible: !!s.eligible, tone: toneOf(s.code), badge: badgeOf(s.code),
          options: bySubject[s.subjectId] || [], year: t.year, semester: t.semester
        });
      });
    });
    subjectsCache = list;
  }

  /** The student's saved plan from the database, as the pages use it. */
  function syncState() {
    var e = SERVER.enrollment, items = [], plan = [];
    if (e) {
      e.subjects.forEach(function (x) {
        var subject = findSubject(x.course_code) || {
          subjectId: parseInt(x.subject_id, 10), code: x.course_code, title: x.course_title, units: parseInt(x.units, 10),
          isAcademic: String(x.is_academic) !== '0', description: '', prereqStatus: 'NONE', eligible: true,
          tone: toneOf(x.course_code), badge: badgeOf(x.course_code), options: []
        };
        var left = 99;
        SERVER.sections.forEach(function (r) { if (String(r.schedule_id) === String(x.schedule_id)) left = parseInt(r.available_slots, 10); });
        items.push({ subject: subject, option: optionFromRow(x, left) });
        plan.push({ code: x.course_code, optionId: String(x.schedule_id) });
      });
    }
    var last = e && e.history && e.history.length ? e.history[e.history.length - 1] : null;
    var status = e ? e.status : 'Draft';
    state = {
      plan: plan, items: items, status: status, submitted: status !== 'Draft',
      decision: status === 'Enrolled' ? 'approved' : status === 'Rejected' ? 'rejected' : null,
      sentBack: status === 'Draft' && !!last && last.old_status === 'For Review' && last.new_status === 'Draft',
      remarks: last && last.remarks ? last.remarks : '',
      submittedAt: e ? e.submitted_at : null,
      coreqs: e && e.missing_corequisites ? e.missing_corequisites : [],
      forms: e && e.forms ? e.forms : []
    };
  }

  /** GWA of the grades already saved for the current term (academic subjects, passed only). */
  function currentTermGwa() {
    var num = 0, den = 0, cg = SERVER.currentGrades || {};
    state.items.forEach(function (it) {
      var g = cg[it.subject.subjectId];
      if (g && g.remark === 'PASSED' && it.subject.isAcademic !== false && !isNaN(parseFloat(g.grade))) { num += parseFloat(g.grade) * it.subject.units; den += it.subject.units; }
    });
    return den ? (num / den).toFixed(2) : '—';
  }

  function buildTerms() {
    var term = SERVER.term || { academicYear: '', semester: '' };
    var current = state.status === 'Enrolled' ? 'Enrolled' : state.status === 'For Review' ? 'For review' : state.status === 'Rejected' ? 'Rejected' : 'Planning';
    var out = [{
      id: 'current', current: true, yearField: 'SCHOOL YEAR', schoolYear: dashYears(term.academicYear), program: STUDENT.program,
      semester: semLabel(term.semester), gwa: currentTermGwa(), status: current, expanded: true, rows: []
    }];
    var graded = SERVER.terms.filter(function (t) {
      return t.subjects.some(function (s) { return s.remark; });
    }).reverse();
    graded.forEach(function (t, i) {
      var num = 0, den = 0;
      var rows = t.subjects.filter(function (s) { return s.remark; }).map(function (s) {
        if (s.remark === 'PASSED' && s.isAcademic !== false && s.grade && !isNaN(parseFloat(s.grade))) { num += parseFloat(s.grade) * s.units; den += s.units; }
        return { code: s.code, description: s.title, units: s.units, grade: s.grade || '—', status: s.remark };
      });
      out.push({
        id: 'y' + t.year + '-' + t.semester, yearField: t.academicYear ? 'YEAR LEVEL · SCHOOL YEAR' : 'YEAR LEVEL',
        schoolYear: (YEAR_NAMES[t.year] || ('Year ' + t.year)) + (t.academicYear ? ' · ' + dashYears(t.academicYear) : ''), program: STUDENT.program,
        semester: semLabel(t.semester), gwa: den ? (num / den).toFixed(2) : '—', status: 'Completed', expanded: false, rows: rows
      });
    });
    return out;
  }
  var TERMS = [];

  // ---------- Model helpers ----------
  function isEligible(subject) { return !!subject.eligible && !subject.passed; }
  function isOffered(subject) { return subject.options.length > 0; }
  function isAvailable(subject) { return isEligible(subject) && isOffered(subject); }

  function prereqStatusText(subject) {
    switch (subject.prereqStatus) {
      case 'COMPLETED': return 'Completed';
      case 'NOT_TAKEN': return 'Not yet passed';
      case 'STANDING': return 'Year standing';
      case 'SEMESTER': return 'Not this semester';
      case 'PASSED': return 'Passed';
      default: return 'Open';
    }
  }

  function prereqText(subject) {
    switch (subject.prereqStatus) {
      case 'COMPLETED': case 'PASSED': return '✓ ' + subject.prereqLabel;
      case 'NOT_TAKEN': case 'STANDING': case 'SEMESTER': return '✕ ' + subject.prereqLabel;
      default: return '✓ None required';
    }
  }

  function isFull(option) { return option.spotsLeft <= 0; }

  function spotsTone(option) {
    if (isFull(option)) return 'full';
    return option.spotsLeft <= 5 ? 'low' : 'ok';
  }

  function spotsText(option) {
    return isFull(option) ? 'Full' : option.spotsLeft >= 99 ? 'Open' : option.spotsLeft + ' spots left';
  }

  function findSubject(code) {
    for (var i = 0; i < subjectsCache.length; i++) if (subjectsCache[i].code === code) return subjectsCache[i];
    return null;
  }

  /** Every subject of the student's curriculum (the study plan in MySQL). */
  function allSubjects() { return subjectsCache; }

  function findOption(subject, optionId) {
    for (var i = 0; i < subject.options.length; i++) {
      if (subject.options[i].id === optionId) return subject.options[i];
    }
    return null;
  }

  // ---------- Loading ----------
  /** Loads everything the pages need. done() runs when all requests have answered. */
  function loadAll(done) {
    var pending = 4, failed = null;
    function finish(res) {
      if (!res.ok && !failed) failed = res.error || 'Could not load your data.';
      if (--pending > 0) return;
      buildSubjects();
      syncState();
      TERMS = buildTerms();
      SERVER.loaded = true;
      SERVER.error = failed;
      done();
    }
    CM.apiAuth('study_plan', null, function (res) { if (res.ok) { SERVER.terms = res.terms; SERVER.gwa = res.gwa; SERVER.yearLevel = res.yearLevel || 0; SERVER.baseMaxUnits = res.baseMaxUnits || 0; SERVER.canOverload = !!res.canOverload; SERVER.regStatus = res.regStatus || 'Regular'; SERVER.currentGrades = res.currentGrades || {}; } finish(res); });
    CM.apiAuth('sections', null, function (res) { if (res.ok) SERVER.sections = res.sections; finish(res); });
    CM.apiAuth('enrollment', null, function (res) { if (res.ok) SERVER.enrollment = res.enrollment; finish(res); });
    CM.apiAuth('me', null, function (res) {
      if (res.ok) {
        SERVER.term = res.term;
        Object.assign(STUDENT, res.user, { isDemo: false });
      }
      finish(res);
    });
  }

  /** Reads the open sections again (slot counts change when plans are submitted) and the saved plan. */
  function reloadPlan(done) {
    CM.apiAuth('sections', null, function (res) {
      if (res.ok) SERVER.sections = res.sections;
      buildSubjects();
      syncState();
      TERMS = buildTerms();
      done();
    });
  }

  // ---------- Reads ----------
  function curriculum(query) {
    if (!query || !query.trim()) return allSubjects();
    var q = query.toLowerCase().trim();
    return allSubjects().filter(function (s) {
      return s.code.toLowerCase().indexOf(q) !== -1 || s.title.toLowerCase().indexOf(q) !== -1;
    });
  }

  function eligibleCount() { return allSubjects().filter(isAvailable).length; }

  function plannedItems() { return state.items; }

  /** Academic units only: NSTP is not counted against the 18 unit limit. */
  function plannedUnits() {
    return state.items.reduce(function (sum, i) { return sum + (i.subject.isAcademic ? i.subject.units : 0); }, 0);
  }

  function overlaps(a, b) {
    return a.day === b.day && a.start < b.end && b.start < a.end;
  }

  function getConflicts() {
    var items = plannedItems(), conflicts = [];
    for (var i = 0; i < items.length; i++) {
      for (var j = i + 1; j < items.length; j++) {
        if (overlaps(items[i].option, items[j].option)) {
          conflicts.push({
            subjectA: items[i].subject.code,
            titleA: items[i].subject.title,
            whenA: items[i].option.label,
            sectionA: items[i].option.section,
            subjectB: items[j].subject.code,
            titleB: items[j].subject.title,
            whenB: items[j].option.label,
            sectionB: items[j].option.section,
            day: DAY_FULL[items[i].option.day] || items[i].option.day
          });
        }
      }
    }
    return conflicts;
  }

  function hasConflict() {
    return getConflicts().length > 0;
  }

  function coreqProblem() {
    var c = state.coreqs[0];
    return c ? c.course_code + ' must be taken together with ' + c.missing_corequisite + '.' : null;
  }

  /** Weekly grid: one row per start time, one cell per day (null when empty). */
  function ttDays() {
    var days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    if (state.items.some(function (i) { return i.option.day === 'Sat'; })) days.push('Sat');
    return days;
  }

  function timetable() {
    var items = plannedItems(), days = ttDays();
    var starts = [];
    items.forEach(function (i) { if (starts.indexOf(i.option.start) === -1) starts.push(i.option.start); });
    if (starts.length === 0) starts = [480, 600, 690, 780, 870, 960];
    starts.sort(function (a, b) { return a - b; });
    return starts.map(function (start) {
      var cells = {};
      days.forEach(function (day) {
        var block = null;
        items.forEach(function (item) {
          if (item.option.start === start && item.option.day === day) {
            block = {
              code: item.subject.code, title: item.subject.title,
              room: item.option.section + ' · ' + item.option.room, tone: item.subject.tone
            };
          }
        });
        cells[day] = block;
      });
      return { time: clock(Math.floor(start / 60) + ':' + ('0' + (start % 60)).slice(-2)), cells: cells };
    });
  }

  function planIndex(code) {
    for (var i = 0; i < state.plan.length; i++) {
      if (state.plan[i].code === code) return i;
    }
    return -1;
  }

  // ---------- Writes ----------
  // Each one asks the server (enrollment.php), which checks the rules in MySQL. done(message) gets an error
  // message, or null on success, once the saved plan has been read back.
  function lockedMessage() {
    if (state.status === 'Enrolled') return 'You are already enrolled for this term, so the plan can’t be changed.';
    if (state.status === 'Rejected') return 'This request was rejected. Contact your adviser.';
    return 'Your plan is waiting for adviser review and can’t be edited.';
  }

  function callEnrollment(payload, done) {
    CM.apiAuth('enrollment', payload, function (res) {
      if (!res.ok) { done(res.error || 'Something went wrong. Please try again.'); return; }
      SERVER.enrollment = res.enrollment;
      reloadPlan(function () { done(null); });
    });
  }

  function addSubject(code, done) {
    var subject = findSubject(code);
    if (!subject) return done('Subject not found.');
    if (state.submitted) return done(lockedMessage());
    if (subject.passed) return done('You already passed ' + code + '.');
    if (!isEligible(subject)) return done('Prerequisite not met for ' + code + '.');
    if (planIndex(code) !== -1) return done(null);
    if (subject.isAcademic && plannedUnits() + subject.units > maxUnits()) {
      return done('Adding ' + code + ' would exceed ' + maxUnits() + ' units.');
    }
    if (subject.options.length === 0) return done(code + ' has no sections yet. Check back once the registrar releases them.');
    var pick = null;      // the first section that still has seats
    for (var i = 0; i < subject.options.length; i++) {
      if (!isFull(subject.options[i])) { pick = subject.options[i]; break; }
    }
    if (!pick) return done(code + ' has no open sections.');
    callEnrollment({ action: 'add', scheduleId: pick.scheduleId }, done);
  }

  function removeSubject(code, done) {
    if (state.submitted) return done(lockedMessage());
    var item = null;
    state.items.forEach(function (i) { if (i.subject.code === code) item = i; });
    if (!item) return done(null);
    callEnrollment({ action: 'remove', subjectId: item.subject.subjectId }, done);
  }

  function chooseOption(code, optionId, done) {
    var subject = findSubject(code);
    if (state.submitted) return done(lockedMessage());
    if (!subject || planIndex(code) === -1) return done('Subject is not in your plan.');
    var option = findOption(subject, optionId);
    if (!option) return done('Schedule option not found.');
    if (isFull(option)) return done('That section is full.');
    callEnrollment({ action: 'add', scheduleId: option.scheduleId }, done);   // choosing another section swaps it
  }

  /** First year students must take NSTP 1 in the 1st semester and NSTP 2 in the 2nd: the NSTP subjects still missing from the plan. */
  function missingNstp() {
    var term = SERVER.term;
    if (!term || SERVER.yearLevel !== 1 || (term.semester !== '1st' && term.semester !== '2nd')) return [];
    return allSubjects().filter(function (s) {
      return s.year === 1 && s.semester === term.semester && s.isAcademic === false && !s.passed && planIndex(s.code) === -1;
    });
  }

  function nstpMessage() {
    var m = missingNstp()[0];
    return m ? 'First year students must take ' + m.code.replace('_', ' ') + ' this semester. Add it to your plan before submitting.' : null;
  }

  function submitPlan(done) {
    if (state.submitted) return done(lockedMessage());
    if (state.plan.length === 0) return done('Add at least one subject before submitting.');
    if (nstpMessage()) return done(nstpMessage());
    if (hasConflict()) return done('Resolve the schedule conflict before submitting.');
    if (coreqProblem()) return done(coreqProblem());
    callEnrollment({ action: 'submit' }, done);
  }

  // ==== LOGIC END ====

  if (typeof document === 'undefined') return;

  // ---------- Small DOM helpers ----------
  var page = 'overview';       // current view, set by route()
  var plannerQuery = '';       // live text of the planner search box
  var routeQuery = '';         // ?q=... from the hash, used by the planner search
  var body = document.body;
  var lastFocus = null;
  var plannerTab = 'all'; // 'eligible' | 'all'
  var submittedView = false; // true right after submitting: the drawer shows the confirmation

  function $(sel) { return document.querySelector(sel); }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ic(id) { return '<svg class="ic"><use href="#i-' + id + '"/></svg>'; }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function stepsDone() {
    // step 1 is always done once eligibility is checked; step 2 needs at least one subject
    if (state.submitted) return 3;
    return state.plan.length === 0 ? 1 : 2;
  }

  // ---------- Shared chrome ----------
  var SPRITE = CM ? CM.SPRITE : '';

  function notifications() {
    var list = [];
    if (SERVER.term) {
      list.push({ title: 'Enrollment is open', body: 'AY ' + dashYears(SERVER.term.academicYear) + ' · ' + semLabel(SERVER.term.semester) +
        '. Review your study load before submitting.' });
    }
    if (state.status === 'Enrolled') {
      list.unshift({ title: 'Study load approved', body: 'Your adviser approved your proposed subjects.' });
    } else if (state.sentBack) {
      list.unshift({ title: 'Changes requested', body: state.remarks || 'Your adviser asked you to revise your study load.' });
    } else if (state.status === 'Rejected') {
      list.unshift({ title: 'Request rejected', body: state.remarks || 'Your adviser rejected this study load.' });
    }
    return list;
  }

  // A notification is "new" until the student opens the bell. Seen ones are remembered per student in this browser.
  function seenKey() { return 'coursemap-notif-seen-v1:' + (STUDENT.id || STUDENT.fullName || 'student'); }
  function notifId(n) { return n.title + '|' + n.body; }
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(seenKey()) || '[]'); } catch (e) { return []; }
  }
  function markNotificationsSeen() {
    try { localStorage.setItem(seenKey(), JSON.stringify(notifications().map(notifId))); } catch (e) { /* storage unavailable */ }
    updateBell();
  }
  function updateBell() {
    var btn = $('.btn-bell'), badge = $('#bell-count');
    if (!btn || !badge) return;
    var seen = readSeen();
    var fresh = notifications().filter(function (n) { return seen.indexOf(notifId(n)) === -1; }).length;
    btn.classList.toggle('has-new', fresh > 0);
    badge.hidden = fresh === 0;
    badge.textContent = fresh > 9 ? '9+' : fresh;
    btn.setAttribute('aria-label', fresh ? 'Notifications, ' + fresh + ' new' : 'Notifications');
  }

  function topbarHtml() {
    var notifs = '';

    return '' +
      '<header class="topbar">' +
        '<a href="#/" class="logo" aria-label="CourseMap student portal home">' +
          '<span class="logo-mark">' + ic('cap') + '</span>' +
          '<span class="logo-text"><span class="logo-name">CourseMap</span>' +
          '<span class="logo-sub">STUDENT PORTAL</span></span>' +
        '</a>' +
        '<div class="topbar-right">' +
          '<button type="button" class="btn-review" data-open-drawer aria-label="Review your plan">' + ic('book') + ' <span class="btn-label">Review</span> ' +
            '<span class="count-badge" id="plan-count">0</span></button>' +
          '<div class="bell-wrap">' +
            '<button type="button" class="btn-bell" data-toggle-notif aria-label="Notifications" aria-expanded="false">' +
              ic('bell') + '<span class="bell-count" id="bell-count" hidden>0</span></button>' +
            '<div class="notif" id="notif" role="region" aria-label="Notifications">' +
              '<h2>Notifications</h2><ul id="notif-list">' + notifs + '</ul></div>' +
          '</div>' +
          '<span class="divider"></span>' +
          '<div class="user">' +
            '<span class="avatar">' + esc(STUDENT.initials) + '</span>' +
            '<span class="user-meta"><span class="user-name">' + esc(STUDENT.fullName) + '</span>' +
            '<span class="user-program">' + esc(STUDENT.program) + '</span></span>' +
          '</div>' +
          '<button type="button" class="btn-signout" data-signout aria-label="Sign out" title="Sign out">' + ic('logout') + '</button>' +
        '</div>' +
      '</header>';
  }

  var NAV = [
    { page: 'overview', href: '#/', icon: 'grid', label: 'Overview' },
    { page: 'planner', href: '#/planner', icon: 'book', label: 'Subject Planner' },
    { page: 'schedule', href: '#/schedule', icon: 'calendar', label: 'My Schedule' },
    { page: 'records', href: '#/records', icon: 'file', label: 'Enrollment Records' }
  ];

  function sidebarHtml(active) {
    var links = NAV.map(function (n) {
      var on = n.page === active;
      return '<a href="' + n.href + '" class="nav-item' + (on ? ' is-active' : '') + '"' +
        (on ? ' aria-current="page"' : '') + '>' + ic(n.icon) + esc(n.label) + '</a>';
    }).join('');

    return '' +
      '<aside class="sidebar">' +
        '<nav style="display:contents" aria-label="Main">' + links + '</nav>' +
        '<div class="guidance">' +
          '<span class="guidance-icon">' + ic('help') + '</span>' +
          '<strong>Need guidance?</strong>' +
          '<p>Your program adviser is available for enrollment questions.</p>' +
          '<a href="mailto:adviser@coursemap.example">Contact adviser →</a>' +
        '</div>' +
        '<div class="sidebar-foot" id="term-foot">Registrar’s Office</div>' +
      '</aside>';
  }

  function drawerShellHtml() {
    return '<div class="scrim" data-close-drawer></div>' +
      '<aside class="drawer" id="drawer" role="dialog" aria-modal="true" ' +
      'aria-labelledby="drawer-title" aria-hidden="true"></aside>';
  }

  // ---------- Overload / underload forms (load_forms.php) ----------
  function pendingForm() { return state.forms.some(function (f) { return f.status === 'Pending'; }); }

  function formsHtml(units) {
    var rows = state.forms.map(function (f) {
      var tone = f.status === 'Approved' ? 'ok' : f.status === 'Rejected' ? 'full' : 'low';
      return '<li style="display:flex;gap:.6rem;align-items:center;justify-content:space-between;margin:.4rem 0">' +
        '<span><b>' + esc(f.form_type) + '</b> · ' + esc(f.file_name) +
          (f.remarks && f.status !== 'Pending' ? '<small style="display:block">Remarks: ' + esc(f.remarks) + '</small>' : '') + '</span>' +
        '<span><span class="badge ' + tone + '">' + esc(f.status) + '</span>' +
          (f.status === 'Pending' ? ' <button type="button" class="btn-text" data-form-remove="' + f.form_id + '">Remove</button>' : '') + '</span></li>';
    }).join('');
    var hint = SERVER.canOverload
      ? (units > baseUnits() && maxUnits() <= baseUnits()
          ? 'Your load is over ' + baseUnits() + ' units. Upload a signed Overload form and wait for approval before submitting.'
          : 'Taking more than ' + baseUnits() + ' units, or fewer than the usual load? Upload the signed Overload or Underload form (PDF, up to 5 MB).')
      : 'Your load for this term is up to ' + baseUnits() + ' units. Taking fewer? Upload the signed Underload form (PDF, up to 5 MB).';
    return '<div class="load-summary" id="load-forms">' +
      '<div class="row"><span>Overload / Underload form</span></div>' +
      '<p>' + esc(hint) + '</p>' +
      (rows ? '<ul style="list-style:none;padding:0;margin:.5rem 0">' + rows + '</ul>' : '') +
      (pendingForm() ? '<p><b>A form is waiting for approval.</b> You can still submit your subjects for adviser review while the admin reviews the form.</p>' : '') +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.6rem">' +
        '<select data-form-type aria-label="Form type">' + (SERVER.canOverload ? '<option>Overload</option>' : '') + '<option>Underload</option></select>' +
        '<input type="file" data-form-file accept="application/pdf,.pdf" aria-label="PDF form">' +
      '</div></div>';
  }

  var uploading = false;
  function uploadForm(file, type) {
    if (!file || uploading) return;
    if (!/\.pdf$/i.test(file.name)) { showFlash('Only PDF files are accepted.'); return; }
    if (file.size > 5 * 1024 * 1024) { showFlash('The file is too big (5 MB at most).'); return; }
    uploading = true;
    var fd = new FormData();
    fd.append('action', 'upload'); fd.append('formType', type); fd.append('file', file);
    CM.apiUpload('load_forms', fd, function (res) {
      uploading = false;
      if (!res.ok) { showFlash(res.error || 'The upload failed.'); render(); return; }
      SERVER.enrollment = res.enrollment;
      reloadPlan(function () { showFlash(null); render(); });
    });
  }

  function removeForm(formId) {
    CM.apiAuth('load_forms', { action: 'remove', formId: parseInt(formId, 10) }, function (res) {
      if (!res.ok) { showFlash(res.error || 'Could not remove the form.'); return; }
      SERVER.enrollment = res.enrollment;
      reloadPlan(function () { showFlash(null); render(); });
    });
  }

  function drawerInnerHtml() {
    var items = plannedItems();
    var units = plannedUnits();
    var conflicts = getConflicts();
    var conflict = conflicts.length > 0;
    var coreq = coreqProblem();
    var nstp = nstpMessage();
    var percent = Math.min(100, Math.floor(units * 100 / maxUnits()));

    var html = '' +
      '<div class="drawer-head"><div>' +
        '<span class="eyebrow-sm">Step 2 of 3</span>' +
        '<h2 id="drawer-title">Review your load</h2></div>' +
        '<button type="button" class="btn-close" data-close-drawer aria-label="Close">' + ic('x') + '</button>' +
      '</div>';

    if (submittedView || state.submitted) {
      var doneTitle = state.status === 'Enrolled' ? 'Study load approved' : state.status === 'Rejected' ? 'Request rejected' : 'Request submitted';
      var doneText = state.status === 'Enrolled' ? 'Your adviser approved your proposed subjects.'
        : state.status === 'Rejected' ? (state.remarks || 'Your adviser rejected this study load. Contact your adviser.')
        : 'Your adviser will review your proposed load. You can still upload an Overload or Underload form while the request is being reviewed.';
      return html +
        '<div class="drawer-success"><span class="success-icon">' + ic(state.status === 'Rejected' ? 'x' : 'check') + '</span>' +
        '<h3>' + esc(doneTitle) + '</h3>' +
        '<p>' + esc(doneText) + '</p>' +
        (state.status === 'For Review' ? formsHtml(plannedUnits()) : '') +
        '<button type="button" class="btn-back" data-back-planner>Back to planner</button></div>';
    }

    if (items.length === 0) {
      html += '<div class="drawer-empty">No subjects yet. Add subjects from the Subject Planner to review them here.</div>';
    }

    items.forEach(function (item) {
      var s = item.subject, cur = item.option;

      var menu = s.options.map(function (o) {
        var isCurrent = o.id === cur.id;
        return '<button type="button" class="sched-opt' + (isCurrent ? ' is-current' : '') + '"' +
          ' data-action="option" data-code="' + esc(s.code) + '" data-option="' + esc(o.id) + '"' +
          (isFull(o) ? ' disabled' : '') + ' role="option" aria-selected="' + isCurrent + '">' +
          '<div><b>' + (isCurrent ? '✓ ' : '') + esc(o.label) + '</b><small>' + esc(o.section) + ' · ' + esc(o.room) + '</small></div>' +
          '<span class="badge ' + spotsTone(o) + '">' + esc(spotsText(o)) + '</span></button>';
      }).join('');

      html += '' +
        '<div class="load-item tone-' + s.tone + '" data-code="' + esc(s.code) + '">' +
          '<div class="load-head">' +
            '<span class="load-badge">' + esc(s.badge) + '</span>' +
            '<span class="load-title"><small>' + esc(s.code) + '</small><b>' + esc(s.title) + '</b></span>' +
            '<span class="load-units">' + s.units + ' units</span>' +
          '</div>' +
          '<div class="load-options">' +
            '<div class="pair">' +
              '<div class="dfield"><span class="lbl">Section</span>' +
                '<span class="auto-field" data-field="section">' + esc(cur.section) + '</span></div>' +
              '<div class="dfield"><span class="lbl">Room</span>' +
                '<span class="auto-field" data-field="room">' + esc(cur.room) + '</span></div>' +
            '</div>' +
            '<form class="dfield" data-js>' +
              '<span class="lbl">Schedule</span>' +
              '<button type="button" class="sched-btn" data-toggle-menu aria-haspopup="listbox" aria-expanded="false">' +
                '<span>' + esc(cur.label) + '</span>' + ic('down') + '</button>' +
              '<div class="sched-menu" role="listbox">' + menu + '</div>' +
              '<span class="spots-hint' + (spotsTone(cur) === 'low' ? ' low' : '') + '">' + esc(spotsText(cur)) + '</span>' +
              '<span class="auto-note">Section and room are assigned automatically from the schedule you pick.</span>' +
            '</form>' +
          '</div>' +
        '</div>';
    });

    html += '' +
      '<div class="load-summary">' +
        '<div class="row"><span>Selected load</span><b>' + units + ' units</b></div>' +
        '<div class="track"><i style="width:' + percent + '%"></i></div>' +
        '<p>Recommended load: 15–18 units. You can still revise this after consulting your adviser.</p>' +
      '</div>' +
      '<div class="conflict-check' + (conflict || coreq || nstp ? ' is-conflict' : '') + '">' + ic('spark') +
        (conflict
          ? '<div><b>Schedule conflicts found</b><div class="review-overlaps" style="margin:.7rem 0 0;background:transparent;border:0;padding:0">' +
              conflicts.map(function (c) {
                return '<span class="bad">✕ <b>' + esc(c.subjectA) + '</b> (' + esc(c.whenA) + ') overlaps <b>' + esc(c.subjectB) + '</b> (' + esc(c.whenB) + ') on ' + esc(c.day) + '.</span>';
              }).join('') +
              '<small>Choose a different schedule for one of the overlapping subjects.</small></div></div>'
          : coreq ? '<span>' + esc(coreq) + ' Add it to your plan before submitting.</span>'
          : nstp ? '<span>' + esc(nstp) + '</span>'
          : '<span>No schedule conflicts detected. All prerequisites for these subjects have been completed.</span>') +
      '</div>' +
      formsHtml(units) +
      '<form data-js style="display:contents">' +
        '<button type="button" class="btn-submit" data-action="submit"' +
          (items.length === 0 || conflict || coreq || nstp ? ' disabled' : '') + '>' +
          'Submit for adviser review ' + ic('arrow') + '</button>' +
      '</form>' +
      '<button type="button" class="btn-text" data-close-drawer>Continue choosing subjects</button>';

    return html;
  }

  /** Replaces a <div data-mount="name"> placeholder with real markup. */
  function mount(name, html) {
    var holder = document.querySelector('[data-mount="' + name + '"]');
    if (!holder) return;
    holder.insertAdjacentHTML('afterend', html);
    holder.parentNode.removeChild(holder);
  }

  // ---------- Flash message ----------
  var flashTimer = null;

  function showFlash(message) {
    var host = $('#flash');
    if (!host) return;
    window.clearTimeout(flashTimer);
    if (!message) { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="flash" role="alert">' + esc(message) + '</div>';
    flashTimer = window.setTimeout(function () { host.innerHTML = ''; }, 6000);
  }

  // ---------- Page renderers ----------
  function renderOverview() {
    var units = plannedUnits(), count = state.plan.length, done = stepsDone();

    $('#stats').innerHTML =
      statCard('mint', 'Eligible subjects', eligibleCount(), 'Based on your completed prerequisites') +
      statCard('peach', 'Current plan', units + ' units', plural(count, 'subject', 'subjects') + ' selected') +
      statCard('lilac', 'Enrollment status', statusValue(), statusNote());

    function dot(n) {
      return '<span class="step-dot' + (done < n ? ' todo' : '') + '">' +
        (done >= n ? ic('check') : '<span>' + n + '</span>') + '</span>';
    }

    $('#progress-card').innerHTML = '' +
      '<div class="progress-head"><div>' +
        '<span class="eyebrow-sm">Enrollment progress</span><h2>Finish your subject plan</h2></div>' +
        '<span class="pill">' + done + ' of 3 steps</span></div>' +
      '<a href="#/planner" class="step-row">' +
        '<span class="step-dot">' + ic('check') + '</span>' +
        '<span class="step-text"><strong>Review eligible subjects</strong><span>Academic record checked</span></span>' +
        ic('chev') + '</a>' +
      '<a href="#/planner" class="step-row">' + dot(2) +
        '<span class="step-text"><strong>Choose your semester load</strong>' +
        '<span>' + units + ' of ' + maxUnits() + ' units selected</span></span>' + ic('chev') + '</a>' +
      '<button type="button" class="step-row" data-open-drawer style="width:100%;text-align:left">' + dot(3) +
        '<span class="step-text"><strong>Submit for adviser approval</strong><span>Review and send your final selection</span></span>' +
        ic('chev') + '</button>';
  }

  function statusValue() {
    if (state.status === 'For Review') return 'Submitted';
    if (state.status === 'Enrolled') return 'Approved';
    if (state.status === 'Rejected') return 'Rejected';
    return state.sentBack ? 'Needs revision' : 'Draft';
  }

  function statusNote() {
    if (state.status === 'For Review') return 'Waiting for adviser approval';
    if (state.status === 'Enrolled') return 'Your adviser approved this load';
    if (state.status === 'Rejected') return state.remarks || 'Contact your adviser';
    return state.sentBack ? 'Revise your plan and submit again' : 'Not yet submitted';
  }

  function statCard(tone, label, value, note) {
    return '<article class="card stat-card"><span class="stat-icon ' + tone + '">' + ic('check') + '</span>' +
      '<div class="stat-body"><span class="stat-label">' + esc(label) + '</span>' +
      '<span class="stat-value">' + esc(value) + '</span>' +
      '<span class="stat-note">' + esc(note) + '</span></div></article>';
  }

  function renderPlanner() {
    var units = plannedUnits(), count = state.plan.length;
    var query = plannerQuery;
    var planCodes = state.plan.map(function (p) { return p.code; });

    if (state.status === 'Enrolled') {
      $('#units-chip').innerHTML =
        '<span class="units-ring">' + ic('check') + '</span>' +
        '<div><strong>Enrolled</strong><span>' + units + ' units this semester</span></div>';
    } else {
      $('#units-chip').innerHTML =
        '<span class="units-ring">' + units + '</span>' +
        '<div><strong>' + units + ' of ' + maxUnits() + ' units</strong>' +
        '<span>' + (maxUnits() - units) + ' units available</span></div>';
    }

    $('#steps-count').textContent = plural(count, 'subject', 'subjects') + ' selected';
    $('#count-eligible').textContent = eligibleCount();
    $('#count-all').textContent = allSubjects().filter(function (s) { return !s.passed; }).length;

    document.querySelectorAll('[data-tab]').forEach(function (tab) {
      var active = tab.getAttribute('data-tab') === plannerTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    // subjects the student already passed are not shown here, the Enrollment records page has them
    var subjects = curriculum(query).filter(function (s) { return !s.passed; });
    var html = '';

    if (!SERVER.loaded) {
      $('#subject-grid').innerHTML = '<p class="card empty">Loading your subjects…</p>';
      return;
    }
    if (SERVER.error && subjects.length === 0) {
      $('#subject-grid').innerHTML = '<p class="card empty">' + esc(SERVER.error) + '</p>';
      return;
    }
    if (subjects.length === 0) {
      html += '<p class="card empty">' + (query
        ? 'No subjects match “' + esc(query) + '”. Try a subject code or part of the title.'
        : 'No subjects left to take. Your passed subjects are on the Enrollment records page.') + '</p>';
    }

    // subjects you can add now come first, then locked ones, then the ones with no sections, then passed ones
    function rank(s) {
      if (planCodes.indexOf(s.code) !== -1) return 0;
      if (s.passed) return 4;
      if (isAvailable(s)) return 1;
      if (isOffered(s)) return 2;
      return 3;
    }
    var order = subjects.map(function (s, i) { return { s: s, i: i }; });
    order.sort(function (a, b) { return rank(a.s) - rank(b.s) || a.i - b.i; });

    order.forEach(function (entry) {
      var s = entry.s;
      var eligible = isEligible(s);
      if (plannerTab === 'eligible' && !isAvailable(s)) return;
      var planned = planCodes.indexOf(s.code) !== -1;

      var action;
      if (planned) {
        action = state.submitted
          ? '<button type="button" class="btn-plan is-added" disabled>✓ Added to plan</button>'
          : '<form data-js><button type="button" class="btn-plan is-added" data-action="remove" ' +
            'data-code="' + esc(s.code) + '" title="Remove from plan">✓ Added to plan</button></form>';
      } else if (s.passed) {
        action = '<button type="button" class="btn-plan" disabled>Already passed</button>';
      } else if (eligible && s.options.length === 0) {
        action = '<button type="button" class="btn-plan" disabled>Sections not released yet</button>';
      } else if (eligible && state.submitted) {
        action = '<button type="button" class="btn-plan" disabled>Plan is locked</button>';
      } else if (eligible) {
        action = '<form data-js><button type="button" class="btn-plan" data-action="add" ' +
          'data-code="' + esc(s.code) + '">+ Add to plan</button></form>';
      } else {
        action = '<button type="button" class="btn-plan" disabled>' + (s.prereqStatus === 'SEMESTER' ? 'Not offered this semester' : s.prereqStatus === 'STANDING' ? 'Year standing not met' : 'Prerequisite not met') + '</button>';
      }

      html += '' +
        '<article class="subject-card tone-' + s.tone + (planned ? ' is-selected' : '') + '" data-eligible="' + eligible + '">' +
          '<div class="bar"></div>' +
          '<div class="subject-body">' +
            '<div class="subject-top"><span class="code-pill">' + esc(s.code) + '</span>' +
              '<span class="subject-state">' + (planned ? '✓ Selected' : s.passed ? 'Passed' : (eligible ? 'Eligible' : 'Locked')) + '</span></div>' +
            '<h2 class="subject-title">' + esc(s.title) + '</h2>' +
            '<p class="subject-desc">' + esc(s.description) + '</p>' +
            '<div class="prereq' + (!isEligible(s) && !s.passed ? ' locked' : '') + '">' +
              '<span class="prereq-label">PREREQUISITE CHECK</span>' +
              '<div class="prereq-row"><strong>' + esc(prereqText(s)) + '</strong>' +
              '<span>' + esc(prereqStatusText(s)) + '</span></div></div>' +
            '<hr><span class="units">' + s.units + ' units</span>' +
            action +
          '</div>' +
        '</article>';
    });

    $('#subject-grid').innerHTML = html;
  }

  function renderSchedule() {
    var items = plannedItems(), units = plannedUnits(), conflict = hasConflict();
    var coreq = coreqProblem();

    $('#conflict-banner').className = 'no-conflict' + (conflict ? ' is-conflict' : '');
    $('#conflict-banner').innerHTML = '' +
      '<span class="banner-icon">' + ic(conflict ? 'x' : 'check') + '</span>' +
      '<span class="step-text"><strong>' +
        (conflict ? 'Schedule conflict detected' : 'No schedule conflicts detected') + '</strong>' +
        '<span>' + (conflict ? 'Two of your selected classes overlap.' : 'Your selected classes do not overlap.') + '</span></span>' +
      '<span class="meta">' + items.length + ' subjects · ' + units + ' units</span>';

    var rows = items.map(function (item, i) {
      return '<tr class="tone-' + item.subject.tone + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><span class="code-pill">' + esc(item.subject.code) + '</span></td>' +
        '<td><span class="cell-title">' + esc(item.subject.title) + '</span>' +
          '<span class="cell-sub">' + esc(item.option.section) + ' · ' + esc(item.option.room) + '</span></td>' +
        '<td>' + item.subject.units + '</td>' +
        '<td><span class="when">' + ic('clock') + '<span>' + esc(item.option.label) + '</span></span></td>' +
      '</tr>';
    }).join('');

    if (items.length === 0) {
      rows += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">' +
        'Your plan is empty. <a href="#/planner" style="color:var(--forest);font-weight:600">Add subjects</a> to see them here.</td></tr>';
    }
    rows += '<tr class="total-row"><td colspan="5">Total units <strong>' + units + '</strong></td></tr>';
    $('#plan-rows').innerHTML = rows;

    var days = ttDays();
    var cols = ' style="grid-template-columns:5.6rem repeat(' + days.length + ',minmax(0,1fr))"';
    var grid = '<div class="tt-row tt-head"' + cols + '><div>TIME</div>' +
      days.map(function (d) { return '<div>' + DAY_FULL[d] + '</div>'; }).join('') + '</div>';

    timetable().forEach(function (row) {
      grid += '<div class="tt-row"' + cols + '><div class="tt-time">' + esc(row.time) + '</div>';
      days.forEach(function (day) {
        var b = row.cells[day];
        grid += '<div class="tt-cell">' + (b
          ? '<div class="event tone-' + b.tone + '"><b>' + esc(b.code) + '</b><span>' + esc(b.title) +
            '</span><span>' + esc(b.room) + '</span></div>'
          : '') + '</div>';
      });
      grid += '</div>';
    });
    $('#tt').innerHTML = grid;

    // the SER can only be printed once the adviser has approved the plan (status Enrolled)
    var printBtn = $('[data-print]');
    if (printBtn) {
      var enrolled = state.status === 'Enrolled';
      printBtn.disabled = !enrolled;
      printBtn.title = enrolled ? '' : 'Available once your enrollment status is Enrolled';
      printBtn.textContent = enrolled ? 'Print SER' : 'Print SER (after enrollment)';
    }
  }

  /** The totals on the Records page come from the grades in MySQL. */
  function renderSummary() {
    var acad = 0, nstp = 0, failed = false;
    SERVER.terms.forEach(function (t) {
      t.subjects.forEach(function (x) {
        if (x.passed) { if (x.isAcademic !== false) acad += x.units; else nstp += x.units; }
        else if (x.remark) failed = true;
      });
    });
    var gwa = SERVER.gwa === null || SERVER.gwa === undefined ? '—' : Number(SERVER.gwa).toFixed(2);
    function put(id, v) { var el = $(id); if (el) el.textContent = v; }
    put('#sum-units', acad + nstp); put('#sum-gwa', gwa); put('#sum-standing', !SERVER.loaded ? '—' : failed ? 'Needs attention' : 'Good');
    put('#foot-gwa', gwa); put('#foot-units', acad + nstp); put('#foot-acad', acad); put('#foot-nstp', nstp);
  }

  function renderRecords() {
    renderSummary();
    $('#terms').innerHTML = !SERVER.loaded ? '<p class="card empty">Loading your records…</p>' : TERMS.map(function (t) {
      var completed = t.status === 'Completed';
      // the current term shows the subjects in your plan; other terms show their grades
      var source = t.current
        ? plannedItems().map(function (it) {
            var g = (SERVER.currentGrades || {})[it.subject.subjectId];     // the grade the admin saved for this term
            return { code: it.subject.code, description: it.subject.title, units: it.subject.units, grade: g ? g.grade : '—',
                     status: g ? g.remark : state.status === 'Enrolled' ? 'ENROLLED' : state.submitted ? 'SUBMITTED' : 'PLANNED', planned: !g };
          })
        : t.rows;
      var rows = source.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.code) + '</td><td>' + esc(r.description) + '</td>' +
          '<td>' + r.units + '</td><td>' + esc(r.grade) + '</td>' +
          '<td><span class="pill status-pill' + (r.planned ? ' pill-butter' : '') + '">' + esc(r.status) + '</span></td></tr>';
      }).join('');
      if (!rows) rows = '<tr><td colspan="6" style="text-align:center;color:var(--muted);height:4rem">' +
        'No subjects in your plan yet. <a href="#/planner" style="color:var(--forest);font-weight:600">Add subjects</a></td></tr>';

      return '' +
        '<article class="card term">' +
          '<button type="button" class="term-head" data-term aria-expanded="' + t.expanded + '" aria-controls="term-' + esc(t.id) + '">' +
            '<span class="term-icon' + (t.expanded ? ' rose' : '') + '">' + ic(t.expanded ? 'x' : 'arrow') + '</span>' +
            '<span class="term-col wide">' +
              '<span class="term-field"><small>' + esc(t.yearField || 'SCHOOL YEAR') + '</small><b>' + esc(t.schoolYear) + '</b></span>' +
              '<span class="term-field"><small>PROGRAM</small><b class="sm">' + esc(t.program) + '</b></span></span>' +
            '<span class="term-col grow">' +
              '<span class="term-field"><small>SEMESTER</small><b>' + esc(t.semester) + '</b></span>' +
              '<span class="term-field"><small>GWA</small><b class="sm">' + esc(t.gwa) + '</b></span></span>' +
            '<span class="pill' + (completed ? '' : ' pill-butter') + '">' + esc(t.status) + '</span>' +
            '<svg class="ic term-chev"><use href="' + (t.expanded ? '#i-down' : '#i-chev') + '"/></svg>' +
          '</button>' +
          '<div class="term-body" id="term-' + esc(t.id) + '"' + (!t.expanded ? ' hidden' : '') + '>' +
            '<table class="data-table"><thead><tr>' +
              '<th style="width:4.2rem">#</th><th style="width:15rem">SUBJECT CODE</th><th>DESCRIPTION</th>' +
              '<th style="width:7rem">UNITS</th><th style="width:11rem">FINAL GRADE</th><th style="width:9rem">STATUS</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  var RENDERERS = {
    overview: renderOverview,
    planner: renderPlanner,
    schedule: renderSchedule,
    records: renderRecords
  };

  function render() {
    var nl = $('#notif-list');
    if (nl) nl.innerHTML = notifications().map(function (n) {
      return '<li><strong>' + esc(n.title) + '</strong><span>' + esc(n.body) + '</span></li>';
    }).join('');
    var badge = $('#plan-count');
    if (badge) {
      badge.textContent = state.plan.length;
      badge.hidden = state.submitted;          // review already sent: no count on the button
    }
    updateBell();
    if (notif && notif.classList.contains('is-open')) markNotificationsSeen();
    var drawer = $('#drawer');
    if (drawer) drawer.innerHTML = drawerInnerHtml();
    Object.keys(RENDERERS).forEach(function (name) { RENDERERS[name](); });
  }

  // ---------- Review drawer ----------
  var drawer, notif, bell;

  function openDrawer() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    body.classList.add('drawer-open');
    drawer.setAttribute('aria-hidden', 'false');
    var close = drawer.querySelector('.btn-close');
    if (close) close.focus();
  }

  function closeDrawer() {
    if (!drawer) return;
    body.classList.remove('drawer-open');
    submittedView = false;
    drawer.setAttribute('aria-hidden', 'true');
    closeMenus();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ---------- Notifications ----------
  function closeNotif() {
    if (!notif || !bell) return;
    notif.classList.remove('is-open');
    bell.setAttribute('aria-expanded', 'false');
  }

  // ---------- Schedule dropdowns inside the drawer ----------
  function closeMenus(except) {
    document.querySelectorAll('.sched-menu.is-open').forEach(function (m) {
      if (m !== except) {
        m.classList.remove('is-open');
        var btn = m.parentElement.querySelector('[data-toggle-menu]');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---------- Actions (what the old form posts did) ----------
  var busy = false;

  function runAction(action, code, optionId) {
    if (busy) return;
    busy = true;

    function finish(error) {
      busy = false;
      showFlash(error);

      if (action === 'submit' && !error) {
        submittedView = true;   // keep the drawer open and show "Request submitted"
        render();
        var done = drawer && drawer.querySelector('[data-back-planner]');
        if (done) done.focus();
        return;
      }

      render();

      if (action === 'option') {
        var btn = document.querySelector('.load-item[data-code="' + code + '"] .sched-btn');
        if (btn) btn.focus();
      }
    }

    if (action === 'add') addSubject(code, finish);
    else if (action === 'remove') removeSubject(code, finish);
    else if (action === 'option') chooseOption(code, optionId, finish);
    else if (action === 'submit') submitPlan(finish);
    else busy = false;
  }


  // ---------- Print SER (Student Enrollment Record) ----------
  // Details copied from the registrar's SER form. Edit here if they change.
  var SER_PROFILE = {
    studentNo: '202412176', name: 'SALVACION, LANZ MANUEL IQUIÑA', type: 'Shiftee', yearLevel: '3',
    controlNo: '046798', college: 'CISTM', course: 'BSIT', regStatus: 'Irregular',
    reference: 'RA 10931 (CHED UniFAST)'
  };
  /** The SER header details: the registrar's sample for the built-in student, otherwise built from the account. */
  function serProfile() {
    if (!STUDENT.id || STUDENT.isDemo) return SER_PROFILE;
    var parts = String(STUDENT.fullName).trim().split(/\s+/);
    var last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    var first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    var courses = { 'BS Information Technology': 'BSIT', 'BS Computer Science': 'BSCS', 'BS Information Systems': 'BSIS' };
    return { studentNo: STUDENT.id, name: (last + (first ? ', ' + first : '')).toUpperCase(), type: 'Regular',
             yearLevel: String(parseInt(STUDENT.year, 10) || ''), controlNo: '', college: '',
             course: courses[STUDENT.program] || String(STUDENT.program).split(/\s+/).filter(function (w) { return !/^(of|in|and|the)$/i.test(w); })
               .map(function (w) { return w[0]; }).join('').toUpperCase(), regStatus: (typeof SERVER !== 'undefined' && SERVER.regStatus) || 'Regular', reference: '' };
  }
  var SER_RATE_PER_UNIT = 1200;   // tuition: 12 units = 14,400.00 on the sample SER
  var SER_MISC = [['Cultural Activity', 74], ['Athletic Fee without PE', 117], ['Library Fee', 732],
    ['Medical/Dental Laboratory Fee', 293], ['Registration Fee', 74], ['Guidance Fee', 146], ['Student Welfare', 74]];
  var SER_OTHER = [['Ang Pamantasan Fee', 50], ['Supreme Student Council', 50], ['Development Fund CISTM', 146]];
  var DAY_CODE = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'TH', Fri: 'F' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function total(list) { return list.reduce(function (n, x) { return n + x[1]; }, 0); }

  /** "Mon & Wed · 10:00–11:30 AM" -> "10:00AM-11:30AM" */
  function serTime(label) {
    var part = String(label).split('·').pop();
    var m = /(\d{1,2}:\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}:\d{2})\s*(AM|PM)/.exec(part);
    return m ? m[1] + (m[2] || m[4]) + '-' + m[3] + m[4] : part.trim();
  }

  function serCopy(label, d) {
    var rows = d.items.map(function (it) {
      return '<tr><td>' + esc(it.subject.code) + '</td><td>' + esc(it.option.section) + '</td><td class="l">' + esc(it.subject.title) +
        '</td><td>' + it.subject.units + '</td><td>' + esc(it.option.days.map(function (x) { return DAY_CODE[x] || x; }).join('/')) +
        '</td><td>' + esc(serTime(it.option.label)) + '</td><td>' + esc(it.option.room.toUpperCase()) + '</td></tr>';
    }).join('');

    function fee(name, amount, strong) {
      return '<div class="' + (strong ? 'b' : '') + '"><span>' + esc(name) + '</span><span>' + money(amount) + '</span></div>';
    }
    var f = fee('Tuition Fees', d.tuition, true) + fee('Tuition', d.tuition) + fee('Miscellaneous Fees', d.misc, true) +
      SER_MISC.map(function (x) { return fee(x[0], x[1]); }).join('') + fee('Other Fees', d.other, true) +
      SER_OTHER.map(function (x) { return fee(x[0], x[1]); }).join('') +
      fee('Total Assessment Fee:', d.total, true) + fee('Previous Payment/s:', 0, true) +
      fee('TOTAL AMOUNT DUE:', d.total, true) + fee('TOTAL AMOUNT PAID:', 0, true);

    var p = serProfile();
    function cell(lbl, val, cls) { return '<div class="c ' + (cls || '') + '"><small>' + lbl + '</small><b>' + esc(val) + '</b></div>'; }

    return '<section class="ser-copy">' +
      '<div class="ser-head"><div class="ser-uni"><b>PAMANTASAN NG LUNGSOD NG MAYNILA</b><i>(University of the City of Manila)</i><span>Intramuros, Manila</span></div>' +
        '<div class="ser-title"><b>STUDENT ENROLLMENT RECORD</b><span>' + esc(d.semester) + ' &nbsp;School Year <b>' + esc(d.sy) + '</b></span></div>' +
        '<div class="ser-tag">' + label + '</div></div>' +
      '<div class="ser-info">' +
        '<div class="g1">' + cell('Student No:', p.studentNo) + cell('Student Name:', p.name, 'name') + cell('Student Type:', p.type) +
          cell('Year Level:', p.yearLevel) + cell('Control No:', p.controlNo) + '</div>' +
        '<div class="g2">' + cell('College:', p.college) + cell('Course:', p.course, 'name') + cell('Type:', '', 'wide') +
          cell('Registration Status:', p.regStatus) + '</div>' +
      '</div>' +
      '<div class="ser-main"><div class="ser-left">' +
        '<table><thead><tr><th>Subject Code</th><th>Sec.</th><th>Subject Title</th><th>Units</th><th>Days</th><th>Time</th><th>Room</th></tr></thead>' +
          '<tbody>' + rows + '<tr class="fill"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>' +
        '<div class="ser-remarks"><span>Remarks: This enrollment becomes official until all requirements are complied with.</span>' +
          '<div class="units"><small>Total Units:</small><b>' + d.units + '</b></div></div>' +
      '</div><div class="ser-fees">' + f + '</div></div>' +
      '<div class="ser-foot">' + cell('Encoder:', p.studentNo) + cell('Date:', d.date) + cell('Reference:', p.reference) +
        cell('Date and Signature:', '') + cell('Amount Due:', money(d.total)) + '</div>' +
    '</section>';
  }

  function printSer() {
    if (state.status !== 'Enrolled') { showFlash('You can print your SER once your enrollment status is Enrolled.'); return; }
    var items = plannedItems();
    if (items.length === 0) { showFlash('Add at least one subject before printing your SER.'); return; }
    var units = plannedUnits();
    var now = new Date();
    var misc = total(SER_MISC), other = total(SER_OTHER), tuition = units * SER_RATE_PER_UNIT;
    var d = {
      items: items, units: units, tuition: tuition, misc: misc, other: other, total: tuition + misc + other,
      semester: $('#sem') ? $('#sem').value : 'First Semester',
      sy: ($('#sy') ? $('#sy').value : '2025–2026').replace('–', '-'),
      date: now.getFullYear() + '-' + MONTHS[now.getMonth()] + '-' + ('0' + now.getDate()).slice(-2)
    };
    $('#ser-print').innerHTML = serCopy('STUDENT’S COPY', d) + serCopy('REGISTRAR’S COPY', d);
    window.print();
  }

  // ---------- Routing (#/, #/planner, #/schedule, #/records) ----------
  var TITLES = {
    overview: 'Student Dashboard', planner: 'Subject Planner',
    schedule: 'My Schedule', records: 'Enrollment Records'
  };

  function route() {
    var raw = window.location.hash.replace(/^#\/?/, '');
    var parts = raw.split('?');
    var name = parts[0] || 'overview';
    if (!TITLES[name]) name = 'overview';
    page = name;
    routeQuery = new URLSearchParams(parts[1] || '').get('q') || '';
    plannerQuery = routeQuery;
    var ps = $('#planner-search');
    if (ps) ps.value = plannerQuery;

    document.querySelectorAll('.view').forEach(function (v) {
      v.hidden = v.getAttribute('data-view') !== name;
    });
    document.querySelectorAll('.sidebar .nav-item').forEach(function (a, i) {
      var on = NAV[i].page === name;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITLES[name] + ' · CourseMap';

    closeNotif();
    if (body.classList.contains('drawer-open')) closeDrawer();
    showFlash(null);
    render();
    window.scrollTo(0, 0);
    // grades are encoded by the admin while this tab is open, so fetch them again when the records page opens
    if (name === 'records' && SERVER.loaded) loadAll(render);
  }

  // ---------- Events (delegated, so re-rendered content keeps working) ----------
  function bindEvents() {
    document.addEventListener('change', function (e) {
      if (e.target.matches && e.target.matches('[data-form-file]')) {
        var sel = document.querySelector('[data-form-type]');
        uploadForm(e.target.files && e.target.files[0], sel ? sel.value : 'Underload');
      }
    });

    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('[data-open-drawer]')) { closeNotif(); openDrawer(); return; }
      if (t.closest('[data-close-drawer]')) { closeDrawer(); return; }

      var toggle = t.closest('[data-toggle-menu]');
      if (toggle) {
        var menu = toggle.parentElement.querySelector('.sched-menu');
        closeMenus(menu);
        var open = menu.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', String(open));
        return;
      }
      if (!t.closest('.sched-menu')) closeMenus();

      if (t.closest('[data-toggle-notif]')) {
        var isOpen = notif.classList.toggle('is-open');
        bell.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) markNotificationsSeen();
        return;
      }
      if (!t.closest('.bell-wrap')) closeNotif();

      var rmForm = t.closest('[data-form-remove]');
      if (rmForm) { removeForm(rmForm.getAttribute('data-form-remove')); return; }

      var actionBtn = t.closest('[data-action]');
      if (actionBtn && !actionBtn.disabled) {
        runAction(actionBtn.getAttribute('data-action'),
          actionBtn.getAttribute('data-code'), actionBtn.getAttribute('data-option'));
        return;
      }

      var tab = t.closest('[data-tab]');
      if (tab) {
        plannerTab = tab.getAttribute('data-tab');
        render();
        return;
      }

      var head = t.closest('[data-term]');
      if (head) {
        var termId = head.getAttribute('aria-controls').replace(/^term-/, '');
        TERMS.forEach(function (term) { if (term.id === termId) term.expanded = !term.expanded; });
        renderRecords();
        return;
      }

      if (t.closest('[data-signout]')) { CM.signOut(); return; }

      if (t.closest('[data-back-planner]')) {
        closeDrawer();
        window.location.hash = '#/planner';
        return;
      }

      if (t.closest('[data-print]')) { printSer(); return; }
    });

    // Forms are only layout wrappers now; never let them reload the page.
    document.addEventListener('submit', function (e) {
      if (e.target.matches('form[data-js]')) { e.preventDefault(); return; }
    });

    // planner search filters the subject cards as you type
    document.addEventListener('input', function (e) {
      if (e.target.id !== 'planner-search') return;
      plannerQuery = e.target.value;
      renderPlanner();
    });

    window.addEventListener('hashchange', route);

    // Escape closes whatever is open
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.sched-menu.is-open')) { closeMenus(); return; }
      if (notif && notif.classList.contains('is-open')) { closeNotif(); return; }
      if (body.classList.contains('drawer-open')) closeDrawer();
    });

    // Signing out in another tab signs this one out too
    window.addEventListener('storage', function (e) {
      if (e.key === CM.KEYS.session && !CM.getSession()) window.location.reload();
    });
  }

  // ---------- Start ----------
  mount('sprite', SPRITE);
  mount('topbar', topbarHtml());
  mount('sidebar', sidebarHtml(page));
  mount('drawer', drawerShellHtml());

  drawer = $('#drawer');
  notif = $('#notif');
  bell = $('[data-toggle-notif]');

  /** 'YYYY-MM-DD' -> 'August 18, 2026' (no Date object, so the time zone can't shift the day). */
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }

  /** Fills the "Important date" card from the enrollment dates the admin saved. */
  function updateDeadline() {
    var term = SERVER.term || {};
    var start = longDate(term.enrollStart), end = longDate(term.enrollEnd);
    var date = $('#deadline-date'), note = $('#deadline-note');
    if (!date || !note) return;
    date.textContent = end || 'To be announced';
    note.textContent = start && end ? 'Enrollment opens ' + start + ' and closes ' + end + '. Submit your proposed load early to allow time for adviser approval.'
      : start ? 'Enrollment opens ' + start + '. Submit your proposed load early to allow time for adviser approval.'
      : 'Submit your proposed load early to allow time for adviser approval.';
  }

  /** Shows the signed-in student's name and the real term once the server has answered. */
  function updateChrome() {
    updateDeadline();
    var av = $('.topbar .avatar'), nm = $('.topbar .user-name'), pr = $('.topbar .user-program');
    if (av) av.textContent = STUDENT.initials || '';
    if (nm) nm.textContent = STUDENT.fullName || '';
    if (pr) pr.textContent = STUDENT.program || '';
    var term = SERVER.term;
    if (term) {
      var foot = $('#term-foot');
      if (foot) foot.innerHTML = 'AY ' + esc(dashYears(term.academicYear)) + ' · ' + esc(term.semester) + ' Semester<br>Registrar’s Office';
      var sy = $('#sy'), sem = $('#sem');
      if (sy) sy.innerHTML = '<option>' + esc(dashYears(term.academicYear)) + '</option>';
      if (sem) sem.innerHTML = '<option>' + esc(semLabel(term.semester)) + '</option>';
    }
  }

  bindEvents();
  route();                     // shows the "Loading…" states straight away
  loadAll(function () {
    updateChrome();
    render();
  });
})();

// ======================================================================
// 5. Admin console
// ======================================================================
// CourseMap Admin Console: plain JavaScript, same approach as the student portal (app.js).
// Pages (#/, #/applications, #/students, #/requests, #/curriculum) are rendered in the browser.
// The student's own enrollment request is read live from the student's saved plan; the admin's
// Approve / Request changes buttons write the decision back so the student portal can show it.
(function () {
  'use strict';

  var CM = window.CM;
  if (!CM || !CM.requireRole('admin')) return;   // signed-out visitors and students are redirected

  var ADMIN = CM.ADMIN;

  // ---------- Server data (api/*.php, database system_enrollment) ----------
  var DATA = {
    loaded: false, error: null, term: null, counts: {},
    requests: [],        // enrollment requests that were submitted (admin_review.php)
    students: [],        // every student account (admin_students.php)
    programs: [], colleges: [], collegeId: 0, curriculumId: 0,   // curriculumId -1 = the chosen college has no program yet
    subjects: [],        // subjects of the chosen program (admin_subjects.php)
    sections: [],        // sections of the current term (admin_schedule.php)
    applications: [],    // admissions applicants (admin_applications.php)
    forms: [],           // overload / underload forms (admin_forms.php)
    registrations: []    // new sign-ups waiting for the checklist PDF check (admin_registrations.php)
  };

  var APP_STATUS = {
    review:   { label: 'For review',   pill: 'pill-butter' },
    pending:  { label: 'Pending docs', pill: 'pill-rose' },
    approved: { label: 'Approved',     pill: '' },
    rejected: { label: 'Rejected',     pill: 'pill-rose' }
  };

  var REQ_STATUS = {
    'Draft':      { label: 'Not submitted',  pill: 'pill-stone' },
    'For Review': { label: 'For review',     pill: 'pill-butter' },
    'Enrolled':   { label: 'Approved',       pill: '' },
    'Rejected':   { label: 'Rejected',       pill: 'pill-rose' }
  };

  var TONE_LIST = ['green', 'purple', 'orange', 'blue', 'yellow', 'red'];
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var YEAR_NAMES = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year', 6: '6th Year', 7: '7th Year', 8: '8th Year' };

  // ---------- Small helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ic(id) { return '<svg class="ic"><use href="#i-' + id + '"/></svg>'; }
  function initialsOf(name) {
    var p = String(name).trim().split(/\s+/);
    return ((p[0] || '')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function pill(map, key) {
    var m = map[key] || { label: key, pill: 'pill-stone' };
    return '<span class="pill ' + m.pill + '">' + esc(m.label) + '</span>';
  }
  function matches(q, parts) {
    q = q.toLowerCase().trim();
    if (!q) return true;
    return parts.join(' ').toLowerCase().indexOf(q) !== -1;
  }
  /** Search box shown on each admin page (Applications, Students, Enrollment Requests, Load Forms). */
  function pageSearch() {
    return '<label class="search page-search" aria-label="Search records">' + ic('search') +
      '<input id="page-search" type="search" value="' + esc(query) + '" placeholder="Search records..." autocomplete="off"></label>';
  }
  function header(eyebrow, title, lede, extra) {
    return '<div class="page-header"><div><span class="eyebrow">' + esc(eyebrow) + '</span><h1>' + esc(title) +
      '</h1><p>' + esc(lede) + '</p></div>' + (extra || '') + '</div>';
  }
  function clock(t) {
    var p = String(t).split(':'), h = parseInt(p[0], 10);
    return (h % 12 || 12) + ':' + (p[1] || '00') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function badgeOf(code) { var m = /^[A-Za-z]+/.exec(code); return m ? m[0].toUpperCase() : String(code).slice(0, 3).toUpperCase(); }
  function toneOf(code) {
    var b = badgeOf(code), h = 0;
    for (var i = 0; i < b.length; i++) h = (h * 31 + b.charCodeAt(i)) % 997;
    return TONE_LIST[h % TONE_LIST.length];
  }
  function semLabel(sem) { return sem === '1st' ? '1st Semester' : sem === '2nd' ? '2nd Semester' : String(sem || ''); }
  function dashYears(ay) { return String(ay || '').replace('-', '–'); }
  function digitsOf(id) { return String(id).replace(/[^A-Za-z0-9]/g, ''); }
  function formatDate(iso) {
    var d = iso ? new Date(String(iso).replace(' ', 'T')) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return m + ' ' + ('0' + d.getDate()).slice(-2) + ', ' + d.getFullYear();
  }

  var main, query = '', curriculumQuery = '', page = 'dashboard', lastFocus = null, toastTimer = null;

  function toast(msg) {
    var old = $('.toast'); if (old) old.parentNode.removeChild(old);
    var el = document.createElement('div');
    el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
  }

  // ---------- Loading ----------
  /** Everything the console shows, read from MySQL. Safe to call again after any change. */
  function loadAll(done) {
    var pending = 9, failed = null;
    function finish(res) {
      if (res && !res.ok && !failed) failed = res.error || 'Could not load the data.';
      if (--pending > 0) return;
      DATA.loaded = true;
      DATA.error = failed;
      if (done) done();
    }
    CM.apiAuth('admin_review?status=all', null, function (res) {
      if (res.ok) { DATA.counts = res.counts || {}; DATA.requests = res.requests.map(mapRequest); }
      finish(res);
    });
    CM.apiAuth('admin_students', null, function (res) { if (res.ok) DATA.students = res.students; finish(res); });
    CM.apiAuth('admin_schedule', null, function (res) { if (res.ok) DATA.sections = res.sections; finish(res); });
    CM.apiAuth('me', null, function (res) { if (res.ok) DATA.term = res.term; finish(res); });
    CM.api('programs', null, function (res) {
      if (res.ok) { DATA.programs = res.programs; DATA.colleges = res.colleges || []; }
      finish(res);
    });
    CM.apiAuth('admin_applications', null, function (res) { if (res.ok) DATA.applications = res.applications; finish(res); });
    CM.apiAuth('admin_forms', null, function (res) { if (res.ok) DATA.forms = res.forms; finish(res); });
    CM.apiAuth('admin_registrations', null, function (res) { if (res.ok) DATA.registrations = res.registrations; finish(res); });
    loadSubjects(DATA.curriculumId, finish);
  }

  function loadSubjects(curriculumId, done) {
    CM.apiAuth('admin_subjects' + (curriculumId ? '?curriculum_id=' + curriculumId : ''), null, function (res) {
      if (res.ok) { DATA.subjects = res.subjects; DATA.curriculumId = res.curriculumId; }
      if (done) done(res);
    });
  }

  function reload() { loadAll(render); }

  // ---------- Requests and applications built from the database rows ----------
  function mapRequest(r) {
    var d = r.details || { subjects: [], conflicts: [], missing_corequisites: [], history: [] };
    var name = (r.first_name + ' ' + r.last_name).trim();
    var last = d.history && d.history.length ? d.history[d.history.length - 1] : null;
    var codes = d.subjects.map(function (x) { return x.course_code; });
    return {
      id: 'ENR-' + digitsOf(r.student_number), enrollmentId: parseInt(r.enrollment_id, 10), studentId: r.student_number,
      name: name, initials: initialsOf(name), program: r.curriculum_name, year: r.year,
      title: (parseInt(r.academic_units, 10) || 0) + ' unit study load' + (parseInt(r.nstp_units, 10) ? ' + ' + r.nstp_units + ' NSTP' : ''),
      sub: codes.length ? codes.join(', ') : 'No subjects selected yet',
      details: d.subjects.map(function (x) {
        return { code: x.course_code, title: x.course_title, section: x.block_section, room: x.room_or_mode,
                 when: x.day_of_week + ' · ' + clock(x.start_time) + '–' + clock(x.end_time) };
      }),
      status: r.status, submittedAt: r.submitted_at, count: d.subjects.length,
      conflicts: d.conflicts.map(function (c) {
        return {
          subjectA: c.subject_a, subjectB: c.subject_b, day: c.day_of_week,
          aWhen: c.a_start + '–' + c.a_end, bWhen: c.b_start + '–' + c.b_end
        };
      }),
      conflict: d.conflicts.length > 0, coreq: d.missing_corequisites.length > 0,
      remarks: last && last.remarks ? last.remarks : ''
    };
  }

  function appStatusOf(requestStatus) { return requestStatus === 'Enrolled' ? 'approved' : requestStatus === 'Rejected' ? 'rejected' : 'review'; }

  /** Students' own applications (their submitted plans), newest first. */
  function liveApplications() {
    return DATA.requests.slice().sort(function (a, b) { return String(b.submittedAt).localeCompare(String(a.submittedAt)); })
      .map(function (r) {
        return { id: 'APP-' + digitsOf(r.studentId), name: r.name, program: r.program, date: formatDate(r.submittedAt),
                 status: appStatusOf(r.status), live: true, request: r };
      });
  }

  function allApplications() {
    var stored = DATA.applications.map(function (a) {
      return { id: a.code, dbId: a.id, name: a.name, program: a.program, date: formatDate(a.submittedAt), status: a.status };
    });
    return liveApplications().concat(stored);
  }

  function appStatus(a) { return a.status; }

  // ---------- Pages ----------
  function renderDashboard() {
    var apps = allApplications().map(function (a) { return { a: a, status: appStatus(a) }; });
    var awaiting = apps.filter(function (x) { return x.status === 'review'; }).length;
    var inReview = DATA.counts['For Review'] ? parseInt(DATA.counts['For Review'], 10) : 0;
    var programs = {};
    DATA.students.forEach(function (s) { programs[s.program] = true; });
    var nPrograms = Object.keys(programs).length;

    function stat(tone, icon, label, value, note) {
      return '<article class="card stat-card"><span class="stat-icon ' + tone + '">' + ic(icon) + '</span>' +
        '<div class="stat-body"><span class="stat-label">' + label + '</span><span class="stat-value">' + value +
        '</span><span class="stat-note">' + note + '</span></div></article>';
    }

    var rows = apps.slice(0, 4).map(function (x) {
      return '<li><span class="initials">' + esc(initialsOf(x.a.name)) + '</span>' +
        '<span class="who"><b>' + esc(x.a.name) + '</b><small>' + esc(x.a.id) + ' · ' + esc(x.a.program) + '</small></span>' +
        pill(APP_STATUS, x.status) + '</li>';
    }).join('') || '<li class="table-empty">No applications yet.</li>';

    var termText = DATA.term ? 'AY ' + dashYears(DATA.term.academicYear) + ' · ' + semLabel(DATA.term.semester) : '';

    return header('Admin overview', 'Admin Dashboard', 'Here’s what needs your attention across admissions and enrollment.') +
      '<section class="stats four" aria-label="Summary">' +
        stat('mint', 'file', 'Total applications', apps.length, liveApplications().length + ' from enrollment plans') +
        stat('peach', 'clock', 'Awaiting review', awaiting, awaiting ? 'Needs attention' : 'All caught up') +
        stat('sky', 'users', 'Active students', DATA.students.length, nPrograms === 1 ? 'In 1 program' : 'Across ' + nPrograms + ' programs') +
        stat('lilac', 'book', 'Enrollment requests', inReview, inReview ? 'Waiting for a decision' : 'Nothing waiting') +
      '</section>' +
      '<div class="dash-row">' +
        '<section class="card panel"><div class="panel-head"><div><span class="eyebrow-sm">Admissions queue</span>' +
          '<h2>Recent applications</h2></div><a class="panel-link" href="#/applications">View all →</a></div>' +
          '<ul class="app-list">' + rows + '</ul></section>' +
        '<div class="side-stack">' +
          '<article class="deadline"><span class="label">Current term</span><span class="date">' + esc(DATA.term ? dashYears(DATA.term.academicYear) : '') + '</span>' +
            '<strong>' + esc(termText) + '</strong><p>Students are choosing their study loads. Review the requests waiting for approval.</p></article>' +
          '<section class="card panel"><span class="eyebrow-sm">Quick actions</span><div class="panel-head"><h2>Manage records</h2></div>' +
            '<div class="action-list">' +
              '<a class="action-link" href="#/applications">' + ic('file') + 'Review applications<span class="push">' + ic('chev') + '</span></a>' +
              '<a class="action-link" href="#/requests">' + ic('book') + 'Enrollment approvals<span class="push">' + ic('chev') + '</span></a>' +
              '<a class="action-link" href="#/curriculum">' + ic('calendar') + 'Update curriculum<span class="push">' + ic('chev') + '</span></a>' +
            '</div></section>' +
        '</div>' +
      '</div>';
  }

  var appFilter = 'all';

  function filteredApps() {
    return allApplications().map(function (a) { return { a: a, status: appStatus(a) }; }).filter(function (x) {
      return (appFilter === 'all' || x.status === appFilter) &&
        matches(query, [x.a.name, x.a.id, x.a.program]);
    });
  }

  function renderApplications() {
    var chips = [['all', 'All'], ['review', 'For review'], ['pending', 'Pending docs'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(function (c) {
      return '<button type="button" class="chip' + (appFilter === c[0] ? ' is-active' : '') + '" data-filter="' + c[0] + '">' + c[1] + '</button>';
    }).join('');

    var rows = filteredApps().map(function (x) {
      return '<tr><td><div class="cell-person"><span class="initials">' + esc(initialsOf(x.a.name)) + '</span>' +
        '<span class="who"><b>' + esc(x.a.name) + '</b><small>' + esc(x.a.id) + '</small></span></div></td>' +
        '<td>' + esc(x.a.program) + '</td><td>' + esc(x.a.date) + '</td><td>' + pill(APP_STATUS, x.status) + '</td>' +
        '<td><button type="button" class="row-link" data-review="' + esc(x.a.id) + '">Review →</button></td></tr>';
    }).join('') || '<tr><td colspan="5"><div class="table-empty">No applications match your filter.</div></td></tr>';

    return header('Admissions', 'Applications', 'Review incoming applications, documents, and admission decisions.') +
      '<div class="toolbar"><div class="chips" role="group" aria-label="Filter by status">' + chips + '</div>' +
      '<span class="toolbar-actions">' + pageSearch() + '<button type="button" class="btn-outline" data-export>Export CSV</button> ' +
      '<button type="button" class="btn-dark" data-add-application>+ New application</button></span></div>' +
      '<div class="card table-card"><table class="data-table"><thead><tr><th>APPLICANT</th><th>PROGRAM</th>' +
      '<th>SUBMITTED</th><th>STATUS</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function studentRows() {
    return DATA.students.filter(function (s) { return matches(query, [s.name, s.id, s.program]); });
  }

  function renderStudents() {
    var rows = studentRows().map(function (s) {
      return '<tr><td><div class="cell-person"><span class="initials">' + esc(s.initials || initialsOf(s.name)) + '</span>' +
        '<span class="who"><b>' + esc(s.name) + '</b><small>' + esc(s.id) + '</small></span></div></td>' +
        '<td>' + esc(s.program) + '</td><td>' + esc(s.year) + '</td>' +
        '<td>' + (s.accountStatus === 'Active' ? '<span class="pill ' + (s.standing === 'Regular' ? '' : 'pill-rose') + '">' + esc(s.standing) + '</span>'
          : '<span class="pill pill-stone">Suspended</span>') + '</td>' +
        '<td><button type="button" class="row-link" data-student-view="' + esc(s.id) + '">View →</button></td></tr>';
    }).join('') || '<tr><td colspan="5"><div class="table-empty">' +
      (DATA.students.length ? 'No students match your search.' : 'No student accounts yet. Students can create one from the sign-in page.') + '</div></td></tr>';

    return header('Student records', 'Student directory', 'Find students and review their current academic standing.', pageSearch()) +
      '<div class="card table-card"><table class="data-table"><thead><tr><th>STUDENT</th><th>PROGRAM</th>' +
      '<th>YEAR LEVEL</th><th>STANDING</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderRequests() {
    var list = DATA.requests.filter(function (r) {
      return matches(query, [r.name, r.id, r.studentId, r.title, r.year]);
    }).sort(function (a, b) {
      var rank = { 'For Review': 0, 'Enrolled': 1, 'Rejected': 2 };
      return (rank[a.status] - rank[b.status]) || String(a.submittedAt).localeCompare(String(b.submittedAt));
    });

    var cards = list.map(function (r) {
      var bad = r.conflict || r.coreq;
      var overlapHtml = r.conflict
        ? '<div class="review-overlaps"><b>Overlapping subjects</b>' +
          r.conflicts.map(function (c) {
            return '<span class="bad">✕ ' + esc(c.subjectA) + ' (' + esc(c.aWhen) + ') overlaps ' +
              esc(c.subjectB) + ' (' + esc(c.bWhen) + ') on ' + esc(c.day) + '</span>';
          }).join('') + '</div>'
        : '';
      var checks = (r.conflict ? '<span class="bad">✕ Schedule conflict found</span>' : '<span>✓ No schedule conflicts</span>') +
        (r.coreq ? '<span class="bad">✕ A lecture or lab pair is incomplete</span>' : '<span>✓ Prerequisites and pairs complete</span>');
      var off = r.status === 'For Review' ? '' : ' disabled title="This request has already been decided"';
      return '<article class="card req-card" data-req="' + esc(r.id) + '">' +
        '<div class="req-top"><span class="initials">' + esc(r.initials) + '</span>' +
          '<span class="who"><b>' + esc(r.name) + '</b><small>' + esc(r.id) + ' · ' + esc(r.year) + '</small></span>' + pill(REQ_STATUS, r.status) + '</div>' +
        '<h2>' + esc(r.title) + '</h2><p class="req-sub">' + esc(r.sub) + '</p>' +
        (r.details.length ? '<ul class="req-detail">' + r.details.map(function (x) {
          return '<li><b>' + esc(x.code) + '</b> ' + esc(x.title) + '<small>' + esc(x.section) + ' · ' + esc(x.room) + ' · ' + esc(x.when) + '</small></li>';
        }).join('') + '</ul>' : '') +
        (r.remarks && r.status !== 'For Review' ? '<p class="req-sub">Remarks: ' + esc(r.remarks) + '</p>' : '') +
        overlapHtml +
        '<div class="req-checks' + (bad ? ' is-bad' : '') + '">' + checks + '</div>' +
        '<div class="req-actions"><button type="button" class="btn-ghost" data-return="' + r.enrollmentId + '"' + off + '>Request changes</button>' +
        '<button type="button" class="btn-solid" data-approve="' + r.enrollmentId + '"' + off + '>Approve</button></div>' +
      '</article>';
    }).join('') || '<p class="card empty">' + (DATA.requests.length ? 'No enrollment requests match your search.'
      : 'No enrollment requests have been submitted yet. They appear here as soon as a student submits a plan.') + '</p>';

    return header('Enrollment', 'Approval requests', 'Review proposed study loads and adviser checks.', pageSearch()) +
      '<section class="req-grid" aria-label="Enrollment requests">' + cards + '</section>';
  }

  var FORM_STATUS = {
    'Pending':  { label: 'Pending',  pill: 'pill-butter' },
    'Approved': { label: 'Approved', pill: '' },
    'Rejected': { label: 'Rejected', pill: 'pill-rose' }
  };

  function renderForms() {
    var rows = DATA.forms.filter(function (f) { return matches(query, [f.student_name, f.student_number, f.form_type]); }).map(function (f) {
      var open = f.status === 'Pending';
      return '<tr><td><div class="cell-person"><span class="initials">' + esc(initialsOf(f.student_name)) + '</span>' +
        '<span class="who"><b>' + esc(f.student_name) + '</b><small>' + esc(f.student_number) + ' · ' + esc(f.year) + '</small></span></div></td>' +
        '<td>' + esc(f.form_type) + '<small style="display:block" class="muted">' + esc(f.academic_units) + ' units in plan</small></td>' +
        '<td><a class="row-link" href="api/admin_forms.php?download=' + f.form_id + '" target="_blank" rel="noopener">' + esc(f.file_name) + ' →</a></td>' +
        '<td>' + esc(formatDate(f.uploaded_at)) + '</td>' +
        '<td>' + pill(FORM_STATUS, f.status) + (f.remarks && !open ? '<small style="display:block" class="muted">' + esc(f.remarks) + '</small>' : '') + '</td>' +
        '<td style="text-align:right">' + (open
          ? '<button type="button" class="btn-solid" data-form-decide="Approved" data-id="' + f.form_id + '">Approve</button> ' +
            '<button type="button" class="btn-ghost" data-form-decide="Rejected" data-id="' + f.form_id + '">Reject</button>'
          : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="6"><div class="table-empty">' + (DATA.forms.length ? 'No forms match your search.'
      : 'No overload or underload forms yet. They appear here when a student uploads one.') + '</div></td></tr>';

    return header('Enrollment', 'Load forms', 'Approve or reject overload and underload forms. A student can’t submit a plan while a form is pending.', pageSearch()) +
      '<div class="card table-card"><table class="data-table"><thead><tr><th>STUDENT</th><th>FORM</th><th>FILE (PDF)</th>' +
      '<th>UPLOADED</th><th>STATUS</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  var REG_STATUS = {
    'Pending':  { label: 'To check', pill: 'pill-butter' },
    'Approved': { label: 'Approved', pill: '' },
    'Rejected': { label: 'Rejected', pill: 'pill-rose' }
  };

  function renderRegistrations() {
    var rows = DATA.registrations.filter(function (r) { return matches(query, [r.name, r.studentId, r.program]); }).map(function (r) {
      var open = r.status === 'Pending';
      return '<tr><td><div class="cell-person"><span class="initials">' + esc(initialsOf(r.name)) + '</span>' +
        '<span class="who"><b>' + esc(r.name) + '</b><small>' + esc(r.studentId) + ' · ' + esc(r.year) + ' · ' + esc(r.regStatus) + '</small></span></div></td>' +
        '<td>' + esc(r.program) + '<small style="display:block" class="muted">' + (r.year === '1st Year' ? 'No grades submitted yet' : r.grades.length + ' grades read from PDF') + '</small></td>' +
        '<td>' + (r.fileName ? '<a class="row-link" href="api/admin_registrations.php?download=' + r.id + '" target="_blank" rel="noopener">' + esc(r.fileName) + ' →</a>' : '<span class="muted">Not required</span>') + '</td>' +
        '<td>' + esc(formatDate(r.submittedAt)) + '</td>' +
        '<td>' + pill(REG_STATUS, r.status) + (r.remarks && r.status === 'Rejected' ? '<small style="display:block" class="muted">' + esc(r.remarks) + '</small>' : '') + '</td>' +
        '<td style="text-align:right">' + (open ? '<button type="button" class="btn-solid" data-reg-review="' + r.id + '">Review</button>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="6"><div class="table-empty">' + (DATA.registrations.length ? 'No registrations match your search.'
      : 'No sign-ups yet. They appear here when a student creates an account.') + '</div></td></tr>';

    return header('Accounts', 'Registrations', 'Review each registration and approve the account. First-year students do not need to submit a curriculum checklist.', pageSearch()) +
      '<div class="card table-card"><table class="data-table"><thead><tr><th>STUDENT</th><th>PROGRAM</th><th>CHECKLIST (PDF)</th>' +
      '<th>SUBMITTED</th><th>STATUS</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /** The sign-up with the PDF link and the grades read from it, so they can be compared before approving. */
  function registrationModal(id) {
    var r = DATA.registrations.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var grades = r.grades.map(function (g) {
      return '<li><b>' + esc(g.code) + '</b> ' + esc(g.title) + '<small>Grade ' + esc(g.grade) + '</small></li>';
    }).join('');
    openModal('<span class="eyebrow-sm">Registration · ' + esc(r.studentId) + '</span><h2 id="modal-title">' + esc(r.name) + '</h2>' +
      '<dl class="detail"><dt>Program</dt><dd>' + esc(r.program) + '</dd><dt>Year level</dt><dd>' + esc(r.year) + ' · ' + esc(r.regStatus) + '</dd>' +
      '<dt>Submitted</dt><dd>' + esc(formatDate(r.submittedAt)) + '</dd>' +
      '<dt>Checklist</dt><dd>' + (r.fileName ? '<a class="row-link" href="api/admin_registrations.php?download=' + r.id + '" target="_blank" rel="noopener">Open ' + esc(r.fileName) + ' →</a>' : 'Not required for 1st Year students') + '</dd></dl>' +
      '<h3 style="margin:1.2rem 0 .5rem">' + (r.year === '1st Year' ? 'Grades' : 'Grades read from the PDF') + ' (' + r.grades.length + ')</h3>' +
      '<p class="req-sub">' + (r.year === '1st Year' ? 'No grades are expected yet. Approve to create the student account.' : 'Compare these with the PDF. They become the student’s grades when you approve.') + '</p>' +
      '<div style="max-height:14rem;overflow:auto"><ul class="req-detail">' + (grades || '<li><small>No grades.</small></li>') + '</ul></div>' +
      '<div class="modal-field" style="margin-top:1rem"><label for="remarks">Remarks for the student (needed to reject)</label>' +
      '<textarea id="remarks" rows="3" maxlength="500" placeholder="Why is the registration rejected?" style="padding:.8rem 1rem;border:1px solid var(--line);border-radius:.8rem;font:inherit;resize:vertical"></textarea></div>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-solid" data-reg-approve="' + r.id + '">Approve and create account</button>' +
        '<button type="button" class="btn-ghost" data-reg-reject="' + r.id + '">Reject</button></div>');
  }

  function decideRegistration(id, decision, remarks) {
    CM.apiAuth('admin_registrations', { registrationId: id, decision: decision, remarks: remarks }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not save the decision.'); return; }
      closeModal();
      toast(decision === 'Approved' ? 'Account created. The student can sign in now.' : 'Registration rejected.');
      reload();
    });
  }

  function rejectFormModal(formId) {
    openModal('<span class="eyebrow-sm">Load form</span><h2 id="modal-title">Reject this form</h2>' +
      '<div class="modal-field"><label for="remarks">Remarks for the student</label>' +
      '<textarea id="remarks" rows="4" maxlength="500" placeholder="Why is the form rejected?" style="padding:.8rem 1rem;border:1px solid var(--line);border-radius:.8rem;font:inherit;resize:vertical"></textarea></div>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem"><button type="button" class="btn-solid" data-form-reject-confirm="' + formId + '">Reject form</button></div>');
  }

  function decideForm(formId, decision, remarks) {
    CM.apiAuth('admin_forms', { formId: formId, decision: decision, remarks: remarks }, function (res) {
      if (!res.ok) { if ($('#modal-err')) showModalError(res.error || 'Could not save the decision.'); else toast(res.error || 'Could not save the decision.'); return; }
      closeModal(); toast('Form ' + decision.toLowerCase() + '.'); reload();
    });
  }

  function sectionsOf(subjectId) {
    return DATA.sections.filter(function (r) { return String(r.subject_id) === String(subjectId) && String(r.is_active) !== '0'; });
  }

  // ---------- Colleges and programs ----------
  function programsOfCollege(collegeId) {
    return DATA.programs.filter(function (p) { return parseInt(p.college_id, 10) === collegeId; });
  }

  /** The college shown on the Curriculum page: the one the admin picked, else the college of the open program. */
  function currentCollegeId() {
    var ids = DATA.colleges.map(function (c) { return parseInt(c.college_id, 10); });
    if (DATA.collegeId && ids.indexOf(DATA.collegeId) !== -1) return DATA.collegeId;
    var p = DATA.programs.filter(function (x) { return String(x.curriculum_id) === String(DATA.curriculumId); })[0];
    return p ? parseInt(p.college_id, 10) : (ids[0] || 0);
  }

  function collegeOptionsHtml(selected) {
    return DATA.colleges.map(function (c) {
      return '<option value="' + c.college_id + '"' + (parseInt(c.college_id, 10) === selected ? ' selected' : '') + '>' +
        esc(c.college_code + ' · ' + c.college_name) + '</option>';
    }).join('');
  }

  function renderCurriculum() {
    var term = DATA.term ? dashYears(DATA.term.academicYear) : '';
    var cq = String(curriculumQuery || '').trim().toLowerCase();
    var curriculumSubjects = DATA.subjects.filter(function (s) {
      if (!cq) return true;
      return [s.code, s.title, s.units, s.year, s.semester, (s.prereqs || []).join(' ')]
        .join(' ').toLowerCase().indexOf(cq) !== -1;
    });
    var rows = curriculumSubjects.map(function (s) {
      var secs = sectionsOf(s.subjectId), first = secs[0];
      var when = first ? first.block_section + ' · ' + first.day_of_week + ' · ' + clock(first.start_time) + '–' + clock(first.end_time) +
        (secs.length > 1 ? '  (+' + (secs.length - 1) + ' more)' : '') : 'No sections yet';
      var status = !s.active ? '<button type="button" class="pill pill-stone" data-toggle-subject="' + s.subjectId + '" data-active="1" title="Click to activate">Inactive</button>'
        : !first ? '<button type="button" class="pill pill-butter" data-toggle-subject="' + s.subjectId + '" data-active="0" title="Click to deactivate">Coming soon</button>'
        : '<button type="button" class="pill" data-toggle-subject="' + s.subjectId + '" data-active="0" title="Click to deactivate">Active</button>';
      var where = s.year ? (YEAR_NAMES[s.year] || 'Year ' + s.year) + ' · ' + semLabel(s.semester) + ' · ' : '';
      return '<tr><td><div class="sub-cell"><span class="code-pill tone-' + toneOf(s.code) + '">' + esc(s.code) + '</span>' +
        '<span class="who"><b>' + esc(s.title) + '</b><small>' + esc(where + s.units + ' unit' + (s.units === 1 ? '' : 's') + (s.isLaboratory ? ' · Laboratory' : '') + (!s.isAcademic ? ' · NSTP' : '')) + '</small></span></div></td>' +
        '<td class="muted">' + esc(s.prereqs.length ? s.prereqs.join(', ') : 'None') + '</td>' +
        '<td class="muted">' + esc(when) + '</td>' +
        '<td style="text-align:right"><button type="button" class="row-link" data-manage-sections="' + s.subjectId + '" style="margin-right:.6rem">Manage</button>' + status + ' <button type="button" class="row-link" data-delete-subject="' + s.subjectId + '" style="color:#b3261e">Delete</button></td></tr>';
    }).join('') || '<tr><td colspan="4"><div class="table-empty">' +
      (DATA.subjects.length ? 'No subjects match your search.' : !DATA.programs.filter(function (p) { return String(p.curriculum_id) === String(DATA.curriculumId); }).length ? 'This college has no programs yet. Use “Add program” to create the first one.' : 'This program has no subjects yet. Use “Add subject” to create the first one.') +
      '</div></td></tr>';

    var missing = DATA.subjects.filter(function (s) { return s.active && !sectionsOf(s.subjectId).length; }).length;

    // college -> program: a college can have two or more programs, so the admin picks the college first
    var collegeId = DATA.collegeId = currentCollegeId();
    var collegePrograms = programsOfCollege(collegeId);
    var curProg = collegePrograms.filter(function (p) { return String(p.curriculum_id) === String(DATA.curriculumId); })[0];
    var hasCollege = DATA.colleges.length > 0;
    var n = DATA.subjects.length;

    var collegeSel = '<select id="college-pick" aria-label="College"' + (hasCollege ? '' : ' disabled') + '>' +
      (hasCollege ? collegeOptionsHtml(collegeId) : '<option value="">No colleges yet</option>') + '</select>';
    var programSel = '<select id="program-pick" aria-label="Program"' + (collegePrograms.length ? '' : ' disabled') + '>' + (collegePrograms.length ? collegePrograms.map(function (p) {
        return '<option value="' + p.curriculum_id + '"' + (String(p.curriculum_id) === String(DATA.curriculumId) ? ' selected' : '') + '>' + esc(p.curriculum_name) + '</option>';
      }).join('') : '<option value="">No programs yet</option>') + '</select>';

    var card = '<section class="card cur-card" aria-label="Current curriculum">' +
      '<span class="eyebrow-sm">Current curriculum</span>' +
      '<h2 class="cur-title">' + esc(curProg ? curProg.curriculum_name : (hasCollege ? 'No program yet' : 'No college yet')) + '</h2>' +
      '<p class="cur-sub"><span class="cur-dot' + (curProg ? '' : ' off') + '"></span>' +
        (curProg ? 'Active program · ' + n + ' subject' + (n === 1 ? '' : 's') : hasCollege ? 'This college has no programs yet. Use “Add program” to create one.' : 'Add a college to get started.') + '</p>' +
      '<div class="cur-pickers">' +
        '<div class="cur-pick"><label for="college-pick">College</label><div class="pick-row">' + collegeSel +
          (hasCollege ? '<button type="button" class="btn-outline" data-manage-college>' + ic('edit') + 'Manage college</button>'
                      : '<button type="button" class="btn-outline" data-add-college>' + ic('plus') + 'Add college</button>') + '</div></div>' +
        '<div class="cur-pick"><label for="program-pick">Program</label><div class="pick-row">' + programSel +
          '<button type="button" class="btn-outline" data-manage-program="' + (curProg ? curProg.curriculum_id : '') + '"' + (curProg ? '' : ' disabled') + '>' + ic('edit') + 'Manage program</button></div></div>' +
      '</div></section>';

    return header('Academic setup', 'Curriculum', 'Manage subjects, prerequisites, and active course offerings.') + card +
      '<div class="cur-meta cur-toolbar">' +
      '<label class="search curriculum-search" aria-label="Search curriculum">' + ic('search') +
        '<input id="curriculum-search" type="search" value="' + esc(curriculumQuery) + '" placeholder="Search by subject or code..." autocomplete="off"></label>' +
      '<span style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap">' +
      (missing ? '<button type="button" class="btn-outline" data-generate-sections>Add schedules to ' + missing + ' “Coming soon” subject' + (missing === 1 ? '' : 's') + '</button>' : '') +
      '<button type="button" class="btn-outline" data-add-program' + (hasCollege ? '' : ' disabled') + '>' + ic('plus') + 'Add program</button>' +
      '<button type="button" class="btn-dark" data-add-subject' + (curProg ? '' : ' disabled') + '>' + ic('plus') + 'Add subject</button></span></div>' +
      '<div class="card table-card"><table class="data-table"><thead><tr><th>SUBJECT</th><th>PREREQUISITE</th>' +
      '<th>SCHEDULE</th><th style="text-align:right">STATUS</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ---------- Modal ----------
  function openModal(html) {
    closeModal(true);
    lastFocus = document.activeElement;
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-scrim" data-modal-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<button type="button" class="btn-close" data-modal-close aria-label="Close">' + ic('x') + '</button>' + html + '</div></div>';
    var first = $('input, textarea, .modal-actions button, .modal-submit', root);
    if (first) first.focus(); else $('.btn-close', root).focus();
  }

  function closeModal(silent) {
    var root = $('#modal-root');
    if (!root || !root.firstChild) return;
    root.innerHTML = '';
    if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function showModalError(text) {
    var box = $('#modal-err');
    if (box) { box.textContent = text; box.hidden = false; }
  }

  function reviewModal(id) {
    var a = allApplications().filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var status = appStatus(a);
    var base = '<span class="eyebrow-sm">Application ' + esc(a.id) + '</span><h2 id="modal-title">' + esc(a.name) + '</h2>' +
      '<dl class="detail"><dt>Program</dt><dd>' + esc(a.program) + '</dd><dt>Submitted</dt><dd>' + esc(a.date) + '</dd>' +
      '<dt>Status</dt><dd>' + esc(APP_STATUS[status].label) + '</dd>';
    if (a.live) {
      var r = a.request;
      openModal(base + '<dt>Study load</dt><dd>' + esc(r.title) + '</dd><dt>Subjects</dt><dd>' + esc(r.sub) + '</dd>' +
        (r.remarks ? '<dt>Remarks</dt><dd>' + esc(r.remarks) + '</dd>' : '') + '</dl>' +
        '<div class="modal-actions"><button type="button" class="btn-solid" data-goto-requests>Open in Enrollment Requests</button>' +
        '<button type="button" class="btn-ghost" data-delete-app="' + esc(a.id) + '" style="color:#b3261e">Delete application</button></div>');
      return;
    }
    openModal(base + '</dl>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn-solid" data-set-app="approved" data-id="' + a.dbId + '">Approve application</button>' +
        '<button type="button" class="btn-ghost" data-set-app="pending" data-id="' + a.dbId + '">Request missing documents</button>' +
        '<button type="button" class="btn-ghost" data-set-app="review" data-id="' + a.dbId + '">Mark for review</button>' +
        '<button type="button" class="btn-ghost" data-set-app="rejected" data-id="' + a.dbId + '">Reject application</button>' +
        '<button type="button" class="btn-ghost" data-edit-app="' + a.dbId + '">Edit details</button>' +
        '<button type="button" class="btn-ghost" data-delete-app="' + esc(a.id) + '" style="color:#b3261e">Delete application</button>' +
      '</div>');
  }

  function programOptionsHtml() {
    return DATA.programs.map(function (p) { return '<option value="' + esc(p.curriculum_name) + '">'; }).join('') +
      ['BS Computer Science', 'BS Information Systems'].map(function (n) { return '<option value="' + n + '">'; }).join('');
  }

  function editApplicationModal(dbId) {
    var a = allApplications().filter(function (x) { return String(x.dbId) === String(dbId); })[0];
    if (!a) return;
    openModal('<span class="eyebrow-sm">Application ' + esc(a.id) + '</span><h2 id="modal-title">Edit application</h2>' +
      '<form id="app-edit-form" data-id="' + esc(a.dbId) + '" novalidate>' +
        '<div class="modal-field"><label for="app-name">Applicant name</label><input id="app-name" type="text" maxlength="120" value="' + esc(a.name) + '" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="app-program">Program</label>' +
          '<input id="app-program" type="text" maxlength="150" list="app-programs" value="' + esc(a.program) + '" autocomplete="off"><datalist id="app-programs">' + programOptionsHtml() + '</datalist></div>' +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Save changes</button>' +
      '</form>');
  }

  function deleteApplicationModal(id) {
    var a = allApplications().filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var attr = a.live ? 'data-delete-app-confirm-live="' + esc(a.request.enrollmentId) + '"' : 'data-delete-app-confirm="' + esc(a.dbId) + '"';
    openModal('<span class="eyebrow-sm">Admissions</span><h2 id="modal-title">Delete ' + esc(a.id) + '?</h2>' +
      '<p class="req-sub">' + esc(a.name) + '’s application will be removed.' +
      (a.live ? ' This is a student’s enrollment request, so their plan, forms and held seats are deleted too. The student account stays.' : '') +
      ' This cannot be undone.</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" ' + attr + ' style="background:#b3261e">Delete application</button>' +
      '</div>');
  }

  function changeTermModal() {
    openModal('<span class="eyebrow-sm">Enrollment term</span><h2 id="modal-title">Change term</h2>' +
      '<p class="req-sub">Students plan and enroll for this term. The schedule, sections and enrollment requests follow it. The enrollment dates show on the student dashboard.</p>' +
      '<div id="term-box"><p class="req-sub">Loading…</p></div>');
    CM.apiAuth('admin_term', null, function (res) {
      var box = $('#term-box');
      if (!box) return;
      if (!res.ok) { box.innerHTML = '<p class="modal-error" role="alert">' + esc(res.error || 'Could not load the term.') + '</p>'; return; }
      var names = { '1st': '1st Semester', '2nd': '2nd Semester', 'Summer': 'Summer' };
      box.innerHTML = '<form id="term-form" novalidate>' +
        '<div class="modal-field"><label for="term-ay">School year</label>' +
          '<input id="term-ay" type="text" list="term-years" maxlength="9" autocomplete="off" placeholder="Type or pick, e.g. 2030-2031" value="' + esc(res.term.academicYear) + '">' +
          '<datalist id="term-years">' + res.years.map(function (y) { return '<option value="' + y + '"></option>'; }).join('') + '</datalist></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="term-sem">Semester</label><select id="term-sem">' +
          res.semesters.map(function (m) { return '<option value="' + m + '"' + (m === res.term.semester ? ' selected' : '') + '>' + names[m] + '</option>'; }).join('') + '</select></div>' +
        '<div class="field-row" style="margin-top:1rem">' +
          '<div class="modal-field"><label for="term-start">Enrollment starts</label><input id="term-start" type="date" value="' + esc(res.term.enrollStart || '') + '"></div>' +
          '<div class="modal-field"><label for="term-end">Enrollment ends</label><input id="term-end" type="date" value="' + esc(res.term.enrollEnd || '') + '"></div>' +
        '</div>' +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Save term</button></form>';
    });
  }

  function studentModal(id) {
    var s = DATA.students.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var plan = s.enrollmentStatus
      ? '<dt>Enrollment</dt><dd>' + esc((REQ_STATUS[s.enrollmentStatus] || {}).label || s.enrollmentStatus) + '</dd>' +
        '<dt>Current plan</dt><dd>' + s.academicUnits + ' academic units · ' + s.subjectCount + ' subject' + (s.subjectCount === 1 ? '' : 's') + '</dd>'
      : '<dt>Enrollment</dt><dd>No plan started yet</dd>';
    openModal('<span class="eyebrow-sm">Student record</span><h2 id="modal-title">' + esc(s.name) + '</h2>' +
      '<dl class="detail"><dt>Student ID</dt><dd>' + esc(s.id) + '</dd><dt>Program</dt><dd>' + esc(s.program) + '</dd>' +
      '<dt>Year level</dt><dd>' + esc(s.year) + '</dd><dt>Standing</dt><dd>' + esc(s.standing) + '</dd>' +
      '<dt>Account</dt><dd>' + (s.accountStatus === 'Active' ? 'Active' : 'Suspended') + '</dd>' + plan + '</dl>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        (s.accountStatus === 'Active'
          ? '<button type="button" class="btn-ghost" data-student-action="suspend" data-id="' + esc(s.id) + '">Suspend account</button>'
          : '<button type="button" class="btn-solid" data-student-action="activate" data-id="' + esc(s.id) + '">Reactivate account</button>') +
        '<button type="button" class="btn-ghost" data-shift-open="' + esc(s.id) + '">Shift program</button>' +
        '<button type="button" class="btn-ghost" data-student-delete="' + esc(s.id) + '" style="color:#b3261e">Delete student</button>' +
      '</div>' +
      '<div id="grades-box" data-student="' + esc(s.id) + '"><p class="req-sub">Loading grades…</p></div>');
    loadGrades(s.id);
  }

  function deleteStudentModal(id) {
    var s = DATA.students.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    openModal('<span class="eyebrow-sm">Delete student</span><h2 id="modal-title">Delete ' + esc(s.name) + '?</h2>' +
      '<p class="req-sub">This permanently removes the account, grades, study plan and uploaded forms of ' + esc(s.id) +
      ' and frees the section slots they hold. It cannot be undone. To block sign-in but keep the records, suspend the account instead.</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-student-delete-confirm="' + esc(s.id) + '" style="background:#b3261e">Delete permanently</button>' +
      '</div>');
  }

  // ---------- Programs and colleges (admin_programs.php, admin_colleges.php) ----------
  function programFieldsHtml(p) {
    p = p || {};
    return '<div class="modal-field" style="margin-top:1rem"><label for="prog-college">College</label>' +
        '<select id="prog-college">' + collegeOptionsHtml(p.college_id ? parseInt(p.college_id, 10) : currentCollegeId()) + '</select></div>' +
      '<div class="modal-field" style="margin-top:1rem"><label for="prog-name">Program name</label>' +
        '<input id="prog-name" type="text" maxlength="150" autocomplete="off" placeholder="e.g. Bachelor of Science in Computer Science" value="' + esc(p.curriculum_name || '') + '"></div>' +
      '<div class="field-row" style="margin-top:1rem">' +
        '<div class="modal-field"><label for="prog-code">Code</label><input id="prog-code" type="text" maxlength="20" autocomplete="off" placeholder="e.g. BSCS" value="' + esc(p.course_code || '') + '"></div>' +
        '<div class="modal-field"><label for="prog-year">Effective year (optional)</label><input id="prog-year" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="e.g. 2024" value="' + esc(p.effective_year || '') + '"></div>' +
      '</div>';
  }

  function addProgramModal() {
    openModal('<span class="eyebrow-sm">Academic setup</span><h2 id="modal-title">Add program</h2>' +
      '<p class="req-sub">Creates an empty program in the college you pick. After saving you’ll be taken to it so you can add its subjects.</p>' +
      programFieldsHtml() +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-add-program-confirm>Add program</button></div>');
  }

  function programBody() {
    return { name: $('#prog-name').value, code: $('#prog-code').value, effectiveYear: $('#prog-year').value.trim(),
             collegeId: parseInt($('#prog-college').value, 10) || 0 };
  }

  function addProgramConfirm() {
    var body = programBody(); body.action = 'add';
    CM.apiAuth('admin_programs', body, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not add the program.'); return; }
      closeModal();
      DATA.collegeId = res.collegeId;
      DATA.curriculumId = res.curriculumId;        // switch to the new program right away
      toast(res.name + ' added.');
      reload();
    });
  }

  /** The red "Delete this ..." strip at the bottom of the Manage modals. */
  function dangerZoneHtml(title, note, attr, id, label) {
    return '<div class="danger-zone"><div><b>' + esc(title) + '</b><small>' + esc(note) + '</small></div>' +
      '<button type="button" class="btn-danger-outline" ' + attr + '="' + id + '">' + ic('trash') + esc(label) + '</button></div>';
  }

  function editProgramModal(id) {
    var p = DATA.programs.filter(function (x) { return String(x.curriculum_id) === String(id); })[0];
    if (!p) return;
    openModal('<span class="modal-icon">' + ic('edit') + '</span><span class="eyebrow-sm eyebrow-line">Academic setup</span><h2 id="modal-title">Manage program</h2>' +
      '<p class="req-sub">Update this program’s details or remove it from the selected college.</p>' +
      programFieldsHtml(p) +
      '<div id="unit-limits" style="margin-top:1.25rem"><p class="req-sub">Loading unit limits…</p></div>' +
      dangerZoneHtml('Delete this program', 'This will remove its subjects, study plan, and year-level setup.', 'data-delete-program', p.curriculum_id, 'Delete program') +
      '<p class="modal-error" id="modal-err" role="alert" hidden></p>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-edit-program-confirm="' + p.curriculum_id + '">' + ic('check') + 'Save changes</button></div>');
    loadUnitLimits(p.curriculum_id);
  }

  /** The "Most units per term" boxes of a program: empty means the study plan total of that term. */
  function loadUnitLimits(id) {
    CM.apiAuth('admin_unit_limits?curriculumId=' + id, null, function (res) {
      var box = $('#unit-limits');
      if (!box) return;
      if (!res.ok || !res.terms.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<b>Most units a student can enroll per term</b>' +
        '<p class="req-sub">Leave a box empty to use the total of that term in the study plan (shown in the box).</p>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem">' +
        res.terms.map(function (t) {
          return '<div class="modal-field"><label>' + esc(['', '1st', '2nd', '3rd', '4th'][t.year] + ' year · ' + t.semester + ' sem') + '</label>' +
            '<input class="unit-limit" type="text" inputmode="numeric" maxlength="2" autocomplete="off" data-year="' + t.year + '" data-sem="' + t.semester + '"' +
            ' placeholder="' + t.planUnits + '" value="' + (t.maxUnits === null ? '' : t.maxUnits) + '"></div>';
        }).join('') + '</div>';
    });
  }

  function editProgramConfirm(id) {
    var body = programBody(); body.action = 'update'; body.curriculumId = id;
    var limits = [];
    document.querySelectorAll('.unit-limit').forEach(function (box) {
      limits.push({ year: box.getAttribute('data-year'), semester: box.getAttribute('data-sem'), maxUnits: box.value });
    });

    function finish(res) {
      closeModal();
      DATA.collegeId = res.collegeId;              // follow the program if it moved to another college
      DATA.curriculumId = id;
      toast(res.name + ' updated.');
      reload();
    }

    CM.apiAuth('admin_programs', body, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not save the program.'); return; }
      if (!limits.length) { finish(res); return; }
      CM.apiAuth('admin_unit_limits', { curriculumId: id, limits: limits }, function (r2) {
        if (!r2.ok) { showModalError(r2.error || 'Could not save the unit limits.'); return; }
        finish(res);
      });
    });
  }

  function deleteProgramModal(id) {
    var p = DATA.programs.filter(function (x) { return String(x.curriculum_id) === String(id); })[0];
    if (!p) return;
    var students = DATA.students.filter(function (x) { return x.program === p.curriculum_name; }).length;
    var subjects = String(DATA.curriculumId) === String(id) ? DATA.subjects.length : 0;
    openModal('<span class="eyebrow-sm">Academic setup</span><h2 id="modal-title">Delete ' + esc(p.curriculum_name) + '?</h2>' +
      '<p class="req-sub">The program will be removed together with ' + (subjects ? 'its ' + subjects + ' subject' + (subjects === 1 ? '' : 's') : 'its subjects') +
      ', their sections, the study plan and prerequisites. This cannot be undone.' +
      (students ? ' ' + students + ' student' + (students === 1 ? ' is' : 's are') + ' still in this program, so it can’t be deleted until ' + (students === 1 ? 'that student is' : 'they are') + ' shifted to another program.' : '') + '</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-delete-program-confirm="' + p.curriculum_id + '" style="background:#b3261e">Delete program</button></div>');
  }

  function deleteProgramConfirm(id) {
    CM.apiAuth('admin_programs', { action: 'delete', curriculumId: id }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not delete the program.'); return; }
      closeModal();
      // open the next program of the same college, or the empty state if it was the last one
      var next = DATA.programs.filter(function (x) { return String(x.curriculum_id) !== String(id) && parseInt(x.college_id, 10) === DATA.collegeId; })[0];
      DATA.curriculumId = next ? parseInt(next.curriculum_id, 10) : -1;
      toast(res.name + ' deleted.');
      reload();
    });
  }

  function addCollegeModal() {
    openModal('<span class="eyebrow-sm">Academic setup</span><h2 id="modal-title">Add college</h2>' +
      '<p class="req-sub">A college can hold two or more programs. After saving you can add its first program.</p>' +
      '<div class="modal-field" style="margin-top:1rem"><label for="col-name">College name</label>' +
        '<input id="col-name" type="text" maxlength="150" autocomplete="off" placeholder="e.g. College of Engineering"></div>' +
      '<div class="modal-field" style="margin-top:1rem"><label for="col-code">Code</label>' +
        '<input id="col-code" type="text" maxlength="20" autocomplete="off" placeholder="e.g. CE"></div>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-add-college-confirm>Add college</button></div>');
  }

  function addCollegeConfirm() {
    CM.apiAuth('admin_colleges', { action: 'add', name: $('#col-name').value, code: $('#col-code').value }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not add the college.'); return; }
      closeModal();
      DATA.collegeId = res.collegeId;
      DATA.curriculumId = -1;                      // the new college has no program yet
      toast(res.name + ' added. Add its first program next.');
      reload();
    });
  }

  function manageCollegeModal() {
    var c = DATA.colleges.filter(function (x) { return parseInt(x.college_id, 10) === DATA.collegeId; })[0];
    if (!c) return;
    openModal('<span class="modal-icon">' + ic('edit') + '</span><span class="eyebrow-sm eyebrow-line">Academic setup</span><h2 id="modal-title">Manage college</h2>' +
      '<p class="req-sub">Update this college or remove it from your academic setup.</p>' +
      '<div class="modal-field"><label for="col-edit-name">College name</label>' +
        '<input id="col-edit-name" type="text" maxlength="150" autocomplete="off" value="' + esc(c.college_name) + '"></div>' +
      dangerZoneHtml('Delete this college', 'Programs assigned to it will no longer be available.', 'data-delete-college', c.college_id, 'Delete college') +
      '<p class="modal-error" id="modal-err" role="alert" hidden></p>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-ghost" data-add-college>' + ic('plus') + 'Add college</button>' +
        '<button type="button" class="btn-solid" data-edit-college-confirm="' + c.college_id + '">' + ic('check') + 'Save changes</button></div>');
  }

  function editCollegeConfirm(id) {
    CM.apiAuth('admin_colleges', { action: 'update', collegeId: id, name: $('#col-edit-name').value }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not save the college.'); return; }
      closeModal();
      toast(res.name + ' updated.');
      reload();
    });
  }

  function deleteCollegeModal(id) {
    var c = DATA.colleges.filter(function (x) { return String(x.college_id) === String(id); })[0];
    if (!c) return;
    var n = programsOfCollege(parseInt(id, 10)).length;
    openModal('<span class="eyebrow-sm eyebrow-line">Academic setup</span><h2 id="modal-title">Delete ' + esc(c.college_name) + '?</h2>' +
      '<p class="req-sub">The college will be removed' + (n ? ' together with its ' + n + ' program' + (n === 1 ? '' : 's') + ', their subjects, sections and study plans' : '') +
      '. This cannot be undone. It can’t be deleted while students are enrolled in one of its programs; shift them to another program first.</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden></p>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-delete-college-confirm="' + c.college_id + '" style="background:#b3261e">Delete college</button></div>');
  }

  function deleteCollegeConfirm(id) {
    CM.apiAuth('admin_colleges', { action: 'delete', collegeId: id }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not delete the college.'); return; }
      closeModal();
      DATA.collegeId = 0; DATA.curriculumId = 0;      // fall back to the first program that is left
      toast(res.name + ' deleted.');
      reload();
    });
  }

  // ---------- Program shift (admin_shift.php) ----------
  function shiftModal(id) {
    var s = DATA.students.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var yrs = CM.YEARS.map(function (y) { return '<option' + (y === s.year ? ' selected' : '') + '>' + y + '</option>'; }).join('');
    var dl = DATA.programs.map(function (p) { return '<option value="' + esc(p.curriculum_name) + '"></option>'; }).join('');
    openModal('<span class="eyebrow-sm">Shift program</span><h2 id="modal-title">' + esc(s.name) + '</h2>' +
      '<p class="req-sub">Now in ' + esc(s.program) + '. Grades that match a subject of the new program are credited, the rest are archived so they don’t count towards the new GWA.</p>' +
      '<div class="modal-field" style="margin-top:1rem"><label for="shift-program">New program</label>' +
        '<input id="shift-program" type="text" list="shift-programs" autocomplete="off" placeholder="Type or pick the new program"><datalist id="shift-programs">' + dl + '</datalist></div>' +
      '<div class="field-row" style="margin-top:1rem">' +
        '<div class="modal-field"><label for="shift-year">Year level</label><select id="shift-year">' + yrs + '</select></div>' +
        '<div class="modal-field"><label for="shift-status">Student type</label><select id="shift-status">' +
          '<option' + (s.standing === 'Regular' ? ' selected' : '') + ' value="Regular">Regular</option><option' + (s.standing !== 'Regular' ? ' selected' : '') + ' value="Irregular">Irregular</option></select></div>' +
      '</div>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-shift-preview="' + esc(s.id) + '">Preview credits</button></div>' +
      '<div id="shift-box"></div>');
  }

  function shiftProgramId() {
    var t = ($('#shift-program').value || '').trim().toLowerCase();
    var p = DATA.programs.filter(function (x) { return x.curriculum_name.toLowerCase() === t || String(x.course_code).toLowerCase() === t; })[0];
    return p ? p.curriculum_id : 0;
  }

  function shiftPreview(id) {
    var cid = shiftProgramId();
    if (!cid) { showModalError('Pick the new program from the suggestions.'); return; }
    var box = $('#shift-box');
    box.innerHTML = '<p class="req-sub">Checking grades…</p>';
    CM.apiAuth('admin_shift?student=' + encodeURIComponent(id) + '&curriculum=' + cid, null, function (res) {
      if (!res.ok) { box.innerHTML = ''; showModalError(res.error || 'Could not check the grades.'); return; }
      var opts = '<option value="">Don’t credit (archive)</option>' + res.newSubjects.map(function (n) {
        return '<option value="' + n.subject_id + '">' + esc(n.course_code + ' · ' + n.course_title) + '</option>';
      }).join('');
      var ok = 0;
      var rows = res.rows.map(function (r) {
        var left = '<b>' + esc(r.fromCode) + '</b> ' + esc(r.fromTitle) + '<small>Grade ' + esc(r.grade) + (r.passed ? '' : ' (not passed)') + '</small>';
        if (r.toSubjectId) { ok++; return '<li>' + left + '<small>→ credited as <b>' + esc(r.toCode) + '</b> (' + esc(r.via) + ')</small></li>'; }
        return '<li>' + left + '<small>No match. Credit as: <select data-shift-map="' + r.fromSubjectId + '">' + opts + '</select></small></li>';
      }).join('') || '<li><small>This student has no grades to carry over.</small></li>';
      var warn = res.enrollmentStatus && res.enrollmentStatus !== 'Draft'
        ? '<p class="modal-error" role="alert">The current plan is ' + esc(res.enrollmentStatus) + '. Return or reject it before shifting.</p>' : '';
      box.innerHTML = '<h3 style="margin:1.2rem 0 .5rem">Grades to carry over to ' + esc(res.to.curriculum_name) + '</h3>' +
        '<p class="req-sub">' + ok + ' of ' + res.rows.length + ' matched automatically. Choosing a subject for an unmatched row also saves it as an equivalency for the next student.</p>' +
        '<ul class="req-detail">' + rows + '</ul>' + warn +
        (res.enrollmentStatus === 'Draft' ? '<p class="req-sub">Their draft plan for this term will be cleared.</p>' : '') +
        '<div class="modal-actions" style="margin-top:1rem"><button type="button" class="btn-solid" data-shift-confirm="' + esc(id) + '"' +
        (warn ? ' disabled' : '') + '>Shift program</button></div>';
    });
  }

  function shiftConfirm(id) {
    var cid = shiftProgramId();
    if (!cid) { showModalError('Pick the new program from the suggestions.'); return; }
    var maps = [];
    document.querySelectorAll('[data-shift-map]').forEach(function (sel) {
      if (sel.value) maps.push({ from: parseInt(sel.getAttribute('data-shift-map'), 10), to: parseInt(sel.value, 10) });
    });
    CM.apiAuth('admin_shift', { action: 'shift', studentId: id, curriculumId: cid, yearLevel: CM.YEARS.indexOf($('#shift-year').value) + 1,
                                regStatus: $('#shift-status').value, mappings: maps }, function (res) {
      if (!res.ok) { showModalError(res.error || 'Could not shift the program.'); return; }
      closeModal();
      toast('Shifted to ' + res.program + '. ' + res.credited + ' credited, ' + res.archived + ' archived.');
      reload();
    });
  }

  function studentAction(id, action, doneText) {
    CM.apiAuth('admin_students', { action: action, studentId: id }, function (res) {
      if (!res.ok) { if ($('#modal-err')) showModalError(res.error || 'Could not update the student.'); else toast(res.error || 'Could not update the student.'); return; }
      closeModal(); toast(doneText); reload();
    });
  }

  // ---------- Grades (admin_grades.php -> sp_add_grade) ----------
  var GRADE_VALUES = ['1.00', '1.25', '1.50', '1.75', '2.00', '2.25', '2.50', '2.75', '3.00', '5.00', 'INC', 'DO'];

  function loadGrades(studentId) {
    CM.apiAuth('admin_grades?student=' + encodeURIComponent(studentId), null, function (res) {
      var box = $('#grades-box');
      if (!box || box.getAttribute('data-student') !== studentId) return;
      if (!res.ok) { box.innerHTML = '<p class="req-sub">' + esc(res.error || 'Could not load grades.') + '</p>'; return; }
      var term = DATA.term || { academicYear: '', semester: '1st' };
      GRADE_RECORDS = res.records;
      GRADE_SUBJECTS = res.subjects;
      var rows = res.records.map(function (r) {
        return '<li><b>' + esc(r.course_code) + '</b> ' + esc(r.course_title) +
          '<small>' + esc(r.academic_year + ' · ' + semLabel(r.semester) + ' · attempt ' + r.attempt_no + ' · ' + r.final_grade + ' (' + r.remark + ')') + '</small>' +
          '<button type="button" class="link-btn" data-edit-grade="' + r.record_id + '" style="margin-top:.25rem;background:none;border:0;padding:0;color:var(--forest);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline">Edit grade</button></li>';
      }).join('') || '<li><small>No grades recorded yet.</small></li>';
      box.innerHTML = '<h3 style="margin:1.2rem 0 .5rem">Grades</h3><ul class="req-detail">' + rows + '</ul>' +
        '<form id="grade-form" data-student="' + esc(studentId) + '" data-record="" novalidate>' +
          '<p class="req-sub" id="gr-mode" style="margin-top:1rem" hidden></p>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="gr-subject">Subject</label><select id="gr-subject"></select></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="gr-grade">Final grade</label><select id="gr-grade">' +
            GRADE_VALUES.map(function (g) { return '<option>' + g + '</option>'; }).join('') + '</select></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="gr-ay">Academic year</label>' +
            '<input id="gr-ay" type="text" maxlength="9" value="' + esc(term.academicYear) + '" placeholder="2025-2026"></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="gr-sem">Semester</label><select id="gr-sem">' +
            ['1st', '2nd', 'Summer'].map(function (m) { return '<option value="' + m + '"' + (m === term.semester ? ' selected' : '') + '>' + semLabel(m) + '</option>'; }).join('') + '</select></div>' +
          '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
          '<button type="submit" class="modal-submit" id="gr-submit" style="width:100%">Save grade</button>' +
          '<button type="button" id="gr-cancel" data-cancel-grade-edit hidden style="width:100%;margin-top:.6rem;background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;text-decoration:underline">Cancel edit</button>' +
        '</form>';
      refreshGradeSubjects();
      $('#gr-ay').addEventListener('input', refreshGradeSubjects);
      $('#gr-sem').addEventListener('change', refreshGradeSubjects);
    });
  }

  var GRADE_RECORDS = [], GRADE_SUBJECTS = [];

  /** The Subject list only offers subjects that have no grade yet for the academic year and semester in the form. */
  function refreshGradeSubjects() {
    var sel = $('#gr-subject'), f = $('#grade-form');
    if (!sel || !f || f.getAttribute('data-record')) return;
    var ay = $('#gr-ay').value.trim(), sem = $('#gr-sem').value, keep = sel.value;
    var graded = {};
    GRADE_RECORDS.forEach(function (r) { if (r.academic_year === ay && r.semester === sem) graded[r.subject_id] = true; });
    var open = GRADE_SUBJECTS.filter(function (x) { return !graded[x.subjectId]; });
    sel.innerHTML = open.length
      ? open.map(function (x) { return '<option value="' + x.subjectId + '">' + esc(x.code + ' · ' + x.title) + '</option>'; }).join('')
      : '<option value="">' + (GRADE_SUBJECTS.length ? 'All subjects are already graded for this term' : 'No enrolled subjects') + '</option>';
    if (open.some(function (x) { return String(x.subjectId) === keep; })) sel.value = keep;
    $('#gr-submit').disabled = !open.length;
  }

  /** Puts the grade form into edit mode for one saved grade (only the grade can change), or back to add mode. */
  function setGradeEdit(recordId) {
    var f = $('#grade-form');
    if (!f) return;
    var r = recordId ? GRADE_RECORDS.filter(function (x) { return String(x.record_id) === String(recordId); })[0] : null;
    var editing = !!r;
    f.setAttribute('data-record', editing ? String(r.record_id) : '');
    var mode = $('#gr-mode');
    mode.hidden = !editing;
    mode.textContent = editing ? 'Editing ' + r.course_code + ' · ' + r.academic_year + ' · ' + semLabel(r.semester) + ' · attempt ' + r.attempt_no : '';
    if (editing) {
      $('#gr-subject').innerHTML = '<option value="">' + esc(r.course_code + ' · ' + r.course_title) + '</option>';
      $('#gr-grade').value = r.final_grade;
      $('#gr-ay').value = r.academic_year;
      $('#gr-sem').value = r.semester;
    }
    ['#gr-subject', '#gr-ay', '#gr-sem'].forEach(function (id) { $(id).disabled = editing; });
    $('#gr-submit').textContent = editing ? 'Update grade' : 'Save grade';
    $('#gr-submit').disabled = false;
    $('#gr-cancel').hidden = !editing;
    var err = $('#modal-err'); if (err) err.hidden = true;
    if (editing) f.scrollIntoView({ block: 'nearest' });
  }

  function returnModal(enrollmentId) {
    var r = DATA.requests.filter(function (x) { return x.enrollmentId === parseInt(enrollmentId, 10); })[0];
    if (!r) return;
    openModal('<span class="eyebrow-sm">Enrollment request ' + esc(r.id) + '</span><h2 id="modal-title">Request changes from ' + esc(r.name) + '</h2>' +
      '<div class="modal-field"><label for="remarks">Remarks for the student</label>' +
      '<textarea id="remarks" rows="4" maxlength="500" placeholder="What should the student change?" style="padding:.8rem 1rem;border:1px solid var(--line);border-radius:.8rem;font:inherit;resize:vertical"></textarea></div>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-solid" data-decision="Draft" data-id="' + r.enrollmentId + '">Send back to student</button>' +
        '<button type="button" class="btn-ghost" data-decision="Rejected" data-id="' + r.enrollmentId + '">Reject request</button>' +
      '</div>');
  }

  function decide(enrollmentId, decision, remarks) {
    CM.apiAuth('admin_review', { id: parseInt(enrollmentId, 10), decision: decision, remarks: remarks || '' }, function (res) {
      if (!res.ok) {
        if ($('#modal-err')) showModalError(res.error || 'Could not save the decision.'); else toast(res.error || 'Could not save the decision.');
        return;
      }
      closeModal();
      toast(decision === 'Enrolled' ? 'Request approved.' : decision === 'Draft' ? 'Sent back to the student for changes.' : 'Request rejected.');
      reload();
    });
  }

  function addSubjectModal() {
    var prog = DATA.programs.length > 1
      ? '<div class="modal-field" style="margin-top:1rem"><label for="sub-program">Program</label><select id="sub-program">' + DATA.programs.map(function (p) {
          return '<option value="' + p.curriculum_id + '"' + (String(p.curriculum_id) === String(DATA.curriculumId) ? ' selected' : '') + '>' +
            esc((DATA.colleges.length > 1 && p.college_code ? p.college_code + ' · ' : '') + p.curriculum_name) + '</option>';
        }).join('') + '</select></div>' : '';
    openModal('<span class="eyebrow-sm">Curriculum</span><h2 id="modal-title">Add a subject</h2>' +
      '<form id="add-form" novalidate>' + prog +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-code">Subject code</label><input id="sub-code" type="text" maxlength="20" placeholder="e.g. BSIT_301" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-name">Subject name</label><input id="sub-name" type="text" maxlength="200" placeholder="Enter subject name" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-type">Type</label><select id="sub-type">' +
          '<option value="lec">Lecture</option><option value="lab">Laboratory</option><option value="nstp">NSTP</option></select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-units">Units</label><select id="sub-units">' +
          '<option>1</option><option>2</option><option selected>3</option><option>4</option></select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-year">Year level</label><select id="sub-year">' +
          '<option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option><option value="4">4th Year</option></select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-sem">Semester</label><select id="sub-sem">' +
          '<option value="1st">1st Semester</option><option value="2nd">2nd Semester</option><option value="Summer">Summer</option></select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sub-prereq">Prerequisite <span class="opt">(optional)</span></label>' +
          '<select id="sub-prereq"><option value="">None</option>' +
          DATA.subjects.map(function (c) {
            return '<option value="' + esc(c.code) + '">' + esc(c.code) + ' · ' + esc(c.title) + '</option>';
          }).join('') + '</select></div>' +
        '<h3 style="margin:1.4rem 0 .2rem">First section</h3>' +
        '<label style="display:flex;gap:.5rem;align-items:center;margin-top:.4rem"><input id="sub-with-section" type="checkbox" checked> Add a section for the semester chosen above so students can pick this subject when it opens</label>' +
        '<div id="sub-section-fields">' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-block">Section</label><input id="sub-block" type="text" maxlength="20" value="Section A" autocomplete="off"></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-day">Day</label><select id="sub-day">' +
            DAYS.map(function (d) { return '<option>' + d + '</option>'; }).join('') + '</select></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-start">Start time</label><input id="sub-start" type="time" value="08:00"></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-end">End time</label><input id="sub-end" type="time" value="10:00"></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-room">Room or mode</label><input id="sub-room" type="text" maxlength="50" placeholder="e.g. Room 301 or Online" autocomplete="off"></div>' +
          '<div class="modal-field" style="margin-top:1rem"><label for="sub-slots">Slots</label><input id="sub-slots" type="number" min="1" value="40"></div>' +
        '</div>' +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Add to curriculum</button>' +
      '</form>');
  }

  function addApplicationModal() {
    var opts = programOptionsHtml();
    openModal('<span class="eyebrow-sm">Admissions</span><h2 id="modal-title">New application</h2>' +
      '<form id="app-form" novalidate>' +
        '<div class="modal-field"><label for="app-name">Applicant name</label><input id="app-name" type="text" maxlength="120" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="app-program">Program</label>' +
          '<input id="app-program" type="text" maxlength="150" list="app-programs" autocomplete="off"><datalist id="app-programs">' + opts + '</datalist></div>' +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Add application</button>' +
      '</form>');
  }

  function deleteSubjectModal(subjectId) {
    var s = DATA.subjects.filter(function (x) { return String(x.subjectId) === String(subjectId); })[0];
    if (!s) return;
    var needed = DATA.subjects.filter(function (x) { return x.prereqs.indexOf(s.code) !== -1; }).map(function (x) { return x.code; });
    var secs = DATA.sections.filter(function (r) { return String(r.subject_id) === String(subjectId); }).length;
    openModal('<span class="eyebrow-sm">Curriculum</span><h2 id="modal-title">Delete ' + esc(s.code) + '?</h2>' +
      '<p class="req-sub">' + esc(s.title) + ' will be removed from the curriculum' + (secs ? ' together with its ' + secs + ' section' + (secs === 1 ? '' : 's') : '') + '.' +
      (needed.length ? ' It will also stop being a prerequisite of ' + esc(needed.join(', ')) + '.' : '') +
      ' This cannot be undone. A subject with student grades or plans can’t be deleted; deactivate it instead.</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
      '<div class="modal-actions" style="margin-top:1rem">' +
        '<button type="button" class="btn-ghost" data-modal-close-btn>Cancel</button>' +
        '<button type="button" class="btn-solid" data-delete-subject-confirm="' + s.subjectId + '" style="background:#b3261e">Delete subject</button>' +
      '</div>');
  }

  function manageSectionsModal(subjectId) {
    var s = DATA.subjects.filter(function (x) { return String(x.subjectId) === String(subjectId); })[0];
    if (!s) return;
    var rows = DATA.sections.filter(function (r) { return String(r.subject_id) === String(subjectId); }).map(function (r) {
      var held = parseInt(r.held_slots, 10) > 0;
      return '<li style="display:flex;gap:.6rem;align-items:center;justify-content:space-between;margin:.5rem 0">' +
        '<span><b>' + esc(r.block_section) + '</b> · ' + esc(r.day_of_week) + ' ' + esc(clock(r.start_time)) + '–' + esc(clock(r.end_time)) +
          '<small style="display:block">' + esc(semLabel(r.semester)) + ' ' + esc(r.academic_year) + ' · ' + esc(r.room_or_mode) + ' · ' + esc(r.held_slots) + '/' + esc(r.max_slots) + ' slots taken' +
          (String(r.is_active) === '0' ? ' · inactive' : '') + '</small></span>' +
        '<span style="display:flex;gap:.4rem"><button type="button" class="btn-ghost" data-section-edit="' + r.schedule_id + '">Edit</button>' +
        (held ? '<button type="button" class="btn-ghost" data-section-hide="' + r.schedule_id + '"' + (String(r.is_active) === '0' ? ' disabled' : '') + '>Deactivate</button>'
              : '<button type="button" class="btn-ghost" data-section-delete="' + r.schedule_id + '" style="color:#b3261e">Delete</button>') + '</span></li>';
    }).join('') || '<li><small>No sections.</small></li>';
    openModal('<span class="eyebrow-sm">' + esc(s.code) + '</span>' +
      '<div style="margin-right:3.5rem"><h2 id="modal-title" style="margin:0">Sections</h2></div>' +
      '<button type="button" class="btn-dark btn-add-section" data-add-section="' + s.subjectId + '">+ Add section</button>' +
      '<ul class="req-detail" style="list-style:none;padding:0">' + rows + '</ul>' +
      '<p class="req-sub">Sections that students already hold can only be deactivated, not deleted.</p>' +
      '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>');
  }

  function editSectionModal(scheduleId) {
    var r = DATA.sections.filter(function (x) { return String(x.schedule_id) === String(scheduleId); })[0];
    if (!r) return;
    var held = parseInt(r.held_slots, 10) || 0;
    openModal('<span class="eyebrow-sm">' + esc(r.course_code) + '</span><h2 id="modal-title">Edit section</h2>' +
      '<form id="section-edit-form" data-schedule="' + r.schedule_id + '" data-subject="' + r.subject_id + '" novalidate>' +
        '<div class="modal-field"><label for="se-block">Section</label><input id="se-block" type="text" maxlength="20" value="' + esc(r.block_section) + '" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="se-day">Day</label><select id="se-day">' +
          DAYS.map(function (d) { return '<option' + (d === r.day_of_week ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="se-start">Start time</label><input id="se-start" type="time" value="' + esc(r.start_time) + '"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="se-end">End time</label><input id="se-end" type="time" value="' + esc(r.end_time) + '"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="se-room">Room or mode</label><input id="se-room" type="text" maxlength="50" value="' + esc(r.room_or_mode) + '" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="se-slots">Slots</label><input id="se-slots" type="number" min="' + Math.max(1, held) + '" value="' + esc(r.max_slots) + '"></div>' +
        (held ? '<p class="req-sub">' + held + ' seat' + (held === 1 ? ' is' : 's are') + ' already held by students. Changing the day or time can create a clash in their plans, so tell them.</p>' : '') +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Save changes</button>' +
      '</form>');
  }

  /** Next unused section name and the first free 2-hour slot, so the form opens on a time that doesn't overlap. */
  function sectionDefaults(subjectId) {
    var secs = sectionsOf(subjectId);
    var mins = function (t) { var m = String(t).split(':'); return parseInt(m[0], 10) * 60 + parseInt(m[1], 10); };
    var fmt  = function (m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
    var used = {}; secs.forEach(function (r) { used[String(r.block_section).toLowerCase()] = true; });
    var out = { block: 'Section A', day: 'Mon', start: '08:00', end: '10:00' };
    for (var i = 0; i < 26; i++) {
      var name = 'Section ' + String.fromCharCode(65 + i);
      if (!used[name.toLowerCase()]) { out.block = name; break; }
    }
    var len = 120;
    for (var d = 0; d < DAYS.length; d++) {
      if (DAYS[d] === 'Sun') continue;
      for (var st = 7 * 60; st + len <= 19 * 60; st += 30) {
        var clash = secs.some(function (r) { return r.day_of_week === DAYS[d] && mins(r.start_time) < st + len && mins(r.end_time) > st; });
        if (!clash) { out.day = DAYS[d]; out.start = fmt(st); out.end = fmt(st + len); return out; }
      }
    }
    return out;
  }

  function addSectionModal(subjectId) {
    var s = DATA.subjects.filter(function (x) { return String(x.subjectId) === String(subjectId); })[0];
    if (!s) return;
    var def = sectionDefaults(subjectId);
    openModal('<span class="eyebrow-sm">' + esc(s.code) + '</span><h2 id="modal-title">Add a section</h2>' +
      '<form id="section-form" data-subject="' + s.subjectId + '" novalidate>' +
        '<div class="modal-field"><label for="sec-block">Section</label><input id="sec-block" type="text" maxlength="20" value="' + esc(def.block) + '" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sec-day">Day</label><select id="sec-day">' +
          DAYS.map(function (d) { return '<option' + (d === def.day ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sec-start">Start time</label><input id="sec-start" type="time" value="' + def.start + '"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sec-end">End time</label><input id="sec-end" type="time" value="' + def.end + '"></div>' +
        '<p class="req-sub" style="margin-top:.6rem">Sections of the same subject can’t overlap in time. Back to back is fine.</p>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sec-room">Room or mode</label><input id="sec-room" type="text" maxlength="50" placeholder="e.g. Room 301 or Online" autocomplete="off"></div>' +
        '<div class="modal-field" style="margin-top:1rem"><label for="sec-slots">Slots</label><input id="sec-slots" type="number" min="1" value="40"></div>' +
        '<p class="modal-error" id="modal-err" role="alert" hidden style="margin-top:1rem"></p>' +
        '<button type="submit" class="modal-submit" style="width:100%">Add section</button>' +
        '<button type="button" class="btn-ghost" data-manage-sections="' + s.subjectId + '" style="width:100%;margin-top:.6rem">Back to sections</button>' +
      '</form>');
  }

  // ---------- CSV export ----------
  function exportCsv() {
    var rows = filteredApps();
    function cell(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
    var lines = [['Applicant', 'Application ID', 'Program', 'Submitted', 'Status'].map(cell).join(',')];
    rows.forEach(function (x) {
      lines.push([x.a.name, x.a.id, x.a.program, x.a.date, APP_STATUS[x.status].label].map(cell).join(','));
    });
    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = 'coursemap-applications.csv';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + rows.length + (rows.length === 1 ? ' application' : ' applications') + ' to CSV.');
  }

  // ---------- Chrome ----------
  var NAV = [
    { page: 'dashboard',    href: '#/',             icon: 'grid',     label: 'Dashboard' },
    { page: 'applications', href: '#/applications', icon: 'file',     label: 'Applications' },
    { page: 'registrations', href: '#/registrations', icon: 'check',  label: 'Registrations' },
    { page: 'students',     href: '#/students',     icon: 'users',    label: 'Students' },
    { page: 'requests',     href: '#/requests',     icon: 'book',     label: 'Enrollment Requests' },
    { page: 'forms',        href: '#/forms',        icon: 'clock',    label: 'Load Forms' },
    { page: 'curriculum',   href: '#/curriculum',   icon: 'calendar', label: 'Curriculum' }
  ];
  var VIEWS = {
    dashboard: { title: 'Admin Dashboard', render: renderDashboard },
    applications: { title: 'Applications', render: renderApplications },
    registrations: { title: 'Registrations', render: renderRegistrations },
    students: { title: 'Student directory', render: renderStudents },
    requests: { title: 'Approval requests', render: renderRequests },
    forms: { title: 'Load forms', render: renderForms },
    curriculum: { title: 'Curriculum', render: renderCurriculum }
  };

  function mount(name, html) {
    var holder = document.querySelector('[data-mount="' + name + '"]');
    if (!holder) return;
    holder.insertAdjacentHTML('afterend', html);
    holder.parentNode.removeChild(holder);
  }

  // ---------- Notifications: things waiting for the admin ----------
  // New = not seen yet. Opening the bell marks everything currently listed as seen (remembered in this browser).
  var SEEN_KEY = 'coursemap-admin-notif-seen-v1';

  function adminNotifications() {
    var list = [];
    DATA.requests.forEach(function (r) {
      if (r.status !== 'For Review') return;
      list.push({ id: 'enr:' + r.enrollmentId + ':' + r.submittedAt, title: 'Enrollment request',
        body: r.name + ' submitted a ' + r.title + '.', href: '#/requests' });
    });
    DATA.forms.forEach(function (f) {
      if (f.status !== 'Pending') return;
      list.push({ id: 'form:' + f.form_id, title: f.form_type + ' form uploaded',
        body: f.student_name + ' uploaded a ' + String(f.form_type).toLowerCase() + ' form for approval.', href: '#/forms' });
    });
    DATA.registrations.forEach(function (r) {
      if (r.status !== 'Pending') return;
      list.push({ id: 'reg:' + r.id, title: 'New account to check',
        body: r.name + ' signed up and is waiting for the checklist PDF check.', href: '#/registrations' });
    });
    DATA.applications.forEach(function (a) {
      if (a.status !== 'review') return;
      list.push({ id: 'app:' + a.id, title: 'Application for review',
        body: a.name + ' applied to ' + a.program + '.', href: '#/applications' });
    });
    return list;
  }

  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; }
  }

  function markNotificationsSeen() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(adminNotifications().map(function (n) { return n.id; }))); } catch (e) { /* storage unavailable */ }
    updateBell();
  }

  function updateBell() {
    var btn = $('.btn-bell'), badge = $('#bell-count'), ul = $('#notif-list');
    if (!btn || !badge) return;
    var all = adminNotifications(), seen = readSeen();
    var fresh = all.filter(function (n) { return seen.indexOf(n.id) === -1; }).length;
    btn.classList.toggle('has-new', fresh > 0);
    badge.hidden = fresh === 0;
    badge.textContent = fresh > 9 ? '9+' : fresh;
    btn.setAttribute('aria-label', fresh ? 'Notifications, ' + fresh + ' new' : 'Notifications');
    if (ul) {
      ul.innerHTML = all.length ? all.map(function (n) {
        return '<li><a href="' + n.href + '" class="notif-link"><strong>' + esc(n.title) + '</strong><span>' + esc(n.body) + '</span></a></li>';
      }).join('') : '<li><span>You’re all caught up. Nothing is waiting for you.</span></li>';
    }
  }

  function closeNotif() {
    var n = $('#notif'), b = $('.btn-bell');
    if (n) n.classList.remove('is-open');
    if (b) b.setAttribute('aria-expanded', 'false');
  }

  function topbarHtml() {
    return '<header class="topbar">' +
      '<a href="#/" class="logo" aria-label="CourseMap admin console home"><span class="logo-mark">' + ic('cap') + '</span>' +
        '<span class="logo-text"><span class="logo-name">CourseMap</span><span class="logo-sub">ADMIN CONSOLE</span></span></a>' +
      '<div class="topbar-right">' +
        '<div class="bell-wrap">' +
          '<button type="button" class="btn-bell" data-toggle-notif aria-label="Notifications" aria-expanded="false">' +
            ic('bell') + '<span class="bell-count" id="bell-count" hidden>0</span></button>' +
          '<div class="notif" id="notif" role="region" aria-label="Notifications">' +
            '<h2>Notifications</h2><ul id="notif-list"></ul></div>' +
        '</div>' +
        '<span class="divider"></span>' +
        '<div class="user"><span class="avatar">' + esc(ADMIN.initials) + '</span><span class="user-meta">' +
          '<span class="user-name">' + esc(ADMIN.fullName) + '</span><span class="user-program">' + esc(ADMIN.title) + '</span></span></div>' +
        '<button type="button" class="btn-signout" data-signout aria-label="Sign out" title="Sign out">' + ic('logout') + '</button>' +
      '</div></header>';
  }

  function sidebarHtml() {
    return '<aside class="sidebar"><nav style="display:contents" aria-label="Main">' +
      NAV.map(function (n) {
        return '<a href="' + n.href + '" class="nav-item" data-nav="' + n.page + '">' + ic(n.icon) + esc(n.label) + '</a>';
      }).join('') + '</nav>' +
      '<div class="cycle"><small>Active admission cycle</small><strong id="cycle-ay">AY</strong><span id="cycle-sem">Applications open</span>' +
        '<button type="button" class="cycle-btn" data-change-term>Change semester</button></div>' +
      '<div class="sidebar-foot">CourseMap Administration<br>Registrar’s Office</div></aside>' +
      '<div class="mobile-cycle"><div><small>Active admission cycle</small><strong id="cycle-ay-m">AY</strong><span id="cycle-sem-m">Applications open</span></div>' +
        '<button type="button" class="cycle-btn" data-change-term>Change semester</button></div>';
  }

  // ---------- Routing / render ----------
  var keepQuery = false;   // kept for route(); the page searches reset on every page change

  function route() {
    var name = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
    if (!VIEWS[name]) name = 'dashboard';
    page = name;
    if (!keepQuery) query = '';
    keepQuery = false;
    document.querySelectorAll('.sidebar .nav-item').forEach(function (a) {
      var on = a.getAttribute('data-nav') === name;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = VIEWS[name].title + ' · CourseMap Admin';
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    var cycle = $('#cycle-ay');
    if (cycle && DATA.term) cycle.textContent = 'AY ' + dashYears(DATA.term.academicYear);
    var cycleSem = $('#cycle-sem');
    if (cycleSem && DATA.term) cycleSem.textContent = semLabel(DATA.term.semester) + ' · Applications open';
    updateBell();
    var nOpen = $('#notif');
    if (nOpen && nOpen.classList.contains('is-open')) markNotificationsSeen();
    var cycleM = $('#cycle-ay-m'), cycleSemM = $('#cycle-sem-m');
    if (cycleM && DATA.term) cycleM.textContent = 'AY ' + dashYears(DATA.term.academicYear);
    if (cycleSemM && DATA.term) cycleSemM.textContent = semLabel(DATA.term.semester) + ' · Applications open';
    if (!DATA.loaded) {
      main.innerHTML = header('', VIEWS[page].title, 'Loading from the database…');
      return;
    }
    if (DATA.error) {
      main.innerHTML = header('', VIEWS[page].title, 'Some data could not be loaded.') +
        '<p class="card empty">' + esc(DATA.error) + '</p>' + VIEWS[page].render();
      return;
    }
    main.innerHTML = VIEWS[page].render();
  }

  // ---------- Events ----------
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('[data-signout]')) { CM.signOut(); return; }

      if (t.closest('[data-toggle-notif]')) {
        var nBox = $('#notif'), nBtn = $('.btn-bell');
        var nowOpen = nBox.classList.toggle('is-open');
        nBtn.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) markNotificationsSeen();
        return;
      }
      if (t.closest('.notif-link')) closeNotif();
      else if (!t.closest('.bell-wrap')) closeNotif();

      // modal: close on the scrim (not on clicks inside the card) or the X
      var closer = t.closest('[data-modal-close]');
      if (closer && (closer.classList.contains('btn-close') || t === closer)) { closeModal(); return; }

      var f = t.closest('[data-filter]');
      if (f) { appFilter = f.getAttribute('data-filter'); render(); return; }

      var rv = t.closest('[data-review]');
      if (rv) { reviewModal(rv.getAttribute('data-review')); return; }

      var sact = t.closest('[data-student-action]');
      if (sact) {
        var act = sact.getAttribute('data-student-action');
        studentAction(sact.getAttribute('data-id'), act, act === 'suspend' ? 'Account suspended. The student can no longer sign in.' : 'Account reactivated.');
        return;
      }
      if (t.closest('[data-add-program]')) { addProgramModal(); return; }
      if (t.closest('[data-add-program-confirm]')) { addProgramConfirm(); return; }
      var epr = t.closest('[data-manage-program]');
      if (epr) { editProgramModal(epr.getAttribute('data-manage-program')); return; }
      var eprOk = t.closest('[data-edit-program-confirm]');
      if (eprOk) { editProgramConfirm(parseInt(eprOk.getAttribute('data-edit-program-confirm'), 10)); return; }
      var dpr = t.closest('[data-delete-program]');
      if (dpr) { deleteProgramModal(dpr.getAttribute('data-delete-program')); return; }
      var dprOk = t.closest('[data-delete-program-confirm]');
      if (dprOk) { deleteProgramConfirm(parseInt(dprOk.getAttribute('data-delete-program-confirm'), 10)); return; }
      if (t.closest('[data-manage-college]')) { manageCollegeModal(); return; }
      var ecoOk = t.closest('[data-edit-college-confirm]');
      if (ecoOk) { editCollegeConfirm(parseInt(ecoOk.getAttribute('data-edit-college-confirm'), 10)); return; }
      var dco = t.closest('[data-delete-college]');
      if (dco) { deleteCollegeModal(dco.getAttribute('data-delete-college')); return; }
      var dcoOk = t.closest('[data-delete-college-confirm]');
      if (dcoOk) { deleteCollegeConfirm(parseInt(dcoOk.getAttribute('data-delete-college-confirm'), 10)); return; }
      if (t.closest('[data-add-college]')) { addCollegeModal(); return; }
      if (t.closest('[data-add-college-confirm]')) { addCollegeConfirm(); return; }
      var shO = t.closest('[data-shift-open]');
      if (shO) { shiftModal(shO.getAttribute('data-shift-open')); return; }
      var shP = t.closest('[data-shift-preview]');
      if (shP) { shiftPreview(shP.getAttribute('data-shift-preview')); return; }
      var shC = t.closest('[data-shift-confirm]');
      if (shC) { shiftConfirm(shC.getAttribute('data-shift-confirm')); return; }
      var sdel = t.closest('[data-student-delete]');
      if (sdel) { deleteStudentModal(sdel.getAttribute('data-student-delete')); return; }
      var sdelOk = t.closest('[data-student-delete-confirm]');
      if (sdelOk) { studentAction(sdelOk.getAttribute('data-student-delete-confirm'), 'delete', 'Student deleted.'); return; }
      if (t.closest('[data-modal-close-btn]')) { closeModal(); return; }

      var regOpen = t.closest('[data-reg-review]');
      if (regOpen) { registrationModal(parseInt(regOpen.getAttribute('data-reg-review'), 10)); return; }
      var regOk = t.closest('[data-reg-approve]');
      if (regOk) { regOk.disabled = true; decideRegistration(parseInt(regOk.getAttribute('data-reg-approve'), 10), 'Approved', ''); return; }
      var regNo = t.closest('[data-reg-reject]');
      if (regNo) {
        var why2 = ($('#remarks') ? $('#remarks').value : '').trim();
        if (!why2) { showModalError('Add a remark so the student knows why.'); return; }
        decideRegistration(parseInt(regNo.getAttribute('data-reg-reject'), 10), 'Rejected', why2);
        return;
      }

      var fd = t.closest('[data-form-decide]');
      if (fd) {
        var fid = parseInt(fd.getAttribute('data-id'), 10), dec = fd.getAttribute('data-form-decide');
        if (dec === 'Approved') { decideForm(fid, 'Approved', ''); return; }
        rejectFormModal(fid); return;
      }
      var fr = t.closest('[data-form-reject-confirm]');
      if (fr) {
        var why = ($('#remarks') ? $('#remarks').value : '').trim();
        if (!why) { showModalError('Add a remark so the student knows why.'); return; }
        decideForm(parseInt(fr.getAttribute('data-form-reject-confirm'), 10), 'Rejected', why);
        return;
      }

      var sv = t.closest('[data-student-view]');
      if (sv) { studentModal(sv.getAttribute('data-student-view')); return; }

      if (t.closest('[data-goto-requests]')) { closeModal(); window.location.hash = '#/requests'; return; }

      var sa = t.closest('[data-set-app]');
      if (sa) {
        var status = sa.getAttribute('data-set-app'), id = sa.getAttribute('data-id');
        CM.apiAuth('admin_applications', { action: 'setStatus', id: parseInt(id, 10), status: status }, function (res) {
          if (!res.ok) { toast(res.error || 'Could not save the status.'); return; }
          closeModal();
          toast('Application marked “' + APP_STATUS[status].label + '”.');
          reload();
        });
        return;
      }

      var ap = t.closest('[data-approve]');
      if (ap && !ap.disabled) { decide(ap.getAttribute('data-approve'), 'Enrolled', ''); return; }

      var rt = t.closest('[data-return]');
      if (rt && !rt.disabled) { returnModal(rt.getAttribute('data-return')); return; }

      var dc = t.closest('[data-decision]');
      if (dc) {
        var remarks = ($('#remarks') ? $('#remarks').value : '').trim();
        if (!remarks) { showModalError('Add a remark so the student knows what to change.'); return; }
        decide(dc.getAttribute('data-id'), dc.getAttribute('data-decision'), remarks);
        return;
      }

      var tg = t.closest('[data-toggle-subject]');
      if (tg) {
        CM.apiAuth('admin_subjects', { action: 'setActive', subjectId: parseInt(tg.getAttribute('data-toggle-subject'), 10),
                                       active: tg.getAttribute('data-active') === '1' }, function (res) {
          if (!res.ok) { toast(res.error || 'Could not update the subject.'); return; }
          toast(tg.getAttribute('data-active') === '1' ? 'Subject activated.' : 'Subject deactivated. Students no longer see it.');
          reload();
        });
        return;
      }

      var asec = t.closest('[data-add-section]');
      if (asec) { addSectionModal(asec.getAttribute('data-add-section')); return; }

      if (t.closest('[data-export]')) { exportCsv(); return; }
      var dsub = t.closest('[data-delete-subject]');
      if (dsub) { deleteSubjectModal(dsub.getAttribute('data-delete-subject')); return; }
      var dsubOk = t.closest('[data-delete-subject-confirm]');
      if (dsubOk) {
        CM.apiAuth('admin_subjects', { action: 'delete', subjectId: parseInt(dsubOk.getAttribute('data-delete-subject-confirm'), 10) }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not delete the subject.'); return; }
          closeModal(); toast('Subject deleted.'); reload();
        });
        return;
      }
      var msec = t.closest('[data-manage-sections]');
      if (msec) { manageSectionsModal(msec.getAttribute('data-manage-sections')); return; }
      var sedit = t.closest('[data-section-edit]');
      if (sedit) { editSectionModal(sedit.getAttribute('data-section-edit')); return; }
      var secAct = t.closest('[data-section-delete], [data-section-hide]');
      if (secAct) {
        var isDel = secAct.hasAttribute('data-section-delete');
        var sid2 = parseInt(secAct.getAttribute(isDel ? 'data-section-delete' : 'data-section-hide'), 10);
        var subj = (DATA.sections.filter(function (r) { return r.schedule_id == sid2; })[0] || {}).subject_id;
        var payload = isDel ? { action: 'delete', scheduleId: sid2 } : { action: 'setActive', scheduleId: sid2, active: false };
        CM.apiAuth('admin_schedule', payload, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not update the section.'); return; }
          toast(isDel ? 'Section deleted.' : 'Section deactivated.');
          loadAll(function () { render(); manageSectionsModal(subj); });
        });
        return;
      }

      var editG = t.closest('[data-edit-grade]');
      if (editG) { setGradeEdit(editG.getAttribute('data-edit-grade')); return; }
      if (t.closest('[data-cancel-grade-edit]')) { loadGrades($('#grade-form').getAttribute('data-student')); return; }

      var gen = t.closest('[data-generate-sections]');
      if (gen && !gen.disabled) {
        gen.disabled = true;
        CM.apiAuth('admin_schedule', { action: 'generateMissing', curriculumId: DATA.curriculumId }, function (res) {
          if (!res.ok) { gen.disabled = false; toast(res.error || 'Could not create the schedules.'); return; }
          toast('Created ' + res.created + ' section' + (res.created === 1 ? '' : 's') + '.' +
            (res.skipped && res.skipped.length ? ' No free time for: ' + res.skipped.join(', ') + '.' : ''));
          reload();
        });
        return;
      }
      if (t.closest('[data-add-subject]')) { addSubjectModal(); return; }
      if (t.closest('[data-add-application]')) { addApplicationModal(); return; }
      if (t.closest('[data-change-term]')) { changeTermModal(); return; }
      var eapp = t.closest('[data-edit-app]');
      if (eapp) { editApplicationModal(eapp.getAttribute('data-edit-app')); return; }
      var dapp = t.closest('[data-delete-app]');
      if (dapp) { deleteApplicationModal(dapp.getAttribute('data-delete-app')); return; }
      var dappOk = t.closest('[data-delete-app-confirm], [data-delete-app-confirm-live]');
      if (dappOk) {
        var live = dappOk.hasAttribute('data-delete-app-confirm-live');
        var done = function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not delete the application.'); return; }
          closeModal(); toast('Application deleted.'); reload();
        };
        if (live) CM.apiAuth('admin_review', { action: 'delete', id: parseInt(dappOk.getAttribute('data-delete-app-confirm-live'), 10) }, done);
        else CM.apiAuth('admin_applications', { action: 'delete', id: parseInt(dappOk.getAttribute('data-delete-app-confirm'), 10) }, done);
        return;
      }
    });

    document.addEventListener('change', function (e) {
      if (e.target.id === 'sub-with-section') { $('#sub-section-fields').hidden = !e.target.checked; return; }
      if (e.target.id === 'college-pick') {
        DATA.collegeId = parseInt(e.target.value, 10);
        var first = programsOfCollege(DATA.collegeId)[0];
        DATA.curriculumId = first ? parseInt(first.curriculum_id, 10) : -1;
        curriculumQuery = '';
        loadSubjects(DATA.curriculumId, function () { render(); });
        return;
      }
      if (e.target.id === 'program-pick') {
        if (!parseInt(e.target.value, 10)) return;
        DATA.curriculumId = parseInt(e.target.value, 10);
        curriculumQuery = '';
        loadSubjects(DATA.curriculumId, function () { render(); });
      }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'add-form') {
        e.preventDefault();
        var type = $('#sub-type').value;
        var progSel = $('#sub-program');
        var prereq = $('#sub-prereq').value;
        CM.apiAuth('admin_subjects', {
          action: 'add', curriculumId: progSel ? parseInt(progSel.value, 10) : DATA.curriculumId,
          code: $('#sub-code').value, title: $('#sub-name').value, units: parseInt($('#sub-units').value, 10),
          isAcademic: type !== 'nstp', isLaboratory: type === 'lab',
          year: parseInt($('#sub-year').value, 10), semester: $('#sub-sem').value, prereqs: prereq ? [prereq] : [],
          section: $('#sub-with-section').checked ? { block: $('#sub-block').value, day: $('#sub-day').value, start: $('#sub-start').value,
            end: $('#sub-end').value, room: $('#sub-room').value, maxSlots: parseInt($('#sub-slots').value, 10) || 0 } : null
        }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not add the subject.'); return; }
          var code = $('#sub-code').value.trim();
          closeModal();
          var stm = res.sectionTerm;
          toast(code + ' added to the curriculum.' + (stm && !stm.openNow ? ' Its section opens in the ' + semLabel(stm.semester) + ' ' + stm.academicYear + '.' : ''));
          reload();
        });
        return;
      }
      if (e.target.id === 'app-form') {
        e.preventDefault();
        CM.apiAuth('admin_applications', { action: 'add', name: $('#app-name').value, program: $('#app-program').value }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not add the application.'); return; }
          closeModal(); toast('Application ' + res.code + ' added.'); reload();
        });
        return;
      }
      if (e.target.id === 'app-edit-form') {
        e.preventDefault();
        CM.apiAuth('admin_applications', { action: 'update', id: parseInt(e.target.getAttribute('data-id'), 10),
                                           name: $('#app-name').value, program: $('#app-program').value }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not save the application.'); return; }
          closeModal(); toast('Application updated.'); reload();
        });
        return;
      }
      if (e.target.id === 'term-form') {
        e.preventDefault();
        var ay = $('#term-ay').value.trim().replace(/[\u2010-\u2015\s]+/g, '-');      // accepts 2030-2031, 2030–2031 or just 2030
        if (/^\d{4}$/.test(ay)) ay = ay + '-' + (parseInt(ay, 10) + 1);
        CM.apiAuth('admin_term', { academicYear: ay, semester: $('#term-sem').value,
                                    enrollStart: $('#term-start').value, enrollEnd: $('#term-end').value }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not save the term.'); return; }
          closeModal(); toast('Term set to ' + semLabel(res.term.semester) + ', AY ' + dashYears(res.term.academicYear) + '.'); reload();
        });
        return;
      }
      if (e.target.id === 'section-edit-form') {
        e.preventDefault();
        var subj2 = e.target.getAttribute('data-subject');
        CM.apiAuth('admin_schedule', {
          action: 'update', scheduleId: parseInt(e.target.getAttribute('data-schedule'), 10),
          block: $('#se-block').value, day: $('#se-day').value, start: $('#se-start').value, end: $('#se-end').value,
          room: $('#se-room').value, maxSlots: parseInt($('#se-slots').value, 10) || 0
        }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not save the section.'); return; }
          toast('Section updated.');
          loadAll(function () { render(); manageSectionsModal(subj2); });
        });
        return;
      }
      if (e.target.id === 'section-form') {
        e.preventDefault();
        CM.apiAuth('admin_schedule', {
          action: 'add', subjectId: parseInt(e.target.getAttribute('data-subject'), 10),
          block: $('#sec-block').value, day: $('#sec-day').value, start: $('#sec-start').value, end: $('#sec-end').value,
          room: $('#sec-room').value, maxSlots: parseInt($('#sec-slots').value, 10) || 0
        }, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not add the section.'); return; }
          var subj3 = e.target.getAttribute('data-subject');
          toast(res.openNow === false ? 'Section added. Students can pick it in the ' + semLabel(res.semester) + ' ' + res.academicYear + '.' : 'Section added. Students can now pick it.');
          loadAll(function () { render(); manageSectionsModal(subj3); });
        });
        return;
      }
      if (e.target.id === 'grade-form') {
        e.preventDefault();
        var sid = e.target.getAttribute('data-student');
        var recId = parseInt(e.target.getAttribute('data-record'), 10) || 0;
        var payload = recId
          ? { student: sid, recordId: recId, grade: $('#gr-grade').value }
          : { student: sid, subjectId: parseInt($('#gr-subject').value, 10), grade: $('#gr-grade').value,
              academicYear: $('#gr-ay').value.trim(), semester: $('#gr-sem').value };
        CM.apiAuth('admin_grades', payload, function (res) {
          if (!res.ok) { showModalError(res.error || 'Could not save the grade.'); return; }
          toast(recId ? 'Grade updated.' : 'Grade saved.');
          loadGrades(sid);
        });
        return;
      }
    });

    // page searches filter the current page live (Applications, Students, Requests, Load forms, Curriculum)
    document.addEventListener('input', function (e) {
      if (e.target.id === 'page-search') {
        query = e.target.value;
        render();
        var ps = $('#page-search');
        if (ps) { ps.focus(); ps.setSelectionRange(ps.value.length, ps.value.length); }
        return;
      }
      if (e.target.id === 'curriculum-search') {
        curriculumQuery = e.target.value;
        render();
        var input = $('#curriculum-search');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }
    });

    window.addEventListener('hashchange', route);

    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeNotif(); closeModal(); } });

    // signing out in another tab signs this one out too
    window.addEventListener('storage', function (e) {
      if (e.key === CM.KEYS.session && !CM.getSession()) window.location.reload();
    });
  }

  // ---------- Start ----------
  mount('sprite', CM.SPRITE);
  mount('topbar', topbarHtml());
  mount('sidebar', sidebarHtml());
  main = $('#main');
  bind();
  route();             // shows "Loading…" straight away
  loadAll(render);
})();

/* Mobile tables: copy each column header onto its cells (data-label) so CSS can show them as stacked cards. */
(function () {
  'use strict';
  function labelTables() {
    var tables = document.querySelectorAll('.table-card .data-table');
    for (var t = 0; t < tables.length; t++) {
      var heads = tables[t].querySelectorAll('thead th');
      if (!heads.length) continue;
      var rows = tables[t].querySelectorAll('tbody tr');
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].children;
        for (var c = 0; c < cells.length; c++) {
          var label = heads[c] ? heads[c].textContent.trim() : '';
          if (cells[c].getAttribute('data-label') !== label) cells[c].setAttribute('data-label', label);
        }
      }
    }
  }
  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || window.setTimeout)(function () { queued = false; labelTables(); });
  }
  if (!window.MutationObserver) return;
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
})();
