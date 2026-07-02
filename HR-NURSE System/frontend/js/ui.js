// Small DOM + formatting helpers shared by all views.
const UI = (() => {
  const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const el = (id) => document.getElementById(id);

  function toast(msg, kind = 'ok') {
    const t = el('toast');
    t.textContent = msg;
    t.className = 'toast ' + kind;
    setTimeout(() => { t.className = 'toast hidden'; }, 2600);
  }

  function badge(status) {
    const label = (status || 'pending').replace(/_/g, ' ');
    return `<span class="badge ${esc(status || 'pending')}">${esc(label)}</span>`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    return s;
  }

  function age(birthdate) {
    if (!birthdate) return '';
    const b = new Date(birthdate);
    if (isNaN(b)) return '';
    const diff = Date.now() - b.getTime();
    return Math.floor(diff / (365.25 * 86400000));
  }

  function openModal(title, html) {
    el('modal-title').textContent = title;
    const body = el('modal-body');
    body.onclick = null; // drop any handler from a previous modal
    body.innerHTML = html;
    el('modal').classList.remove('hidden');
  }
  function closeModal() { el('modal').classList.add('hidden'); el('modal-body').innerHTML = ''; }

  // Build a form from a field spec; returns values object on submit.
  function formHTML(fields, values = {}) {
    return fields.map((f) => {
      const v = values[f.name] != null ? values[f.name] : (f.default || '');
      const cls = 'field' + (f.full ? ' full' : '');
      if (f.type === 'select') {
        const opts = f.options.map((o) => {
          const ov = typeof o === 'string' ? o : o.value;
          const ol = typeof o === 'string' ? o : o.label;
          return `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`;
        }).join('');
        return `<div class="${cls}"><label>${esc(f.label)}</label><select name="${f.name}">${opts}</select></div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="${cls}"><label>${esc(f.label)}</label><textarea name="${f.name}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea></div>`;
      }
      if (f.type === 'datalist') {
        const listId = 'dl_' + f.name;
        const opts = (f.options || []).map((o) => `<option value="${esc(typeof o === 'string' ? o : o.value)}"></option>`).join('');
        return `<div class="${cls}"><label>${esc(f.label)}</label><input name="${f.name}" list="${listId}" value="${esc(v)}" placeholder="${esc(f.ph || 'type or pick…')}" autocomplete="off" /><datalist id="${listId}">${opts}</datalist></div>`;
      }
      return `<div class="${cls}"><label>${esc(f.label)}</label><input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.ph || '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''} /></div>`;
    }).join('');
  }

  function collect(formEl) {
    const o = {};
    formEl.querySelectorAll('input, select, textarea').forEach((i) => {
      if (i.name) o[i.name] = i.value;
    });
    return o;
  }

  // Apply branding/theme everywhere (login + app shell). Safe to call repeatedly.
  function applyBranding(b) {
    if (!b) return;
    const root = document.documentElement.style;
    if (b.color_primary) { root.setProperty('--primary', b.color_primary); root.setProperty('--primary-d', shade(b.color_primary, -14)); }
    if (b.color_accent) root.setProperty('--accent', b.color_accent);
    if (b.color_sidebar) root.setProperty('--sidebar', b.color_sidebar);
    const name = b.system_name || 'HR Nurse System';
    document.title = name;
    document.querySelectorAll('[data-brand-name]').forEach((n) => (n.textContent = name));
    document.querySelectorAll('[data-brand-tag]').forEach((n) => (n.textContent = b.tagline || ''));
    document.querySelectorAll('[data-brand-logo]').forEach((n) => {
      if (b.logo_image) n.innerHTML = `<img class="brand-logo-img" src="${b.logo_image}" alt="logo" />`;
      else n.textContent = b.logo_emoji || '＋';
    });
  }
  // Darken/lighten a hex color by pct (-100..100)
  function shade(hex, pct) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return hex;
    const adj = (c) => Math.max(0, Math.min(255, Math.round(parseInt(c, 16) * (1 + pct / 100))));
    return '#' + [m[1], m[2], m[3]].map((c) => adj(c).toString(16).padStart(2, '0')).join('');
  }

  return { esc, el, toast, badge, fmtDate, age, openModal, closeModal, formHTML, collect, applyBranding, shade };
})();
