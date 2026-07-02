/* HR Nurse System — SPA controller */
(() => {
  const { esc, el, toast, badge, fmtDate, age, openModal, closeModal, formHTML, collect } = UI;
  let me = null;
  let employeesCache = [];
  let lookupsCache = { department: [], position: [] };
  let branding = {};

  async function loadLookups() {
    try { lookupsCache = await API.get('/lookups'); } catch { lookupsCache = { department: [], position: [] }; }
    return lookupsCache;
  }
  const deptOptions = () => (lookupsCache.department || []).map((d) => d.value);
  const posOptions = () => (lookupsCache.position || []).map((p) => p.value);

  // Minimal CSV parser (handles quoted fields, commas, newlines)
  function parseCSV(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += c;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  // Reusable employee picker: a scrollable <select> list PLUS a search box that
  // filters it by name or ID number. collect() reads the select (name=employee_id).
  function empSearchFieldHTML(label = 'Employee', ph = 'Search name or ID number…') {
    const opts = employeesCache.map((e) =>
      `<option value="${e.id}">${esc(empName(e))}${e.emp_no ? ' · ' + esc(e.emp_no) : ''}${e.department ? ' · ' + esc(e.department) : ''}</option>`).join('');
    return `<div class="field full">
      <label>${esc(label)}</label>
      <input id="emp-search" placeholder="🔍 ${esc(ph)}" autocomplete="off" style="margin-bottom:6px" />
      <select id="emp-select" name="employee_id" size="8"><option value="">— select an employee —</option>${opts}</select>
    </div>`;
  }
  function wireEmpSearch() {
    const input = el('emp-search'); const sel = el('emp-select');
    if (!input || !sel) return;
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      [...sel.options].forEach((o) => { if (o.value) o.hidden = q && !o.textContent.toLowerCase().includes(q); });
    };
  }

  // Reusable attachments panel: upload (file or camera/scan), list, view, delete.
  // Files are stored on the server (see routes/files.js), NAS-relocatable via UPLOAD_DIR.
  async function mountAttachments(container, entityType, entityId, category) {
    if (!container) return;
    const render = async () => {
      let list = [];
      try { list = await API.get(`/files?entity_type=${entityType}&entity_id=${entityId}`); } catch { /* ignore */ }
      container.innerHTML = `
        <div class="pill-row" style="margin-bottom:8px">
          <label class="btn small soft" style="cursor:pointer;margin:0">📎 Add file<input type="file" accept="image/*,application/pdf" hidden data-up></label>
          <label class="btn small soft" style="cursor:pointer;margin:0">📷 Scan / photo<input type="file" accept="image/*" capture="environment" hidden data-up></label>
          <span class="muted small">PDF or image, up to 20&nbsp;MB. Stored on this server.</span>
        </div>
        ${list.length ? `<table><tbody>${list.map((f) => `<tr>
            <td><a class="link" href="/api/files/${f.id}/download" target="_blank">${esc(f.filename)}</a>
              <span class="muted small">${(f.size / 1024).toFixed(0)} KB${f.category ? ' · ' + esc(f.category) : ''} · ${esc(String(f.created_at).slice(0, 10))}</span></td>
            <td style="text-align:right"><a class="link small" href="/api/files/${f.id}/download?dl=1">download</a> &nbsp;·&nbsp; <a class="link small" data-del-file="${f.id}">delete</a></td>
          </tr>`).join('')}</tbody></table>` : '<p class="muted small">No files attached yet.</p>'}`;
      container.querySelectorAll('[data-up]').forEach((inp) => inp.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast('File too large (max 20 MB)', 'err'); return; }
        const rd = new FileReader();
        rd.onload = async () => {
          try { await API.post('/files', { entity_type: entityType, entity_id: entityId, category: category || '', filename: file.name, mime: file.type, data: String(rd.result) }); toast('File uploaded'); render(); }
          catch (err) { toast(err.message, 'err'); }
        };
        rd.readAsDataURL(file);
      });
      container.querySelectorAll('[data-del-file]').forEach((a) => a.onclick = async () => {
        if (!confirm('Delete this file?')) return; await API.del('/files/' + a.dataset.delFile); toast('Deleted'); render();
      });
    };
    await render();
  }

  // ---------------- Auth / boot ----------------
  async function boot() {
    try { branding = await API.get('/settings/public'); UI.applyBranding(branding); } catch { /* defaults */ }
    try {
      const r = await API.get('/auth/me');
      me = r.user;
      showApp();
    } catch {
      showLogin();
    }
  }

  function showLogin() {
    el('app').classList.add('hidden');
    el('login-view').classList.remove('hidden');
  }
  function showApp() {
    el('login-view').classList.add('hidden');
    el('app').classList.remove('hidden');
    el('who').textContent = `${me.name} (${me.role})`;
    if (me.role === 'employee' || me.role === 'applicant') {
      Portal.show(me);
    } else {
      if (me.role === 'admin') ensureAdminNav();
      const start = (location.hash || '').replace('#', '');
      route(VIEWS[start] ? start : 'dashboard'); // restore last view after a refresh
    }
    if (me.must_change_pw) setTimeout(() => el('changepw').click(), 400);
  }

  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = collect(e.target);
    el('login-error').textContent = '';
    try {
      const r = await API.post('/auth/login', { username: f.username, password: f.password });
      API.setToken(r.token);
      me = r.user;
      showApp();
    } catch (err) {
      el('login-error').textContent = err.message;
    }
  });

  el('logout').addEventListener('click', async () => {
    await API.post('/auth/logout');
    location.reload();
  });

  el('changepw').addEventListener('click', () => {
    openModal('Change password', `
      <form id="pw-form">
        ${formHTML([
          { name: 'current', label: 'Current password', type: 'password', full: true },
          { name: 'next', label: 'New password (min 6 chars)', type: 'password', full: true },
        ])}
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Update</button></div>
      </form>`);
    el('pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = collect(e.target);
      try { await API.post('/auth/change-password', f); closeModal(); toast('Password updated'); }
      catch (err) { toast(err.message, 'err'); }
    });
  });

  el('modal-close').addEventListener('click', closeModal);
  // Intentionally NOT closing on backdrop click — prevents losing form input by accident.
  // Use the ✕ button or Cancel to close. Esc also closes.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('modal').classList.contains('hidden')) closeModal(); });

  // ---------------- Routing ----------------
  const TITLES = {
    dashboard: 'Dashboard', employees: 'Employees', ape: 'APE / Physical Exams',
    newhire: 'New-Hire Clearance', clinic: 'Clinic Visits', meds: 'Medications',
    messages: 'Messages', sms: 'SMS Blast', reports: 'Reports', admin: 'Control Panel',
  };
  function ensureAdminNav() {
    if (document.querySelector('#nav a[data-route="admin"]')) return;
    const a = document.createElement('a');
    a.dataset.route = 'admin';
    a.innerHTML = '⚙️ Control Panel';
    el('nav').appendChild(a);
  }
  el('nav').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-route]');
    if (!a) return;
    route(a.dataset.route);
  });
  function setActive(r) {
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
    el('page-title').textContent = TITLES[r] || '';
    el('topbar-actions').innerHTML = '';
  }
  async function route(r) {
    if (('#' + r) !== location.hash) location.hash = r; // remember view across refresh
    setActive(r);
    // Replace #view with a fresh node so click-handlers attached by the previous
    // screen are discarded (prevents e.g. the Medications handler firing on the
    // Employees screen). All views re-query el('view') so this is transparent.
    const old = el('view');
    const fresh = old.cloneNode(false);
    old.parentNode.replaceChild(fresh, old);
    fresh.innerHTML = '<p class="muted">Loading…</p>';
    try { await VIEWS[r](); }
    catch (err) { el('view').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }

  function action(label, fn, cls = 'primary') {
    const b = document.createElement('button');
    b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn;
    el('topbar-actions').appendChild(b);
  }

  async function loadEmployees() {
    employeesCache = await API.get('/employees');
    return employeesCache;
  }
  const empName = (e) => `${e.last_name}, ${e.first_name}`;
  const empOptions = () => employeesCache.map((e) => ({ value: e.id, label: `${empName(e)}${e.emp_no ? ' (' + e.emp_no + ')' : ''}` }));

  // ---------------- Views ----------------
  const VIEWS = {};

  // Dashboard
  VIEWS.dashboard = async () => {
    const d = await API.get('/reports/dashboard');
    const cards = [
      ['Active Employees', d.totalEmp, ''],
      ['Fit (latest APE)', d.fit, 'good'],
      ['Unfit / Restricted', d.unfit, d.unfit ? 'warn' : ''],
      ['APE Overdue', d.overdue, d.overdue ? 'alert' : 'good'],
      ['No APE Record', d.noRecord, d.noRecord ? 'warn' : ''],
      ['Pending Clearances', d.pendingClearance, d.pendingClearance ? 'warn' : ''],
      ['Visits This Month', d.visitsThisMonth, ''],
      ['Follow-ups Due', d.followups, d.followups ? 'warn' : ''],
      ['Low Stock Meds', d.lowStock, d.lowStock ? 'alert' : 'good'],
    ];
    el('view').innerHTML = `
      <div class="cards">${cards.map(([k, v, c]) =>
        `<div class="card ${c}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>APE Compliance by Department</h3></div>
          <div class="panel-body"><canvas id="ch-comp" height="200"></canvas></div></div>
        <div class="panel"><div class="panel-head"><h3>Fitness Status (latest exam)</h3></div>
          <div class="panel-body"><canvas id="ch-fit" height="200"></canvas></div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Top Clinic Complaints</h3></div>
          <div class="panel-body"><canvas id="ch-comp2" height="200"></canvas></div></div>
        <div class="panel"><div class="panel-head"><h3>Upcoming / Overdue APE</h3></div>
          <div class="panel-body" id="due-list"></div></div>
      </div>`;

    const [comp, fit, complaints, due] = await Promise.all([
      API.get('/reports/ape-compliance'), API.get('/reports/fitness-distribution'),
      API.get('/reports/top-complaints'), API.get('/ape/due?days=60'),
    ]);
    chartBar('ch-comp', comp.map((c) => c.department), comp.map((c) => c.rate), 'Compliance %', '#1a7f6b');
    chartDoughnut('ch-fit', fit.map((f) => (f.status || 'none').replace(/_/g, ' ')), fit.map((f) => f.n));
    chartBar('ch-comp2', complaints.map((c) => c.complaint), complaints.map((c) => c.n), 'Visits', '#2563eb');
    el('due-list').innerHTML = due.length ? `<table><thead><tr><th>Employee</th><th>Dept</th><th>Due</th><th>Status</th></tr></thead><tbody>${
      due.slice(0, 12).map((r) => `<tr><td>${esc(r.last_name)}, ${esc(r.first_name)}</td><td>${esc(r.department || '—')}</td><td>${fmtDate(r.next_due)}</td><td>${badge(r.state)}</td></tr>`).join('')
    }</tbody></table>` : '<p class="empty">Everyone is up to date 🎉</p>';
  };

  // Employees
  VIEWS.employees = async () => {
    action('+ Add Employee', () => empForm());
    action('⬆ Bulk upload', () => bulkUploadModal(), 'soft');
    action('⬇ Template', () => downloadEmpTemplate(), 'soft');
    await Promise.all([loadEmployees(), loadLookups()]);
    renderEmployees(employeesCache);
  };

  const IMPORT_COLS = ['emp_no', 'first_name', 'last_name', 'sex', 'birthdate', 'department', 'position', 'date_hired', 'status', 'blood_type', 'phone', 'email', 'address', 'emergency_contact', 'emergency_phone', 'allergies', 'chronic_conditions'];
  function downloadEmpTemplate() {
    const sample = ['1001', 'Juan', 'Dela Cruz', 'M', '1990-05-20', 'Production', 'Line Operator', '2024-01-15', 'active', 'O+', '09171234567', 'juan@example.com', 'Cebu City', 'Maria Dela Cruz', '09181234567', 'None', 'None'];
    const csv = IMPORT_COLS.join(',') + '\n' + sample.map((c) => `"${c}"`).join(',') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'employee-import-template.csv'; a.click();
    toast('Template downloaded — keep the header row, employee ID must be numbers only');
  }
  function bulkUploadModal() {
    openModal('Bulk upload employees', `
      <p class="muted small">Upload a CSV using the template. First row must be the column headers. Employee ID must be numbers only. Existing IDs are skipped.</p>
      <div class="field full"><label>CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv" /></div>
      <div id="csv-preview"></div>
      <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary" id="csv-import" disabled>Import</button></div>`);
    let parsedRows = [];
    el('csv-file').onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const rows = parseCSV(String(reader.result));
        if (rows.length < 2) { el('csv-preview').innerHTML = '<p class="error">No data rows found.</p>'; return; }
        const header = rows[0].map((h) => h.trim());
        parsedRows = rows.slice(1).map((r) => { const o = {}; header.forEach((h, i) => { if (IMPORT_COLS.includes(h)) o[h] = (r[i] || '').trim(); }); return o; });
        const bad = parsedRows.filter((r) => r.emp_no && !/^\d+$/.test(r.emp_no)).length;
        el('csv-preview').innerHTML = `<p class="small">${parsedRows.length} row(s) ready.${bad ? ` <span class="error">${bad} have a non-numeric ID and will be skipped.</span>` : ''}</p>
          <table><thead><tr>${['emp_no', 'first_name', 'last_name', 'department', 'position'].map((c) => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${parsedRows.slice(0, 5).map((r) => `<tr>${['emp_no', 'first_name', 'last_name', 'department', 'position'].map((c) => `<td>${esc(r[c] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
          ${parsedRows.length > 5 ? `<p class="muted small">…and ${parsedRows.length - 5} more</p>` : ''}`;
        el('csv-import').disabled = false;
      };
      reader.readAsText(file);
    };
    el('csv-import').onclick = async () => {
      if (!parsedRows.length) return;
      try {
        const r = await API.post('/employees/import', { rows: parsedRows });
        closeModal();
        toast(`Imported ${r.inserted}, skipped ${r.skipped}`);
        if (r.errors && r.errors.length) alert('Some rows were skipped:\n\n' + r.errors.slice(0, 20).join('\n'));
        await loadEmployees(); renderEmployees(employeesCache);
      } catch (err) { toast(err.message, 'err'); }
    };
  }
  function renderEmployees(list) {
    el('view').innerHTML = `
      <div class="toolbar">
        <input id="emp-q" placeholder="Search name or emp #…" />
        <select id="emp-status"><option value="">All status</option><option>active</option><option>inactive</option></select>
        <span class="spacer"></span><span class="muted small">${list.length} record(s)</span>
      </div>
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Emp #</th><th>Name</th><th>Dept</th><th>Position</th><th>Age</th><th>Status</th><th></th></tr></thead>
        <tbody id="emp-rows"></tbody></table></div></div>`;
    const draw = (rows) => {
      el('emp-rows').innerHTML = rows.length ? rows.map((e) => `
        <tr>
          <td>${esc(e.emp_no || '—')}</td>
          <td><a class="link" data-emp="${e.id}">${esc(empName(e))}</a></td>
          <td>${esc(e.department || '—')}</td>
          <td>${esc(e.position || '—')}</td>
          <td>${age(e.birthdate) || '—'}</td>
          <td>${badge(e.status)}</td>
          <td><div class="row-act">
            <button class="btn small" data-edit="${e.id}">Edit</button>
            <button class="btn small danger" data-del="${e.id}">Del</button>
          </div></td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty">No employees.</td></tr>';
    };
    draw(list);
    const filter = () => {
      const q = el('emp-q').value.toLowerCase(); const s = el('emp-status').value;
      draw(employeesCache.filter((e) =>
        (!q || (empName(e).toLowerCase().includes(q) || (e.emp_no || '').toLowerCase().includes(q))) &&
        (!s || e.status === s)));
    };
    el('emp-q').oninput = filter; el('emp-status').onchange = filter;
    el('emp-rows').addEventListener('click', async (e) => {
      const v = e.target.closest('[data-emp]'); const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (v) return empProfile(v.dataset.emp);
      if (ed) return empForm(employeesCache.find((x) => x.id == ed.dataset.edit));
      if (dl) {
        if (!confirm('Delete this employee and all their health records?')) return;
        await API.del('/employees/' + dl.dataset.del); toast('Deleted'); await loadEmployees(); renderEmployees(employeesCache);
      }
    });
  }
  function empForm(e = {}) {
    const fields = [
      { name: 'emp_no', label: 'Employee ID (numbers only)', ph: 'e.g. 1001' }, { name: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'], default: 'active' },
      { name: 'first_name', label: 'First name', required: true }, { name: 'last_name', label: 'Last name', required: true },
      { name: 'sex', label: 'Sex', type: 'select', options: ['', 'M', 'F'] }, { name: 'birthdate', label: 'Birthdate', type: 'date' },
      { name: 'department', label: 'Department', type: 'datalist', options: deptOptions() }, { name: 'position', label: 'Position', type: 'datalist', options: posOptions() },
      { name: 'date_hired', label: 'Date hired', type: 'date' }, { name: 'blood_type', label: 'Blood type' },
      { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', full: true },
      { name: 'emergency_contact', label: 'Emergency contact' }, { name: 'emergency_phone', label: 'Emergency phone' },
      { name: 'allergies', label: 'Allergies', full: true }, { name: 'chronic_conditions', label: 'Chronic conditions', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true },
    ];
    openModal(e.id ? 'Edit Employee' : 'Add Employee', `
      <form id="emp-form"><div class="form-grid">${formHTML(fields, e)}</div>
      <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Save</button></div></form>`);
    el('emp-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const data = collect(ev.target);
      if (data.emp_no && !/^\d+$/.test(String(data.emp_no).trim())) { toast('Employee ID must be numbers only', 'err'); return; }
      try {
        if (e.id) await API.put('/employees/' + e.id, data); else await API.post('/employees', data);
        closeModal(); toast('Saved'); await loadEmployees(); renderEmployees(employeesCache);
      } catch (err) { toast(err.message, 'err'); }
    });
  }
  async function empProfile(id) {
    const e = await API.get('/employees/' + id);
    openModal(`${empName(e)} ${e.emp_no ? '· ' + e.emp_no : ''}`, `
      <div class="form-grid">
        <div><div class="k muted small">Department</div>${esc(e.department || '—')}</div>
        <div><div class="k muted small">Position</div>${esc(e.position || '—')}</div>
        <div><div class="k muted small">Age / Sex</div>${age(e.birthdate) || '—'} / ${esc(e.sex || '—')}</div>
        <div><div class="k muted small">Blood type</div>${esc(e.blood_type || '—')}</div>
        <div><div class="k muted small">Phone</div>${esc(e.phone || '—')}</div>
        <div><div class="k muted small">Email</div>${esc(e.email || '—')}</div>
        <div class="field full"><div class="k muted small">Allergies</div>${esc(e.allergies || '—')}</div>
        <div class="field full"><div class="k muted small">Chronic conditions</div>${esc(e.chronic_conditions || '—')}</div>
      </div>
      <div class="section-title">APE History (${e.ape.length})</div>
      ${e.ape.length ? `<table><thead><tr><th>Date</th><th>Type</th><th>BMI</th><th>BP</th><th>Fitness</th><th>Next due</th></tr></thead><tbody>${
        e.ape.map((a) => `<tr><td>${fmtDate(a.exam_date)}</td><td>${esc(a.exam_type)}</td><td>${a.bmi || '—'}</td><td>${esc(a.bp || '—')}</td><td>${badge(a.fitness_status)}</td><td>${fmtDate(a.next_due)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted small">No exams yet.</p>'}
      <div class="section-title">Recent Clinic Visits (${e.visits.length})</div>
      ${e.visits.length ? `<table><thead><tr><th>Date</th><th>Complaint</th><th>Disposition</th></tr></thead><tbody>${
        e.visits.slice(0, 8).map((v) => `<tr><td>${fmtDate(v.visit_date)}</td><td>${esc(v.complaint || '—')}</td><td>${badge(v.disposition)}</td></tr>`).join('')
      }</tbody></table>` : '<p class="muted small">No visits yet.</p>'}
      <div class="section-title">Portal Account</div>
      <div id="acct-box" class="muted small">Loading…</div>`);
    renderAccountBox(id);
  }
  async function renderAccountBox(id) {
    const box = document.getElementById('acct-box');
    if (!box) return;
    const a = await API.get(`/employees/${id}/account`);
    if (!a) {
      box.innerHTML = `<p>No login yet. Give this person access to the self-service portal:</p>
        <div class="pill-row">
          <button class="btn small primary" data-create="employee">Create Employee login</button>
          <button class="btn small" data-create="applicant">Create New-Hire login</button>
        </div>`;
    } else {
      box.innerHTML = `<div class="form-grid">
          <div><div class="k muted small">Username</div>${esc(a.username)}</div>
          <div><div class="k muted small">Role</div>${badge(a.role)}</div>
          <div><div class="k muted small">Status</div>${badge(a.active ? 'active' : 'inactive')}</div>
        </div>
        <div class="pill-row" style="margin-top:10px">
          <button class="btn small" data-reset>Reset password</button>
          <button class="btn small ${a.active ? 'danger' : ''}" data-toggle="${a.active ? 0 : 1}">${a.active ? 'Disable' : 'Enable'}</button>
        </div>`;
    }
    box.onclick = async (ev) => {
      const c = ev.target.closest('[data-create]'); const r = ev.target.closest('[data-reset]'); const t = ev.target.closest('[data-toggle]');
      try {
        if (c) { const res = await API.post(`/employees/${id}/account`, { role: c.dataset.create }); showCreds('Account created', res); renderAccountBox(id); }
        if (r) { if (!confirm('Reset this account\'s password?')) return; const res = await API.post(`/employees/${id}/account/reset`); showCreds('Password reset', res); }
        if (t) { await API.put(`/employees/${id}/account`, { active: t.dataset.toggle === '1' }); toast('Updated'); renderAccountBox(id); }
      } catch (err) { toast(err.message, 'err'); }
    };
  }
  function showCreds(title, res) {
    alert(`${title}\n\nUsername: ${res.username || '(unchanged)'}\nTemporary password: ${res.password}\n\n${res.note || ''}`);
  }

  // APE
  VIEWS.ape = async () => {
    action('+ Record Exam', () => apeForm());
    await loadEmployees();
    const recs = await API.get('/ape');
    el('view').innerHTML = `
      <div class="toolbar">
        <select id="ape-f"><option value="">All fitness</option><option>fit</option><option>fit_with_restriction</option><option>unfit</option><option>pending</option></select>
        <span class="spacer"></span><span class="muted small">${recs.length} exam(s)</span>
      </div>
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Date</th><th>Employee</th><th>Type</th><th>BMI</th><th>BP</th><th>Fitness</th><th>Next due</th><th></th></tr></thead>
        <tbody id="ape-rows"></tbody></table></div></div>`;
    const draw = (rows) => el('ape-rows').innerHTML = rows.length ? rows.map((a) => `
      <tr><td>${fmtDate(a.exam_date)}</td><td>${esc(a.last_name)}, ${esc(a.first_name)}</td><td>${esc(a.exam_type)}</td>
      <td>${a.bmi || '—'}</td><td>${esc(a.bp || '—')}</td><td>${badge(a.fitness_status)}</td><td>${fmtDate(a.next_due)}</td>
      <td><div class="row-act"><button class="btn small" data-edit="${a.id}">Edit</button><button class="btn small danger" data-del="${a.id}">Del</button></div></td></tr>`).join('')
      : '<tr><td colspan="8" class="empty">No exams recorded.</td></tr>';
    draw(recs);
    el('ape-f').onchange = () => draw(el('ape-f').value ? recs.filter((r) => r.fitness_status === el('ape-f').value) : recs);
    el('ape-rows').addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (ed) { const rec = await API.get('/ape/' + ed.dataset.edit); return apeForm(rec); }
      if (dl) { if (!confirm('Delete exam record?')) return; await API.del('/ape/' + dl.dataset.del); toast('Deleted'); route('ape'); }
    });
  };
  function apeForm(a = {}) {
    const fields = [
      { name: 'exam_date', label: 'Exam date', type: 'date', required: true }, { name: 'exam_type', label: 'Type', type: 'select', options: ['annual', 'pre-employment', 'special', 'return-to-work'] },
      { name: 'height_cm', label: 'Height (cm)', type: 'number', step: '0.1' }, { name: 'weight_kg', label: 'Weight (kg)', type: 'number', step: '0.1' },
      { name: 'bp', label: 'Blood pressure' }, { name: 'pulse', label: 'Pulse', type: 'number' },
      { name: 'temperature', label: 'Temp (°C)', type: 'number', step: '0.1' }, { name: 'resp_rate', label: 'Resp rate', type: 'number' },
      { name: 'vision', label: 'Vision' }, { name: 'hearing', label: 'Hearing' },
      { name: 'cbc', label: 'CBC' }, { name: 'urinalysis', label: 'Urinalysis' },
      { name: 'fecalysis', label: 'Fecalysis' }, { name: 'chest_xray', label: 'Chest X-ray' },
      { name: 'ecg', label: 'ECG' }, { name: 'drug_test', label: 'Drug test' },
      { name: 'blood_chem', label: 'Blood chemistry', full: true },
      { name: 'findings', label: 'Findings / impression', type: 'textarea', full: true },
      { name: 'fitness_status', label: 'Fitness status', type: 'select', options: ['pending', 'fit', 'fit_with_restriction', 'unfit'] },
      { name: 'next_due', label: 'Next exam due', type: 'date' },
      { name: 'examiner', label: 'Examiner / physician' },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ];
    const preset = a.id ? employeesCache.find((x) => x.id == a.employee_id) : null;
    openModal(a.id ? 'Edit Exam' : 'Record Annual Physical Exam', `
      <form id="ape-form">
        ${empSearchFieldHTML('Employee (search by name or ID number)')}
        <div class="form-grid">${formHTML(fields, a)}</div>
        <p class="muted small">${esc(branding.note_ape || 'BMI is auto-computed from height & weight. For annual exams, next-due defaults to +1 year.')}</p>
        ${a.id ? '<div class="section-title">Attached records (labs, X-ray, ECG…)</div><div id="ape-files"></div>'
          : '<p class="muted small">💾 Save the exam first, then re-open it to attach lab results, X-ray, or ECG documents.</p>'}
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Save</button></div></form>`);
    wireEmpSearch();
    if (preset) el('emp-select').value = preset.id;
    if (a.id) mountAttachments(el('ape-files'), 'ape', a.id, a.exam_type || 'APE');
    el('ape-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!el('emp-select').value) { toast('Please select an employee', 'err'); return; }
      try { const d = collect(ev.target); if (a.id) await API.put('/ape/' + a.id, d); else await API.post('/ape', d); closeModal(); toast('Saved'); route('ape'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  // New-hire clearance
  VIEWS.newhire = async () => {
    action('+ New Clearance', () => clearanceForm());
    action('Manage Requirements', () => templatesModal(), 'soft');
    await loadEmployees();
    const list = await API.get('/newhire');
    el('view').innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Applicant</th><th>Position</th><th>Requested</th><th>Target start</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.length ? list.map((c) => `<tr>
          <td><a class="link" data-open="${c.id}">${esc(c.last_name)}, ${esc(c.first_name)}</a></td>
          <td>${esc(c.position_applied || '—')}</td><td>${fmtDate(c.requested_date)}</td><td>${fmtDate(c.target_start_date)}</td>
          <td>${badge(c.status)}</td>
          <td><div class="row-act"><button class="btn small" data-open="${c.id}">Open</button><button class="btn small danger" data-del="${c.id}">Del</button></div></td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty">No clearances yet.</td></tr>'}</tbody></table></div></div>`;
    el('view').addEventListener('click', async (e) => {
      const op = e.target.closest('[data-open]'); const dl = e.target.closest('[data-del]');
      if (op) return clearanceDetail(op.dataset.open);
      if (dl) { if (!confirm('Delete clearance?')) return; await API.del('/newhire/' + dl.dataset.del); toast('Deleted'); route('newhire'); }
    });
  };
  function clearanceForm() {
    const fields = [
      { name: 'position_applied', label: 'Position applied for', type: 'datalist', options: posOptions() }, { name: 'target_start_date', label: 'Target start date', type: 'date' },
      { name: 'requested_date', label: 'Requested date', type: 'date', default: new Date().toISOString().slice(0, 10) },
      { name: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ];
    openModal('New-Hire Medical Clearance', `
      <form id="cl-form">
        ${empSearchFieldHTML('Applicant (search by name or ID; add as Employee first)')}
        <div class="form-grid">${formHTML(fields)}</div>
        <p class="muted small">${esc(branding.note_newhire || 'The standard requirement checklist (Neuro, Chest X-ray, Drug test, CBC, etc.) is added automatically. Configure it via "Manage Requirements".')}</p>
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Create</button></div></form>`);
    wireEmpSearch();
    el('cl-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!el('emp-select').value) { toast('Please select an applicant', 'err'); return; }
      try { const c = await API.post('/newhire', collect(ev.target)); closeModal(); toast('Clearance created'); clearanceDetail(c.id); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  async function clearanceDetail(id) {
    const c = await API.get('/newhire/' + id);
    const done = c.items.filter((i) => i.status === 'passed' || i.status === 'waived').length;
    const pct = c.items.length ? Math.round((done / c.items.length) * 100) : 0;
    openModal(`Clearance · ${esc(c.employee.last_name)}, ${esc(c.employee.first_name)}`, `
      <div class="form-grid">
        <div><div class="k muted small">Position</div>${esc(c.position_applied || '—')}</div>
        <div><div class="k muted small">Overall</div>${badge(c.status)}</div>
        <div><div class="k muted small">Requested</div>${fmtDate(c.requested_date)}</div>
        <div><div class="k muted small">Target start</div>${fmtDate(c.target_start_date)}</div>
      </div>
      <div class="section-title">Progress — ${done}/${c.items.length} (${pct}%)</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="section-title">Requirements</div>
      <div id="items">${c.items.map((i) => `
        <div class="checklist-item">
          <div>${esc(i.requirement)} ${i.required ? '' : '<span class="muted small">(optional)</span>'}<div class="muted small">${esc(i.category || '')}</div></div>
          <select data-item="${i.id}">
            ${['pending', 'passed', 'failed', 'waived'].map((s) => `<option ${i.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <div style="display:flex;gap:6px;align-items:center">
            <input data-note="${i.id}" placeholder="result / note" value="${esc(i.result_value || '')}" style="width:130px" />
            <button type="button" class="btn small soft" data-files="${i.id}" data-req="${esc(i.requirement)}" title="Upload documents for this requirement">📎</button>
          </div>
        </div>`).join('')}</div>
      <div id="item-files" style="margin-top:6px"></div>
      ${c.status === 'cleared' ? `<div class="panel" style="margin-top:14px;border-color:#bbf7d0"><div class="panel-body">
        <b>✅ Cleared.</b> <span class="muted small">Convert this applicant into a regular employee — sets their status to active and upgrades their portal login to Employee.</span>
        <div style="margin-top:8px"><button class="btn primary" id="hire-btn">Convert to regular employee</button></div></div></div>`
        : c.status === 'hired' ? '<p class="small" style="margin-top:12px"><span class="badge active">hired</span> This applicant is now a regular employee.</p>' : ''}
      <div class="modal-actions"><button class="btn" onclick="UI.closeModal()">Close</button></div>`);
    el('items').addEventListener('click', (e) => {
      const fb = e.target.closest('[data-files]'); if (!fb) return;
      el('item-files').innerHTML = `<div class="section-title">📎 Documents for: ${esc(fb.dataset.req)}</div><div id="if-inner"></div>`;
      mountAttachments(el('if-inner'), 'newhire_item', fb.dataset.files, fb.dataset.req);
      el('item-files').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    el('items').addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-item]');
      if (!sel) return;
      const note = el('items').querySelector(`[data-note="${sel.dataset.item}"]`).value;
      try {
        const r = await API.put(`/newhire/${id}/items/${sel.dataset.item}`, { status: sel.value, result_value: note, result_date: new Date().toISOString().slice(0, 10) });
        toast('Updated — clearance: ' + r.status);
        if (r.status === 'cleared' || r.status === 'failed') clearanceDetail(id); // refresh to reveal hire button
      } catch (err) { toast(err.message, 'err'); }
    });
    const hb = document.getElementById('hire-btn');
    if (hb) hb.onclick = async () => {
      if (!confirm('Convert this applicant to a regular employee?')) return;
      try { await API.post(`/newhire/${id}/hire`); toast('Converted to employee'); closeModal(); route('newhire'); }
      catch (err) { toast(err.message, 'err'); }
    };
  }
  async function templatesModal() {
    const t = await API.get('/newhire/templates');
    openModal('New-Hire Requirement Templates', `
      <p class="muted small">These items are auto-added to every new clearance.</p>
      <div id="tpl-list">${t.map((x) => `<div class="checklist-item"><div>${esc(x.name)} <span class="muted small">${esc(x.category || '')}${x.required ? '' : ' · optional'}</span></div><div></div><button class="btn small danger" data-rm="${x.id}">Remove</button></div>`).join('')}</div>
      <div class="section-title">Add requirement</div>
      <form id="tpl-form"><div class="form-grid">
        ${formHTML([{ name: 'name', label: 'Requirement', required: true }, { name: 'category', label: 'Category' },
          { name: 'required', label: 'Required?', type: 'select', options: [{ value: '1', label: 'Required' }, { value: '0', label: 'Optional' }] }])}
      </div><div class="modal-actions"><button class="btn primary">Add</button></div></form>`);
    el('tpl-list').addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm]'); if (!rm) return;
      await API.del('/newhire/templates/' + rm.dataset.rm); toast('Removed'); templatesModal();
    });
    el('tpl-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = collect(e.target);
      await API.post('/newhire/templates', { name: f.name, category: f.category, required: f.required === '1' });
      toast('Added'); templatesModal();
    });
  }

  // Clinic
  VIEWS.clinic = async () => {
    action('+ New Visit', () => visitForm());
    await loadEmployees();
    const [visits, followups] = await Promise.all([API.get('/clinic/visits'), API.get('/clinic/followups?days=14')]);
    el('view').innerHTML = `
      ${followups.length ? `<div class="panel"><div class="panel-head"><h3>⏰ Follow-ups due (next 14 days)</h3></div>
        <div class="panel-body" style="padding:0"><table><thead><tr><th>Employee</th><th>Follow-up</th><th>For</th><th></th></tr></thead><tbody>${
          followups.map((f) => `<tr><td>${esc(f.last_name)}, ${esc(f.first_name)}</td><td>${fmtDate(f.follow_up_date)}</td><td>${esc(f.complaint || '—')}</td>
          <td><button class="btn small" data-msg="${f.employee_id}">Message</button></td></tr>`).join('')
        }</tbody></table></div></div>` : ''}
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Date</th><th>Employee</th><th>Complaint</th><th>Assessment</th><th>Disposition</th><th>Follow-up</th><th></th></tr></thead>
        <tbody>${visits.length ? visits.map((v) => `<tr>
          <td>${fmtDate(v.visit_date)}</td><td>${esc(v.last_name)}, ${esc(v.first_name)}</td><td>${esc(v.complaint || '—')}</td>
          <td>${esc(v.assessment || '—')}</td><td>${badge(v.disposition)}</td><td>${fmtDate(v.follow_up_date)}</td>
          <td><button class="btn small danger" data-del="${v.id}">Del</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No visits logged.</td></tr>'}
        </tbody></table></div></div>`;
    el('view').addEventListener('click', async (e) => {
      const dl = e.target.closest('[data-del]'); const mg = e.target.closest('[data-msg]');
      if (dl) { if (!confirm('Delete visit?')) return; await API.del('/clinic/visits/' + dl.dataset.del); toast('Deleted'); route('clinic'); }
      if (mg) { route('messages'); setTimeout(() => composeMessage('individual', [Number(mg.dataset.msg)]), 50); }
    });
  };
  async function visitForm() {
    const meds = await API.get('/clinic/medications');
    const fields = [
      { name: 'employee_id', label: 'Employee', type: 'select', options: [{ value: '', label: '— select —' }, ...empOptions()], required: true, full: true },
      { name: 'complaint', label: 'Chief complaint', full: true },
      { name: 'bp', label: 'BP' }, { name: 'temperature', label: 'Temp (°C)', type: 'number', step: '0.1' },
      { name: 'pulse', label: 'Pulse', type: 'number' }, { name: 'attended_by', label: 'Attended by' },
      { name: 'assessment', label: 'Assessment', type: 'textarea', full: true },
      { name: 'treatment', label: 'Treatment given', type: 'textarea', full: true },
      { name: 'disposition', label: 'Disposition', type: 'select', options: ['', 'back_to_work', 'sent_home', 'referred'] },
      { name: 'follow_up_date', label: 'Follow-up date', type: 'date' },
    ];
    openModal('New Clinic Visit', `
      <form id="v-form"><div class="form-grid">${formHTML(fields)}</div>
        <div class="section-title">Dispense medication (optional)</div>
        <div class="form-grid">
          <div class="field"><label>Medicine</label><select id="med-sel"><option value="">— none —</option>${meds.map((m) => `<option value="${m.id}">${esc(m.name)} (stock ${m.stock})</option>`).join('')}</select></div>
          <div class="field"><label>Quantity</label><input id="med-qty" type="number" min="1" value="1" /></div>
        </div>
        ${branding.note_clinic ? `<p class="muted small">${esc(branding.note_clinic)}</p>` : ''}
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Save visit</button></div>
      </form>`);
    el('v-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = collect(ev.target);
      const medId = el('med-sel').value; const qty = parseInt(el('med-qty').value || '0', 10);
      if (medId && qty > 0) d.dispense = [{ medication_id: Number(medId), quantity: qty }];
      try { await API.post('/clinic/visits', d); closeModal(); toast('Visit saved'); route('clinic'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  // Medications
  VIEWS.meds = async () => {
    action('+ Add Medicine', () => medForm());
    const meds = await API.get('/clinic/medications');
    el('view').innerHTML = `
      <div class="toolbar"><input id="med-q" placeholder="🔍 Search medicine…" /><span class="spacer"></span><span class="muted small">${meds.length} item(s)</span></div>
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Name</th><th>Form</th><th>Stock</th><th>Reorder ≤</th><th>Expiry</th><th></th></tr></thead>
        <tbody id="med-rows"></tbody></table></div></div>`;
    const draw = (rows) => el('med-rows').innerHTML = rows.length ? rows.map((m) => `<tr>
          <td>${esc(m.name)}</td><td>${esc(m.form || '—')}</td>
          <td>${m.stock} ${m.stock <= m.reorder_level ? '<span class="badge overdue">low</span>' : ''}</td>
          <td>${m.reorder_level}</td><td>${fmtDate(m.expiry)}</td>
          <td><div class="row-act"><button class="btn small" data-restock="${m.id}">Restock</button><button class="btn small" data-edit="${m.id}">Edit</button><button class="btn small danger" data-del="${m.id}">Del</button></div></td>
        </tr>`).join('') : '<tr><td colspan="6" class="empty">No medicines match.</td></tr>';
    draw(meds);
    el('med-q').oninput = () => { const q = el('med-q').value.toLowerCase(); draw(meds.filter((m) => m.name.toLowerCase().includes(q))); };
    el('view').onclick = async (e) => {
      const rs = e.target.closest('[data-restock]'); const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (rs) { const m = meds.find((x) => x.id == rs.dataset.restock); return restockPrompt(m); }
      if (ed) { const m = meds.find((x) => x.id == ed.dataset.edit); medForm(m); }
      if (dl) { if (!confirm('Remove medicine?')) return; await API.del('/clinic/medications/' + dl.dataset.del); toast('Removed'); route('meds'); }
    };
  };
  function restockPrompt(m) {
    openModal(`Restock · ${esc(m.name)}`, `
      <div class="form-grid">
        <div><div class="k muted small">Current stock</div>${m.stock} ${m.unit || ''}</div>
        <div><div class="k muted small">Reorder level</div>${m.reorder_level}</div>
      </div>
      <div class="field full"><label>Quantity to add</label><input id="rq" type="number" min="1" value="1" /></div>
      <p id="rq-msg" class="small muted"></p>
      <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary" id="rq-ok">Add to stock</button></div>`);
    const rq = el('rq'); const msg = el('rq-msg');
    const update = () => {
      const q = parseInt(rq.value || '0', 10); const total = m.stock + q;
      let t = `New stock will be ${total}.`;
      if (q > m.reorder_level) t += ` ⚠ The amount added (${q}) is higher than the reorder level (${m.reorder_level}) — please confirm this is correct.`;
      msg.innerHTML = t; msg.className = 'small ' + (q > m.reorder_level ? 'error' : 'muted');
    };
    rq.oninput = update; update();
    el('rq-ok').onclick = async () => {
      const q = parseInt(rq.value || '0', 10);
      if (!q || q < 1) { toast('Enter a valid quantity', 'err'); return; }
      if (q > m.reorder_level && !confirm(`You are adding ${q}, which exceeds the reorder level of ${m.reorder_level}. Continue?`)) return;
      try { await API.post(`/clinic/medications/${m.id}/restock`, { quantity: q }); closeModal(); toast('Restocked'); route('meds'); }
      catch (err) { toast(err.message, 'err'); }
    };
  }
  function medForm(m = {}) {
    const fields = [
      { name: 'name', label: 'Name', required: true, full: true }, { name: 'form', label: 'Form (tablet, syrup…)' },
      { name: 'unit', label: 'Unit' }, { name: 'stock', label: 'Current stock', type: 'number' },
      { name: 'reorder_level', label: 'Reorder level', type: 'number' }, { name: 'expiry', label: 'Expiry', type: 'date' },
    ];
    openModal(m.id ? 'Edit Medicine' : 'Add Medicine', `
      <form id="m-form"><div class="form-grid">${formHTML(fields, m)}</div>
      <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Save</button></div></form>`);
    el('m-form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const d = collect(ev.target);
      try { if (m.id) await API.put('/clinic/medications/' + m.id, d); else await API.post('/clinic/medications', d); closeModal(); toast('Saved'); route('meds'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  // Messages
  VIEWS.messages = async () => {
    action('✉️ Compose', () => composeMessage());
    await loadEmployees();
    const list = await API.get('/messages');
    el('view').innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Subject</th><th>Recipients</th><th>Ack</th><th></th></tr></thead>
        <tbody>${list.length ? list.map((m) => `<tr>
          <td>${fmtDate(m.created_at)}</td><td>${badge(m.type)}</td><td>${esc(m.category)}</td>
          <td><a class="link" data-open="${m.id}">${esc(m.subject || '(no subject)')}</a></td>
          <td>${m.recipient_count}</td><td>${m.ack_count}/${m.recipient_count}</td>
          <td><button class="btn small danger" data-del="${m.id}">Del</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No messages sent.</td></tr>'}
        </tbody></table></div></div>`;
    el('view').addEventListener('click', async (e) => {
      const op = e.target.closest('[data-open]'); const dl = e.target.closest('[data-del]');
      if (op) return messageDetail(op.dataset.open);
      if (dl) { if (!confirm('Delete message?')) return; await API.del('/messages/' + dl.dataset.del); toast('Deleted'); route('messages'); }
    });
  };
  function composeMessage(type = 'broadcast', preselect = []) {
    const depts = [...new Set(employeesCache.map((e) => e.department).filter(Boolean))];
    openModal('Compose Message', `
      <form id="msg-form">
        <div class="form-grid">
          ${formHTML([
            { name: 'type', label: 'Type', type: 'select', options: [{ value: 'broadcast', label: 'Broadcast' }, { value: 'individual', label: 'Individual' }], default: type },
            { name: 'category', label: 'Category', type: 'select', options: ['announcement', 'follow_up', 'reminder'] },
          ])}
        </div>
        <div id="target-broadcast" class="field full">
          <label>Department (broadcast) — leave blank for all active</label>
          <select name="department"><option value="">All active employees</option>${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select>
        </div>
        <div id="target-individual" class="field full hidden">
          <label>Recipients</label>
          <input id="recip-search" placeholder="🔍 Search recipients by name or ID…" autocomplete="off" style="margin-bottom:6px" />
          <select id="recip" multiple size="8">${empOptions().map((o) => `<option value="${o.value}" ${preselect.includes(Number(o.value)) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <span class="muted small">Ctrl/Cmd-click to select multiple. Search filters the list; selected people stay selected.</span>
        </div>
        <div class="form-grid one">
          ${formHTML([{ name: 'subject', label: 'Subject', full: true }, { name: 'body', label: 'Message', type: 'textarea', full: true, required: true }])}
        </div>
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Send</button></div>
      </form>`);
    const typeSel = el('msg-form').querySelector('[name=type]');
    const sync = () => {
      const isInd = typeSel.value === 'individual';
      el('target-individual').classList.toggle('hidden', !isInd);
      el('target-broadcast').classList.toggle('hidden', isInd);
    };
    typeSel.onchange = sync; sync();
    // Recipient search filter — hides non-matching options, keeps selections
    el('recip-search').oninput = () => {
      const q = el('recip-search').value.trim().toLowerCase();
      [...el('recip').options].forEach((o) => { o.hidden = q && !o.textContent.toLowerCase().includes(q); });
    };
    el('msg-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = collect(ev.target);
      if (d.type === 'individual') d.employee_ids = [...el('recip').selectedOptions].map((o) => Number(o.value));
      try { const r = await API.post('/messages', d); closeModal(); toast(`Sent to ${r.recipients} recipient(s)`); route('messages'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  async function messageDetail(id) {
    const m = await API.get('/messages/' + id);
    openModal(m.subject || '(no subject)', `
      <div class="form-grid"><div><div class="k muted small">Type</div>${badge(m.type)}</div><div><div class="k muted small">Category</div>${esc(m.category)}</div></div>
      <div class="section-title">Message</div><p>${esc(m.body)}</p>
      <div class="section-title">Recipients (${m.recipients.length})</div>
      <table><thead><tr><th>Name</th><th>Dept</th><th>Acknowledged</th><th></th></tr></thead><tbody>${
        m.recipients.map((r) => `<tr><td>${esc(r.last_name)}, ${esc(r.first_name)}</td><td>${esc(r.department || '—')}</td>
        <td>${r.acknowledged_at ? badge('passed') : badge('pending')}</td>
        <td>${r.acknowledged_at ? '' : `<button class="btn small" data-ack="${r.employee_id}">Mark ack</button>`}</td></tr>`).join('')
      }</tbody></table>`);
    el('modal-body').onclick = async (e) => {
      const a = e.target.closest('[data-ack]'); if (!a) return;
      await API.post(`/messages/${id}/recipients/${a.dataset.ack}/ack`); toast('Marked'); messageDetail(id);
    };
  }

  // SMS blast
  VIEWS.sms = async () => {
    action('📨 New SMS', () => smsCompose());
    await loadEmployees();
    const [status, log] = await Promise.all([API.get('/sms/status'), API.get('/sms/log')]);
    el('view').innerHTML = `
      <div class="panel"><div class="panel-body">
        <div class="pill-row" style="align-items:center">
          <span class="k muted small">Provider</span> ${badge(status.configured ? 'active' : 'pending')}
          <b>${esc(status.provider)}</b>
          <span class="muted small">mode: ${status.mode}${status.sender ? ' · sender ' + esc(status.sender) : ''}</span>
        </div>
        ${status.configured ? '' : '<p class="muted small">No SMS provider is configured yet, so sends run in <b>simulate</b> mode (logged, not delivered). Configure one via <code>dashboard.sh → API integrations</code> or set SMS_PROVIDER / SMS_API_KEY in backend/.env.</p>'}
      </div></div>
      <div class="panel"><div class="panel-head"><h3>Recent SMS</h3></div><div class="panel-body" style="padding:0">
        ${log.length ? `<table><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>${log.map((s) => `<tr><td class="small">${esc(String(s.created_at).replace('T', ' ').slice(0, 19))}</td>
            <td>${esc(s.phone)}${s.last_name ? `<div class="muted small">${esc(s.last_name)}, ${esc(s.first_name)}</div>` : ''}</td>
            <td class="small">${esc((s.message || '').slice(0, 60))}</td>
            <td>${badge(s.status === 'sent' ? 'fit' : s.status === 'failed' ? 'unfit' : 'pending')}<span class="small"> ${esc(s.status)}</span></td></tr>`).join('')}</tbody></table>`
          : '<p class="empty">No SMS sent yet.</p>'}</div></div>`;
  };
  function smsCompose() {
    const depts = [...new Set(employeesCache.map((e) => e.department).filter(Boolean))];
    const withPhone = employeesCache.filter((e) => e.phone);
    openModal('Send / Blast SMS', `
      <form id="sms-form">
        <div class="form-grid">
          ${formHTML([{ name: 'mode', label: 'Send to', type: 'select', options: [
            { value: 'all', label: 'All active employees (with phone)' },
            { value: 'department', label: 'A department' },
            { value: 'individual', label: 'Selected employees' },
            { value: 'numbers', label: 'Manual phone numbers' },
          ] }])}
          <div class="field" id="sms-dept-wrap"><label>Department</label><select name="department">${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select></div>
        </div>
        <div class="field full hidden" id="sms-indiv-wrap">
          <label>Recipients (${withPhone.length} have a phone)</label>
          <input id="sms-search" placeholder="🔍 Search…" autocomplete="off" style="margin-bottom:6px" />
          <select id="sms-recip" multiple size="6">${withPhone.map((e) => `<option value="${e.id}">${esc(empName(e))} · ${esc(e.phone)}</option>`).join('')}</select>
        </div>
        <div class="field full hidden" id="sms-numbers-wrap"><label>Phone numbers (comma or newline separated)</label><textarea id="sms-numbers" placeholder="09171234567, 09181234567"></textarea></div>
        <div class="field full"><label>Message</label><textarea name="message" required maxlength="600" placeholder="Type your SMS… (keep it short)"></textarea><span class="muted small" id="sms-count">0 chars</span></div>
        <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Send</button></div>
      </form>`);
    const form = el('sms-form'); const modeSel = form.querySelector('[name=mode]');
    const sync = () => {
      const m = modeSel.value;
      el('sms-dept-wrap').classList.toggle('hidden', m !== 'department');
      el('sms-indiv-wrap').classList.toggle('hidden', m !== 'individual');
      el('sms-numbers-wrap').classList.toggle('hidden', m !== 'numbers');
    };
    modeSel.onchange = sync; sync();
    const msg = form.querySelector('[name=message]');
    msg.oninput = () => el('sms-count').textContent = `${msg.value.length} chars · ~${Math.ceil(msg.value.length / 160) || 0} SMS`;
    el('sms-search').oninput = () => { const q = el('sms-search').value.toLowerCase(); [...el('sms-recip').options].forEach((o) => o.hidden = q && !o.textContent.toLowerCase().includes(q)); };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = collect(form); const body = { message: d.message };
      if (d.mode === 'all') body.all = true;
      else if (d.mode === 'department') body.department = d.department;
      else if (d.mode === 'individual') body.employee_ids = [...el('sms-recip').selectedOptions].map((o) => Number(o.value));
      else if (d.mode === 'numbers') body.numbers = el('sms-numbers').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      try {
        const r = await API.post('/sms/send', body);
        closeModal();
        const x = r.results;
        toast(`${r.mode}: ${x.sent || 0} sent, ${x.simulated || 0} simulated, ${x.failed || 0} failed`);
        route('sms');
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  // Reports
  VIEWS.reports = async () => {
    const [comp, fit, complaints, trend, due] = await Promise.all([
      API.get('/reports/ape-compliance'), API.get('/reports/fitness-distribution'),
      API.get('/reports/top-complaints'), API.get('/reports/visit-trend'), API.get('/ape/due?days=90'),
    ]);
    el('view').innerHTML = `
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>APE Compliance %</h3></div><div class="panel-body"><canvas id="r1" height="200"></canvas></div></div>
        <div class="panel"><div class="panel-head"><h3>Fitness Distribution</h3></div><div class="panel-body"><canvas id="r2" height="200"></canvas></div></div>
        <div class="panel"><div class="panel-head"><h3>Clinic Visit Trend (monthly)</h3></div><div class="panel-body"><canvas id="r3" height="200"></canvas></div></div>
        <div class="panel"><div class="panel-head"><h3>Top Complaints</h3></div><div class="panel-body"><canvas id="r4" height="200"></canvas></div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>APE Due / Overdue (90 days)</h3>
        <button class="btn small" id="export-due">Export CSV</button></div>
        <div class="panel-body" style="padding:0"><table><thead><tr><th>Employee</th><th>Dept</th><th>Last exam</th><th>Next due</th><th>Status</th></tr></thead>
        <tbody>${due.length ? due.map((r) => `<tr><td>${esc(r.last_name)}, ${esc(r.first_name)}</td><td>${esc(r.department || '—')}</td><td>${fmtDate(r.last_exam)}</td><td>${fmtDate(r.next_due)}</td><td>${badge(r.state)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">All current.</td></tr>'}</tbody></table></div></div>`;
    chartBar('r1', comp.map((c) => c.department), comp.map((c) => c.rate), 'Compliance %', '#1a7f6b');
    chartDoughnut('r2', fit.map((f) => (f.status || 'none').replace(/_/g, ' ')), fit.map((f) => f.n));
    chartLine('r3', trend.map((t) => t.month), trend.map((t) => t.n));
    chartBar('r4', complaints.map((c) => c.complaint), complaints.map((c) => c.n), 'Visits', '#2563eb');
    el('export-due').onclick = () => {
      const rows = [['Employee', 'Department', 'Last exam', 'Next due', 'Status'],
        ...due.map((r) => [`${r.last_name}, ${r.first_name}`, r.department || '', r.last_exam || '', r.next_due || '', r.state])];
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'ape-due.csv'; a.click();
    };
  };

  // ---------------- Admin Control Panel ----------------
  VIEWS.admin = async () => {
    el('view').innerHTML = `
      <div class="toolbar">
        <button class="btn small primary" data-tab="users">👤 Users &amp; Credentials</button>
        <button class="btn small" data-tab="branding">🎨 Branding &amp; Theme</button>
        <button class="btn small" data-tab="lists">📋 Lists &amp; Notes</button>
        <button class="btn small" data-tab="data">💾 Data</button>
        <button class="btn small" data-tab="status">🩺 System Status</button>
        <button class="btn small" data-tab="trouble">🛠️ Troubleshooting</button>
      </div>
      <div id="admin-pane"><p class="muted">Loading…</p></div>`;
    const tabs = [...el('view').querySelectorAll('[data-tab]')];
    const show = async (t) => {
      tabs.forEach((b) => b.classList.toggle('primary', b.dataset.tab === t));
      try {
        if (t === 'branding') await adminBranding();
        else if (t === 'lists') await adminLists();
        else if (t === 'data') await adminData();
        else if (t === 'status') await adminStatus();
        else if (t === 'trouble') await adminTrouble();
        else await adminUsers();
      } catch (err) { el('admin-pane').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    };
    el('view').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
    show('users');
  };

  async function adminLists() {
    const [lk, s] = await Promise.all([API.get('/lookups'), API.get('/settings')]);
    const listBlock = (type, title) => `
      <div class="panel"><div class="panel-head"><h3>${title}</h3></div><div class="panel-body">
        <div class="pill-row" id="lk-${type}">${(lk[type] || []).map((x) => `<span class="chip">${esc(x.value)} <button data-del-lk="${x.id}">✕</button></span>`).join('') || '<span class="muted small">None yet</span>'}</div>
        <form class="toolbar" data-add-lk="${type}" style="margin-top:12px"><input placeholder="Add ${type}…" name="value" /><button class="btn small primary">Add</button></form>
      </div></div>`;
    el('admin-pane').innerHTML = `
      <div class="grid-2">${listBlock('department', 'Departments')}${listBlock('position', 'Positions')}</div>
      <div class="panel"><div class="panel-head"><h3>Editable form notes</h3></div><div class="panel-body">
        <p class="muted small">These help texts appear under the forms. Edit them to match your unit's requirements.</p>
        <form id="notes-form"><div class="form-grid one">
          ${formHTML([
            { name: 'note_ape', label: 'Note under "Record Annual Physical Exam"', type: 'textarea', full: true },
            { name: 'note_newhire', label: 'Note under "New-Hire Medical Clearance"', type: 'textarea', full: true },
            { name: 'note_clinic', label: 'Note under "New Clinic Visit"', type: 'textarea', full: true },
          ], s)}
        </div><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary">Save notes</button></div></form>
        <p class="muted small">Tip: add or remove checklist items for new hires under New-Hire Clearance → “Manage Requirements”.</p>
      </div></div>`;
    el('admin-pane').querySelectorAll('[data-add-lk]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const type = f.dataset.addLk; const value = f.querySelector('[name=value]').value.trim();
      if (!value) return;
      try { await API.post('/lookups', { type, value }); toast('Added'); adminLists(); } catch (err) { toast(err.message, 'err'); }
    }));
    el('admin-pane').querySelectorAll('[data-del-lk]').forEach((b) => b.onclick = async () => {
      await API.del('/lookups/' + b.dataset.delLk); toast('Removed'); adminLists();
    });
    el('notes-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const saved = await API.put('/settings', collect(e.target)); branding = { ...branding, ...saved }; toast('Notes saved'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  async function adminData() {
    const status = await API.get('/admin/status');
    const c = status.database.counts;
    el('admin-pane').innerHTML = `
      <div class="panel"><div class="panel-head"><h3>Export</h3></div><div class="panel-body">
        <p class="muted small">Full backup includes every table, linked from employees down to clinic visits and messages.</p>
        <div class="pill-row">
          <button class="btn primary" id="exp-json">⬇ Full JSON backup</button>
          <button class="btn" data-csv="employees">Employees CSV</button>
          <button class="btn" data-csv="ape_records">APE CSV</button>
          <button class="btn" data-csv="clinic_visits">Clinic visits CSV</button>
          <button class="btn" data-csv="newhire_clearances">Clearances CSV</button>
          <button class="btn" data-csv="medications">Medications CSV</button>
          <button class="btn" data-csv="sms_log">SMS log CSV</button>
        </div>
        <p class="muted small" style="margin-top:8px">Current records — employees: ${c.employees ?? 0}, APE: ${c.ape ?? 0}, visits: ${c.visits ?? 0}, users: ${c.users ?? 0}.</p>
      </div></div>
      <div class="panel"><div class="panel-head"><h3>Import / Restore</h3></div><div class="panel-body">
        <p class="muted small">Restore from a JSON backup file. <b>Merge</b> adds rows; <b>Replace</b> wipes each table first (dangerous).</p>
        <div class="form-grid">
          <div class="field"><label>Backup file (.json)</label><input type="file" id="imp-file" accept="application/json,.json" /></div>
          <div class="field"><label>Mode</label><select id="imp-mode"><option value="merge">Merge (add rows)</option><option value="replace">Replace (wipe first)</option></select></div>
        </div>
        <div class="modal-actions" style="justify-content:flex-start"><button class="btn danger" id="imp-run" disabled>Import backup</button></div>
        <p id="imp-msg" class="small muted"></p>
      </div></div>`;
    el('exp-json').onclick = () => window.open('/api/admin/export', '_blank');
    el('admin-pane').querySelectorAll('[data-csv]').forEach((b) => b.onclick = () => window.open(`/api/admin/export/${b.dataset.csv}.csv`, '_blank'));
    let payload = null;
    el('imp-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { payload = JSON.parse(String(rd.result)); el('imp-run').disabled = false; el('imp-msg').textContent = `Loaded backup with ${Object.keys(payload.tables || {}).length} tables.`; } catch { el('imp-msg').textContent = 'Not a valid JSON backup.'; } };
      rd.readAsText(f);
    };
    el('imp-run').onclick = async () => {
      if (!payload) return;
      const mode = el('imp-mode').value;
      if (!confirm(`Import in "${mode}" mode?${mode === 'replace' ? ' This ERASES current data first.' : ''}`)) return;
      try { const r = await API.post('/admin/import', { ...payload, mode }); el('imp-msg').textContent = 'Imported: ' + JSON.stringify(r.imported); toast('Import complete'); }
      catch (err) { toast(err.message, 'err'); }
    };
  }

  async function adminUsers() {
    const users = await API.get('/admin/users');
    const pane = el('admin-pane');
    pane.innerHTML = `
      <div class="toolbar"><span class="muted small">${users.length} account(s)</span><span class="spacer"></span>
        <button class="btn small primary" id="add-staff">+ Add staff user</button></div>
      <div class="panel"><div class="panel-body" style="padding:0"><table>
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Linked employee</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td>${esc(u.name)}${u.must_change_pw ? ' <span class="badge pending">must change pw</span>' : ''}</td>
          <td>${esc(u.username)}</td><td>${badge(u.role)}</td>
          <td>${u.employee_id ? esc((u.last_name || '') + ', ' + (u.first_name || '')) : '<span class="muted">—</span>'}</td>
          <td>${badge(u.active ? 'active' : 'inactive')}</td>
          <td><div class="row-act">
            <button class="btn small" data-reset="${u.id}">Reset PW</button>
            <button class="btn small" data-toggle="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button>
            <button class="btn small danger" data-del="${u.id}">Del</button>
          </div></td></tr>`).join('')}</tbody></table></div></div>
      <p class="muted small">Staff users (admin/nurse) are created here. Employee &amp; new-hire portal logins are created from each person's profile under Employees.</p>`;
    el('add-staff').onclick = () => {
      openModal('Add staff user', `<form id="su-form"><div class="form-grid">${formHTML([
        { name: 'name', label: 'Full name', required: true, full: true },
        { name: 'username', label: 'Username', required: true },
        { name: 'role', label: 'Role', type: 'select', options: [{ value: 'nurse', label: 'HR Nurse' }, { value: 'admin', label: 'Administrator' }] },
        { name: 'password', label: 'Password (blank = auto)', full: true },
      ])}</div><div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Create</button></div></form>`);
      el('su-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { const r = await API.post('/admin/users', collect(e.target)); closeModal(); showCreds('Staff user created', { username: r.username, password: r.password, note: r.note }); adminUsers(); }
        catch (err) { toast(err.message, 'err'); }
      });
    };
    pane.querySelector('table').addEventListener('click', async (e) => {
      const rs = e.target.closest('[data-reset]'); const tg = e.target.closest('[data-toggle]'); const dl = e.target.closest('[data-del]');
      try {
        if (rs) { if (!confirm('Reset this user\'s password?')) return; const r = await API.post(`/admin/users/${rs.dataset.reset}/reset`); showCreds('Password reset', r); }
        if (tg) { await API.put(`/admin/users/${tg.dataset.toggle}`, { active: Number(tg.dataset.active) }); toast('Updated'); adminUsers(); }
        if (dl) { if (!confirm('Delete this account permanently?')) return; await API.del('/admin/users/' + dl.dataset.del); toast('Deleted'); adminUsers(); }
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  async function adminBranding() {
    const s = await API.get('/settings');
    el('admin-pane').innerHTML = `
      <div class="panel"><div class="panel-head"><h3>Branding &amp; Theme</h3></div><div class="panel-body">
        <form id="brand-form"><div class="form-grid">
          <div class="field full"><label>System name</label><input name="system_name" value="${esc(s.system_name)}" /></div>
          <div class="field full"><label>Tagline</label><input name="tagline" value="${esc(s.tagline)}" /></div>
          <div class="field full"><label>Logo image (PNG/JPG/SVG — replaces the character logo)</label>
            <div class="pill-row" style="align-items:center">
              <span id="logo-prev" style="display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:44px;border:1px solid var(--line);border-radius:8px;background:#fff">${s.logo_image ? `<img class="brand-logo-img" src="${s.logo_image}" />` : esc(s.logo_emoji || '＋')}</span>
              <input type="file" id="logo-file" accept="image/*" />
              <button type="button" class="btn small" id="logo-clear">Remove image</button>
            </div>
            <span class="muted small">📐 Recommended: a <b>square</b> image, ideally <b>256×256 px</b> (128–512 px works), PNG or SVG with a transparent background, max ~400&nbsp;KB. Non-square images may look stretched. Falls back to the character below if none.</span>
          </div>
          <div class="field"><label>Logo character (fallback)</label><input name="logo_emoji" value="${esc(s.logo_emoji)}" maxlength="4" /></div>
          <div class="field"><label>Primary color</label><input name="color_primary" type="color" value="${esc(s.color_primary)}" /></div>
          <div class="field"><label>Accent color</label><input name="color_accent" type="color" value="${esc(s.color_accent)}" /></div>
          <div class="field"><label>Sidebar color</label><input name="color_sidebar" type="color" value="${esc(s.color_sidebar)}" /></div>
        </div>
        <p class="muted small">Changes preview live as you edit. Click Save to apply for everyone.</p>
        <div class="modal-actions" style="justify-content:flex-start">
          <button class="btn primary" type="submit">Save branding</button>
          <button class="btn" type="button" id="brand-reset">Reset to defaults</button>
        </div></form>
      </div></div>`;
    const form = el('brand-form');
    let logoImage = s.logo_image || '';
    const payload = () => ({ ...collect(form), logo_image: logoImage });
    const live = () => UI.applyBranding(payload());
    form.addEventListener('input', live);
    el('logo-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 400 * 1024) { toast('Image too large (max ~400KB)', 'err'); return; }
      const rd = new FileReader();
      rd.onload = () => { logoImage = String(rd.result); el('logo-prev').innerHTML = `<img class="brand-logo-img" src="${logoImage}" />`; live(); };
      rd.readAsDataURL(f);
    };
    el('logo-clear').onclick = () => { logoImage = ''; el('logo-prev').textContent = collect(form).logo_emoji || '＋'; live(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const saved = await API.put('/settings', payload()); branding = { ...branding, ...saved }; UI.applyBranding(saved); toast('Branding saved'); }
      catch (err) { toast(err.message, 'err'); }
    });
    el('brand-reset').onclick = async () => {
      if (!confirm('Reset branding to defaults?')) return;
      const saved = await API.post('/settings/reset'); branding = { ...branding, ...saved }; UI.applyBranding(saved); toast('Reset'); adminBranding();
    };
  }

  async function adminStatus() {
    const ok = (b) => b ? '<span class="badge fit">OK</span>' : '<span class="badge unfit">FAIL</span>';
    const [s, cfg] = await Promise.all([API.get('/admin/status'), API.get('/admin/config')]);
    el('admin-pane').innerHTML = `
      <div class="cards">
        <div class="card ${s.healthy ? 'good' : 'alert'}"><div class="k">Overall</div><div class="v" style="font-size:18px">${s.healthy ? 'Healthy' : 'Attention'}</div></div>
        <div class="card"><div class="k">Uptime</div><div class="v" style="font-size:18px">${Math.floor(s.server.uptime_seconds / 3600)}h ${Math.floor((s.server.uptime_seconds % 3600) / 60)}m</div></div>
        <div class="card"><div class="k">Memory used</div><div class="v" style="font-size:18px">${s.server.mem_used_mb} MB</div></div>
        <div class="card"><div class="k">Running port</div><div class="v" style="font-size:18px">${cfg.running_port}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>⚙️ Server Configuration — Port</h3></div><div class="panel-body">
        <p class="muted small">Change the port if 3000 (or the current one) clashes with another system on this machine.</p>
        <div class="form-grid">
          <div class="field"><label>Application port</label><input id="port-input" type="number" min="1" max="65535" value="${cfg.configured_port}" /></div>
          <div class="field"><label>&nbsp;</label><div class="pill-row">
            <button class="btn" id="port-check">Check availability</button>
            <button class="btn primary" id="port-save">Save port</button>
          </div></div>
        </div>
        <p id="port-msg" class="small muted"></p>
        ${cfg.restart_needed ? '<p class="small"><span class="badge pending">restart pending</span> The saved port differs from the running port — restart to apply.</p>' : ''}
      </div></div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Health checks</h3><button class="btn small" id="recheck">Re-check</button></div>
          <div class="panel-body" style="padding:0"><table><tbody>${s.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.detail || '')}</td><td style="text-align:right">${ok(c.ok)}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="panel"><div class="panel-head"><h3>Server &amp; application</h3></div><div class="panel-body"><table><tbody>
          <tr><td>Application</td><td>${esc(s.app.name)} v${esc(s.app.version)} (${esc(s.app.env)})</td></tr>
          <tr><td>Node.js</td><td>${esc(s.server.node)}</td></tr>
          <tr><td>Platform</td><td>${esc(s.server.platform)}</td></tr>
          <tr><td>Hostname</td><td>${esc(s.server.hostname)}</td></tr>
          <tr><td>CPU cores / load</td><td>${s.server.cpus} / ${s.server.load_avg.join(', ')}</td></tr>
          <tr><td>Memory (free/total)</td><td>${s.server.mem_free_mb} / ${s.server.mem_total_mb} MB</td></tr>
        </tbody></table></div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Database record counts</h3></div><div class="panel-body"><div class="pill-row">
        ${Object.entries(s.database.counts).map(([k, v]) => `<span class="chip">${esc(k)}: <b>${v}</b></span>`).join('')}
      </div></div></div>
      <p class="muted small">Checked ${esc(s.ts)}</p>`;
    document.getElementById('recheck').onclick = () => adminStatus();
    document.getElementById('port-check').onclick = async () => {
      const p = el('port-input').value;
      try { const r = await API.get('/admin/check-port?port=' + encodeURIComponent(p)); el('port-msg').textContent = `Port ${r.port}: ${r.note}`; }
      catch (err) { el('port-msg').textContent = err.message; }
    };
    document.getElementById('port-save').onclick = async () => {
      const p = parseInt(el('port-input').value, 10);
      if (!confirm(`Set the application port to ${p}? You will need to restart the app to apply.`)) return;
      try { const r = await API.put('/admin/config', { port: p }); el('port-msg').textContent = r.note; toast('Port saved — restart to apply'); }
      catch (err) { toast(err.message, 'err'); el('port-msg').textContent = err.message; }
    };
  }

  // Heuristic: does this error need the user/admin to do something manually?
  function needsUserAction(r) {
    const m = (r.message || '').toLowerCase();
    if (/eaddrinuse|in use|listen error/.test(m)) return 'Change the port (System → Server Configuration) and restart.';
    if (/econnrefused|database|sqlite|pg|connect/.test(m)) return 'Check the database is running / disk space, then restart.';
    if (/tls|cert|ssl/.test(m)) return 'Re-check the certificate paths (dashboard.sh → HTTPS).';
    if (/permission|eacces|denied/.test(m)) return 'A file permission needs fixing on the server.';
    return '';
  }
  async function adminTrouble() {
    const data = await API.get('/admin/logs?limit=150');
    const counts = Object.fromEntries((data.summary || []).map((r) => [r.level, r.n]));
    const rows = data.rows || [];
    const openCount = rows.filter((r) => !r.resolved).length;
    el('admin-pane').innerHTML = `
      <div class="cards">
        <div class="card ${counts.critical ? 'alert' : ''}"><div class="k">Critical</div><div class="v">${counts.critical || 0}</div></div>
        <div class="card ${counts.error ? 'warn' : ''}"><div class="k">Errors</div><div class="v">${counts.error || 0}</div></div>
        <div class="card ${openCount ? 'warn' : 'good'}"><div class="k">Unresolved</div><div class="v">${openCount}</div></div>
        <div class="card"><div class="k">Logged total</div><div class="v">${rows.length}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Recent errors</h3>
        <div class="pill-row"><label class="small muted"><input type="checkbox" id="hide-resolved" /> hide resolved</label>
          <button class="btn small" id="log-refresh">Refresh</button><button class="btn small danger" id="log-clear">Clear log</button></div></div>
        <div class="panel-body" style="padding:0">${rows.length ? `<table>
          <thead><tr><th>When</th><th>Level</th><th>Message</th><th>Action needed</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((r) => { const na = needsUserAction(r); return `<tr data-resolved="${r.resolved ? 1 : 0}">
            <td class="small">${esc(String(r.created_at).replace('T', ' ').slice(0, 19))}</td>
            <td>${badge(r.level === 'critical' ? 'unfit' : r.level === 'warn' ? 'pending' : 'fit_with_restriction')}<span class="small"> ${esc(r.level)}</span></td>
            <td><a class="link" data-log='${esc(JSON.stringify({ m: r.message, d: r.detail, r: r.route }))}'>${esc((r.message || '').slice(0, 70))}</a>${r.resolution_note ? `<div class="muted small">note: ${esc(r.resolution_note)}</div>` : ''}</td>
            <td class="small">${na ? '⚠ ' + esc(na) : '<span class="muted">—</span>'}</td>
            <td>${r.resolved ? badge('passed') : badge('pending')}</td>
            <td>${r.resolved ? `<button class="btn small" data-reopen="${r.id}">Reopen</button>` : `<button class="btn small primary" data-resolve="${r.id}">Resolve</button>`}</td>
          </tr>`; }).join('')}</tbody></table>`
          : '<p class="empty">No errors logged 🎉 The system is running cleanly.</p>'}</div></div>
      <div class="panel"><div class="panel-head"><h3>Common issues &amp; quick fixes</h3></div><div class="panel-body">
        ${commonIssuesHTML()}
      </div></div>`;
    document.getElementById('log-refresh').onclick = () => adminTrouble();
    document.getElementById('log-clear').onclick = async () => { if (!confirm('Clear the entire error log?')) return; await API.del('/admin/logs'); toast('Log cleared'); adminTrouble(); };
    const hide = document.getElementById('hide-resolved');
    if (hide) hide.onchange = () => el('admin-pane').querySelectorAll('tr[data-resolved="1"]').forEach((tr) => tr.style.display = hide.checked ? 'none' : '');
    el('admin-pane').onclick = async (e) => {
      const lg = e.target.closest('[data-log]'); const rv = e.target.closest('[data-resolve]'); const ro = e.target.closest('[data-reopen]');
      if (lg) { const o = JSON.parse(lg.dataset.log); return openModal('Error detail', `<p><b>${esc(o.m || '')}</b></p><p class="muted small">${esc(o.r || '')}</p><pre style="white-space:pre-wrap;font-size:12px;background:#f8fafc;padding:12px;border-radius:8px;max-height:340px;overflow:auto">${esc(o.d || '(no stack)')}</pre>`); }
      if (rv) { const note = prompt('Resolution note (optional) — what was done / what the user must correct:') || ''; await API.put('/admin/logs/' + rv.dataset.resolve, { resolved: true, resolution_note: note }); toast('Marked resolved'); adminTrouble(); }
      if (ro) { await API.put('/admin/logs/' + ro.dataset.reopen, { resolved: false }); toast('Reopened'); adminTrouble(); }
    };
  }
  function commonIssuesHTML() {
    const items = [
      ['Port already in use (EADDRINUSE)', 'Another program uses the port. Change it in System &gt; Server Configuration, or set PORT in backend/.env, then restart. Find the culprit: <code>sudo lsof -i :3000</code> (Linux) / <code>netstat -ano | findstr :3000</code> (Windows).'],
      ['Can\'t log in', 'Use the defaults (admin/admin123). If forgotten, an admin can reset any password in Users &amp; Credentials. If the admin password is lost, re-run <code>npm run seed</code> or reset directly in the database.'],
      ['App won\'t start / blank page', 'Check the service: <code>systemctl status hr-nurse</code> and logs <code>journalctl -u hr-nurse -f</code>. On a workstation, look at the terminal running <code>npm start</code>.'],
      ['Database locked / errors', 'SQLite: ensure only one instance runs. Check disk space. Restore from a backup of backend/data/hrnurse.db if corrupted.'],
      ['Changes not applying', 'Hard-refresh the browser (Ctrl/Cmd+Shift+R). After changing the port or .env, restart the app.'],
    ];
    return `<div style="display:flex;flex-direction:column;gap:10px">${items.map(([q, a]) =>
      `<details><summary style="cursor:pointer;font-weight:600">${esc(q)}</summary><p class="small muted" style="margin:6px 0 0">${a}</p></details>`).join('')}</div>`;
  }

  // ---------------- Charts ----------------
  const charts = {};
  function destroy(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function chartBar(id, labels, data, label, color) {
    destroy(id);
    charts[id] = new Chart(el(id), { type: 'bar',
      data: { labels, datasets: [{ label, data, backgroundColor: color, borderRadius: 4 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  }
  function chartLine(id, labels, data) {
    destroy(id);
    charts[id] = new Chart(el(id), { type: 'line',
      data: { labels, datasets: [{ label: 'Visits', data, borderColor: '#1a7f6b', backgroundColor: 'rgba(26,127,107,.15)', fill: true, tension: .3 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  }
  function chartDoughnut(id, labels, data) {
    destroy(id);
    charts[id] = new Chart(el(id), { type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: ['#16a34a', '#d97706', '#dc2626', '#6b7280', '#2563eb'] }] },
      options: { plugins: { legend: { position: 'bottom' } } } });
  }

  // Report uncaught client-side errors to the server (best-effort, only when logged in)
  let lastReport = 0;
  function reportClientError(message, detail) {
    if (!me) return;
    const now = Date.now();
    if (now - lastReport < 3000) return; // throttle bursts
    lastReport = now;
    try { API.post('/diag/log', { level: 'error', source: 'client', message, detail, route: location.hash || location.pathname }); } catch { /* ignore */ }
  }
  window.addEventListener('error', (e) => reportClientError(e.message, (e.error && e.error.stack) || `${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => reportClientError('Unhandled promise rejection', String((e.reason && e.reason.stack) || e.reason)));

  boot();
})();
