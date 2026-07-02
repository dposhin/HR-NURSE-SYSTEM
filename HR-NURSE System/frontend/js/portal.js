/* Self-service portal for employees and new hires (applicants). */
window.Portal = (() => {
  const { esc, el, toast, badge, fmtDate, age, openModal, closeModal, formHTML, collect } = UI;
  let me = null;
  let data = null; // /portal/me payload

  const LABELS = { overview: 'My Overview', health: 'My Health Records', clearance: 'My Clearance', messages: 'Messages' };

  async function show(user) {
    me = user;
    // Replace the admin sidebar nav with portal nav
    const isApplicant = me.role === 'applicant';
    const links = [
      ['overview', '🏠 Overview'],
      ['health', '🩺 Health Records'],
      ...(isApplicant ? [['clearance', '✅ My Clearance']] : []),
      ['messages', '✉️ Messages'],
    ];
    el('nav').innerHTML = links.map((l, i) =>
      `<a data-proute="${l[0]}" class="${i === 0 ? 'active' : ''}">${l[1]}</a>`).join('');
    el('nav').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-proute]'); if (!a) return;
      route(a.dataset.proute);
    });
    const start = (location.hash || '').replace('#', '');
    route(LABELS[start] ? start : 'overview'); // restore last view after a refresh
  }

  async function route(r) {
    if (('#' + r) !== location.hash) location.hash = r;
    document.querySelectorAll('#nav a').forEach((x) => x.classList.toggle('active', x.dataset.proute === r));
    el('topbar-actions').innerHTML = '';
    el('page-title').textContent = LABELS[r] || '';
    el('view').innerHTML = '<p class="muted">Loading…</p>';
    try { await VIEWS[r](); }
    catch (err) { el('view').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }

  async function ensureData() { if (!data) data = await API.get('/portal/me'); return data; }

  const VIEWS = {};

  VIEWS.overview = async () => {
    const d = await ensureData();
    const p = d.profile;
    const latest = d.ape[0];
    el('topbar-actions').innerHTML = '';
    el('view').innerHTML = `
      <div class="cards">
        <div class="card"><div class="k">Status</div><div class="v" style="font-size:18px">${badge(p.status)}</div></div>
        <div class="card ${latest ? '' : 'warn'}"><div class="k">Latest Fitness</div><div class="v" style="font-size:18px">${latest ? badge(latest.fitness_status) : '<span class="muted">No exam yet</span>'}</div></div>
        <div class="card"><div class="k">Next APE Due</div><div class="v" style="font-size:18px">${latest ? fmtDate(latest.next_due) : '—'}</div></div>
        <div class="card ${d.unread ? 'warn' : ''}"><div class="k">Unread Messages</div><div class="v">${d.unread}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>My Information</h3><button class="btn small" id="edit-contact">Update contact</button></div>
        <div class="panel-body"><div class="form-grid">
          <div><div class="k muted small">Name</div>${esc(p.first_name)} ${esc(p.last_name)}</div>
          <div><div class="k muted small">Employee #</div>${esc(p.emp_no || '—')}</div>
          <div><div class="k muted small">Department</div>${esc(p.department || '—')}</div>
          <div><div class="k muted small">Position</div>${esc(p.position || '—')}</div>
          <div><div class="k muted small">Age / Sex</div>${age(p.birthdate) || '—'} / ${esc(p.sex || '—')}</div>
          <div><div class="k muted small">Blood type</div>${esc(p.blood_type || '—')}</div>
          <div><div class="k muted small">Phone</div>${esc(p.phone || '—')}</div>
          <div><div class="k muted small">Email</div>${esc(p.email || '—')}</div>
          <div class="field full"><div class="k muted small">Allergies</div>${esc(p.allergies || '—')}</div>
          <div class="field full"><div class="k muted small">Chronic conditions</div>${esc(p.chronic_conditions || '—')}</div>
        </div></div></div>
      ${me.role === 'applicant' ? '<p class="muted small">Track your pre-employment requirements under <b>My Clearance</b>.</p>' : ''}`;
    el('edit-contact').onclick = () => editContact(p);
  };

  function editContact(p) {
    openModal('Update my contact details', `
      <form id="c-form"><div class="form-grid">${formHTML([
        { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' },
        { name: 'address', label: 'Address', full: true },
        { name: 'emergency_contact', label: 'Emergency contact' }, { name: 'emergency_phone', label: 'Emergency phone' },
      ], p)}</div>
      <div class="modal-actions"><button type="button" class="btn" onclick="UI.closeModal()">Cancel</button><button class="btn primary">Save</button></div></form>`);
    el('c-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await API.put('/portal/contact', collect(e.target)); data = null; closeModal(); toast('Updated'); route('overview'); }
      catch (err) { toast(err.message, 'err'); }
    });
  }

  VIEWS.health = async () => {
    const d = await ensureData();
    el('view').innerHTML = `
      <div class="panel"><div class="panel-head"><h3>Physical Exam History (${d.ape.length})</h3></div>
        <div class="panel-body" style="padding:0">${d.ape.length ? `<table>
          <thead><tr><th>Date</th><th>Type</th><th>BMI</th><th>BP</th><th>Vision</th><th>Fitness</th><th>Next due</th></tr></thead>
          <tbody>${d.ape.map((a) => `<tr><td>${fmtDate(a.exam_date)}</td><td>${esc(a.exam_type)}</td><td>${a.bmi || '—'}</td>
          <td>${esc(a.bp || '—')}</td><td>${esc(a.vision || '—')}</td><td>${badge(a.fitness_status)}</td><td>${fmtDate(a.next_due)}</td></tr>
          ${a.findings ? `<tr><td colspan="7" class="muted small">Findings: ${esc(a.findings)}</td></tr>` : ''}`).join('')}</tbody></table>`
          : '<p class="empty">No exams on record yet.</p>'}</div></div>
      <div class="panel"><div class="panel-head"><h3>Clinic Visits (${d.visits.length})</h3></div>
        <div class="panel-body" style="padding:0">${d.visits.length ? `<table>
          <thead><tr><th>Date</th><th>Complaint</th><th>Treatment</th><th>Disposition</th><th>Follow-up</th></tr></thead>
          <tbody>${d.visits.map((v) => `<tr><td>${fmtDate(v.visit_date)}</td><td>${esc(v.complaint || '—')}</td>
          <td>${esc(v.treatment || '—')}</td><td>${badge(v.disposition)}</td><td>${fmtDate(v.follow_up_date)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="empty">No clinic visits yet.</p>'}</div></div>`;
  };

  VIEWS.clearance = async () => {
    const c = await API.get('/portal/clearance');
    if (!c) { el('view').innerHTML = '<p class="empty">No clearance has been started for you yet. Please check with the HR Nurse.</p>'; return; }
    const done = c.items.filter((i) => i.status === 'passed' || i.status === 'waived').length;
    const pct = c.items.length ? Math.round((done / c.items.length) * 100) : 0;
    el('view').innerHTML = `
      <div class="panel"><div class="panel-body">
        <div class="form-grid">
          <div><div class="k muted small">Position applied</div>${esc(c.position_applied || '—')}</div>
          <div><div class="k muted small">Overall status</div>${badge(c.status)}</div>
          <div><div class="k muted small">Requested</div>${fmtDate(c.requested_date)}</div>
          <div><div class="k muted small">Target start</div>${fmtDate(c.target_start_date)}</div>
        </div>
        <div class="section-title">Progress — ${done}/${c.items.length} (${pct}%)</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        ${c.remarks ? `<p class="muted small">Note from nurse: ${esc(c.remarks)}</p>` : ''}
      </div></div>
      <div class="panel"><div class="panel-head"><h3>Requirements</h3></div>
        <div class="panel-body" style="padding:0"><table>
          <thead><tr><th>Requirement</th><th>Category</th><th>Required</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>${c.items.map((i) => `<tr><td>${esc(i.requirement)}</td><td>${esc(i.category || '—')}</td>
          <td>${i.required ? 'Yes' : 'Optional'}</td><td>${badge(i.status)}</td><td>${esc(i.result_value || '—')}</td></tr>`).join('')}</tbody>
        </table></div></div>`;
  };

  VIEWS.messages = async () => {
    const list = await API.get('/portal/messages');
    el('view').innerHTML = `<div class="panel"><div class="panel-body" style="padding:0">${list.length ? `<table>
      <thead><tr><th>Date</th><th>From</th><th>Subject</th><th>Category</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td>${fmtDate(m.created_at)}</td><td>${esc(m.sender_name || 'HR Nurse')}</td>
        <td><a class="link" data-read="${m.id}">${esc(m.subject || '(no subject)')}</a></td>
        <td>${esc(m.category)}</td>
        <td>${m.acknowledged_at ? badge('passed') : m.read_at ? badge('in_progress') : badge('pending')}</td>
        <td>${m.acknowledged_at ? '<span class="muted small">acknowledged</span>' : `<button class="btn small primary" data-ack="${m.id}">Acknowledge</button>`}</td>
      </tr>`).join('')}</tbody></table>` : '<p class="empty">No messages.</p>'}</div></div>`;
    el('view').onclick = async (e) => {
      const rd = e.target.closest('[data-read]'); const ak = e.target.closest('[data-ack]');
      if (rd) {
        const m = list.find((x) => x.id == rd.dataset.read);
        await API.post(`/portal/messages/${m.id}/read`);
        openModal(m.subject || '(no subject)', `<p class="muted small">From ${esc(m.sender_name || 'HR Nurse')} · ${fmtDate(m.created_at)}</p>
          <p>${esc(m.body)}</p>${m.acknowledged_at ? '' : `<div class="modal-actions"><button class="btn primary" id="ack-now">Acknowledge</button></div>`}`);
        const an = document.getElementById('ack-now');
        if (an) an.onclick = async () => { await API.post(`/portal/messages/${m.id}/ack`); closeModal(); toast('Acknowledged'); route('messages'); };
      }
      if (ak) { await API.post(`/portal/messages/${ak.dataset.ack}/ack`); toast('Acknowledged'); route('messages'); }
    };
  };

  return { show };
})();
