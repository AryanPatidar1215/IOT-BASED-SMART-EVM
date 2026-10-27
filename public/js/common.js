const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong. Try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ballot: '<path d="m9 12 2 2 4-4"/><path d="M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  nfc: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  vote: '<path d="M5 21h14"/><path d="m7 21 1-6h8l1 6"/><path d="M9 15V9l3-6 3 6v6"/>'
};
const icon = (name, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function toast(message, kind) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'bad' ? ' bad' : '');
  t.textContent = message;
  box.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => { const x = new Date(d); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const fmtDate = (d) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' });
const fmtDateTime = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;
function timeAgo(d) {
  if (!d) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return s + ' seconds ago';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' hours ago';
  return fmtDate(d);
}

// Turnout gauge drawn as a well that fills with indelible ink.
let gaugeN = 0;
function inkGauge(pct, label) {
  const id = 'g' + ++gaugeN;
  const p = Math.max(0, Math.min(100, pct));
  const y = Math.round(196 - p * 1.92);
  return `<svg class="gauge" viewBox="0 0 200 200" role="img" aria-label="Turnout ${p} percent">
    <defs>
      <clipPath id="${id}c"><circle cx="100" cy="100" r="92"/></clipPath>
      <clipPath id="${id}t"><rect class="fill" x="0" y="0" width="200" height="200" style="transform:translateY(${y}px)"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="96" fill="#fff" stroke="#c9c6f5" stroke-width="2"/>
    <g clip-path="url(#${id}c)">
      <rect class="fill" x="0" y="0" width="200" height="220" fill="#4a3fd1" style="transform:translateY(${y}px)"/>
      <path class="fill" d="M0 0 Q25 -9 50 0 T100 0 T150 0 T200 0 V12 H0Z" fill="#6a5fe6" style="transform:translateY(${y - 1}px)"/>
    </g>
    <text x="100" y="${label ? 104 : 114}" text-anchor="middle" font-size="46" fill="#1b1a4b">${p}%</text>
    ${label ? `<text x="100" y="130" text-anchor="middle" font-size="13" font-family="Instrument Sans,sans-serif" font-weight="500" fill="#1b1a4b">${esc(label)}</text>` : ''}
    <g clip-path="url(#${id}t)"><g clip-path="url(#${id}c)">
      <text x="100" y="${label ? 104 : 114}" text-anchor="middle" font-size="46" fill="#fff">${p}%</text>
      ${label ? `<text x="100" y="130" text-anchor="middle" font-size="13" font-family="Instrument Sans,sans-serif" font-weight="500" fill="#fff">${esc(label)}</text>` : ''}
    </g></g>
  </svg>`;
}

const STATUS = {
  draft: { label: 'Not open yet', cls: 'warn' },
  open: { label: 'Voting is open', cls: 'good' },
  closed: { label: 'Voting has closed', cls: 'ink' }
};

function swatch(c) {
  return `<span class="swatch" style="background:${esc(c.color)}">${esc(c.symbol)}</span>`;
}
