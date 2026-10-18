// The OS front end. Each tab is one entry in `tabs`: a key, a label, and a render function
// that fills the panel. Add a tab by adding an entry. See README "Add a tab".

const panel = document.getElementById('panel');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  el.append(...kids.flat(Infinity).filter(k => k !== null && k !== undefined));
  return el;
};
async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) location.replace('/');
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function home() {
  const [{ tasks }, { connections }] = await Promise.all([api('/api/tasks'), api('/api/connections')]);
  const open = tasks.filter(t => !t.done).length;
  const live = connections.filter(c => c.connected).length;
  panel.replaceChildren(
    h('h1', {}, 'Home'),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Open tasks'), h('h1', {}, String(open))),
      h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Connected tools'), h('h1', {}, `${live} / ${connections.length}`)),
    ),
    h('h2', {}, 'Airtable'),
    h('div', { id: 'airtable' }, h('p', { class: 'muted' }, 'Loading...')),
  );
  const box = document.getElementById('airtable');
  try {
    const data = await api('/api/airtable/records');
    if (!data.connected) return box.replaceChildren(h('p', { class: 'muted' }, 'Connect Airtable to see your table here. See the Connections tab.'));
    if (!data.records.length) return box.replaceChildren(h('p', { class: 'muted' }, 'Connected. The table is empty.'));
    const cols = [...new Set(data.records.flatMap(r => Object.keys(r)).filter(k => k !== 'id'))].slice(0, 6);
    box.replaceChildren(h('div', { class: 'card scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map(c => h('th', {}, c)))),
      h('tbody', {}, data.records.map(r => h('tr', {}, cols.map(c => h('td', {}, r[c] === undefined ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c])))))),
    )));
  } catch (e) { box.replaceChildren(h('p', { class: 'muted' }, e.message)); }
}

async function tasks() {
  const { tasks } = await api('/api/tasks');
  const input = h('input', { type: 'text', placeholder: 'Add a task', 'aria-label': 'New task' });
  const add = async () => { if (!input.value.trim()) return; await api('/api/tasks', 'POST', { title: input.value }); render('tasks'); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  panel.replaceChildren(
    h('h1', {}, 'Tasks'),
    h('div', { class: 'row card' }, input, h('button', { onclick: add }, 'Add')),
    h('div', { class: 'card' }, tasks.length ? tasks.map(t => h('div', { class: 'task' + (t.done ? ' done' : '') },
      h('input', { type: 'checkbox', ...(t.done ? { checked: '' } : {}), 'aria-label': 'Done', onchange: async e => { await api('/api/tasks', 'PATCH', { id: t.id, done: e.target.checked }); render('tasks'); } }),
      h('span', {}, t.title),
      h('button', { class: 'ghost', onclick: async () => { await api('/api/tasks', 'DELETE', { id: t.id }); render('tasks'); } }, 'Delete'),
    )) : h('p', { class: 'muted' }, 'Nothing yet.')),
    h('p', { class: 'muted' }, 'This tab is the example of a tab with its own D1 table. Copy it for anything you want to track.'),
  );
}

async function connections() {
  const { connections } = await api('/api/connections');
  panel.replaceChildren(
    h('h1', {}, 'Connections'),
    h('p', { class: 'muted' }, 'Each tool connects with a key you store as a Worker secret. Keys never reach this page.'),
    ...connections.map(c => {
      const status = h('span', { class: 'muted' }, c.connected ? 'Keys set' : 'Not connected');
      const test = async () => {
        status.textContent = 'Testing...';
        try { const r = await api('/api/connections/test', 'POST', { key: c.key }); status.textContent = r.message; }
        catch (e) { status.textContent = e.message; }
      };
      return h('div', { class: 'card' },
        h('div', { class: 'row' }, h('span', { class: 'dot' + (c.connected ? ' on' : '') }), h('strong', {}, c.label), h('span', { class: 'muted' }, c.use)),
        h('p', { class: 'muted' }, 'Secrets: ', c.secrets.map((s, i) => [i ? ', ' : '', h('code', {}, s)])),
        h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: test }, 'Test'), status),
      );
    }),
  );
}

async function settings() {
  const [{ email }, { passkeys }] = await Promise.all([api('/api/auth/me'), api('/api/auth/passkeys')]);
  const msg = h('p', { class: 'muted', role: 'status' });
  const enc = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
  const addPasskey = async () => {
    try {
      const o = await api('/api/auth/passkeys/options', 'POST', {});
      const c = await navigator.credentials.create({ publicKey: { ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map(x => ({ ...x, id: dec(x.id) })) } });
      await api('/api/auth/passkeys/register', 'POST', { id: c.id, rawId: enc(c.rawId), type: c.type, response: { clientDataJSON: enc(c.response.clientDataJSON), attestationObject: enc(c.response.attestationObject), transports: c.response.getTransports?.() || [] }, clientExtensionResults: c.getClientExtensionResults() });
      render('settings');
    } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Cancelled.' : e.message; }
  };
  panel.replaceChildren(
    h('h1', {}, 'Settings'),
    h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Signed in as'), h('div', {}, email)),
    h('h2', {}, 'Passkeys'),
    h('div', { class: 'card' }, passkeys.map(p => h('div', { class: 'task' },
      h('span', {}, `Added ${p.created_at.slice(0, 10)}`, p.last_used_at ? ` · last used ${p.last_used_at.slice(0, 10)}` : ''),
      h('button', { class: 'ghost', onclick: async () => { try { await api('/api/auth/passkeys/delete', 'POST', { id: p.id }); render('settings'); } catch (e) { msg.textContent = e.message; } } }, 'Remove'),
    ))),
    h('div', { class: 'row' }, h('button', { onclick: addPasskey }, 'Add a passkey on this device'),
      h('button', { class: 'ghost', onclick: async () => { await api('/api/auth/logout', 'POST', {}); location.replace('/'); } }, 'Sign out')),
    msg,
  );
}

const tabs = [
  { key: 'home', label: 'Home', render: home },
  { key: 'tasks', label: 'Tasks', render: tasks },
  { key: 'connections', label: 'Connections', render: connections },
  { key: 'settings', label: 'Settings', render: settings },
];

async function render(key) {
  const tab = tabs.find(t => t.key === key) || tabs[0];
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.key === tab.key)));
  try { await tab.render(); } catch (e) { panel.replaceChildren(h('h1', {}, tab.label), h('p', { class: 'muted' }, e.message)); }
}

document.getElementById('tabs').append(...tabs.map(t => h('button', { class: 'tab', role: 'tab', 'data-key': t.key, onclick: () => { location.hash = t.key; } }, t.label)));
window.addEventListener('hashchange', () => render(location.hash.slice(1)));
api('/api/auth/me').then(me => {
  document.getElementById('brand').textContent = me.appName;
  document.getElementById('who').textContent = me.email;
  document.title = me.appName;
});
render(location.hash.slice(1));
