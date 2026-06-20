export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>zero-rpc</title>
<style>
  :root { color-scheme: light dark; --fg:#1a1a1a; --muted:#666; --bg:#fafafa; --card:#fff; --border:#e3e3e3; --accent:#2b6cb0; --danger:#c33; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --muted:#9aa; --bg:#121212; --card:#1c1c1c; --border:#2a2a2a; --accent:#79b8ff; --danger:#f88; } }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 24px; }
  main { max-width: 820px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { color: var(--muted); margin-bottom: 24px; }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 20px; }
  section h2 { margin: 0 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); }
  tr:last-child td { border-bottom: none; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--fg); cursor: pointer; }
  button.primary { background: var(--accent); color: white; border-color: var(--accent); }
  button.danger { color: var(--danger); border-color: var(--danger); }
  button.small { padding: 4px 8px; font-size: 12px; }
  button:hover { filter: brightness(0.95); }
  form.grid { display: grid; gap: 10px; grid-template-columns: 120px 1fr; align-items: start; }
  form.grid label { color: var(--muted); padding-top: 7px; }
  input[type=text] { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); width: 100%; }
  .url-cell { word-break: break-all; }
  .empty { color: var(--muted); font-style: italic; padding: 12px 0; }
  .row-actions { display: flex; gap: 6px; }
  .hrow { display: flex; gap: 6px; margin-bottom: 6px; }
  .hrow .h-name { max-width: 220px; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--fg); color: var(--bg); padding: 10px 14px; border-radius: 6px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<main>
  <h1>zero-rpc</h1>
  <div class="sub">public paths that reverse-proxy to private upstreams, guarded by Cloudflare Access</div>

  <section>
    <h2>Add / update route</h2>
    <form id="route-form" class="grid">
      <label for="f-slug">Public path</label>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="mono" style="color:var(--muted)">/</span>
        <input id="f-slug" type="text" placeholder="path" style="max-width:200px" />
      </div>
      <label for="f-upstream">Private URL</label>
      <input id="f-upstream" type="text" placeholder="https://..." />
      <label>Headers</label>
      <div>
        <div id="headers"></div>
        <button type="button" id="add-header" class="small">+ header</button>
        <div style="color:var(--muted);font-size:12px;margin-top:4px">sent to the upstream on every request, e.g. an API token</div>
      </div>
      <div></div>
      <div><button type="submit" class="primary">Save route</button></div>
    </form>
  </section>

  <section>
    <h2>Routes</h2>
    <div id="routes-empty" class="empty" hidden>No routes yet.</div>
    <table id="routes-table" hidden>
      <thead><tr><th>Public endpoint</th><th>Private upstream</th><th>Headers</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
</main>

<div id="toast" class="toast"></div>

<script>
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
};
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

let routes = [];

function addHeaderRow(name = '', value = '') {
  const row = document.createElement('div');
  row.className = 'hrow';
  const n = document.createElement('input'); n.type = 'text'; n.className = 'h-name'; n.placeholder = 'name'; n.value = name;
  const v = document.createElement('input'); v.type = 'text'; v.className = 'h-value'; v.placeholder = 'value'; v.value = value;
  const x = document.createElement('button'); x.type = 'button'; x.className = 'small'; x.textContent = '×';
  x.addEventListener('click', () => row.remove());
  row.append(n, v, x);
  $('#headers').appendChild(row);
}

function collectHeaders() {
  const out = {};
  for (const row of $$('.hrow')) {
    const name = $('.h-name', row).value.trim();
    const value = $('.h-value', row).value;
    if (name) out[name] = value;
  }
  return out;
}

function resetForm() {
  $('#f-slug').value = ''; $('#f-upstream').value = ''; $('#headers').innerHTML = '';
}

function render() {
  const tbody = $('#routes-table tbody');
  tbody.innerHTML = '';
  if (routes.length === 0) { $('#routes-table').hidden = true; $('#routes-empty').hidden = false; return; }
  $('#routes-empty').hidden = true; $('#routes-table').hidden = false;
  for (const r of routes) {
    const pub = location.origin + '/' + r.slug;
    const n = Object.keys(r.headers || {}).length;
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="mono url-cell"><a href="#" data-copy="' + esc(pub) + '">' + esc(pub) + '</a></td>' +
      '<td class="mono url-cell">' + esc(r.upstream) + '</td>' +
      '<td>' + (n ? n + (n === 1 ? ' header' : ' headers') : '<span style="color:var(--muted)">-</span>') + '</td>' +
      '<td class="row-actions"><button class="small" data-edit="' + esc(r.slug) + '">Edit</button>' +
      '<button class="danger small" data-del="' + esc(r.slug) + '">Delete</button></td>';
    tbody.appendChild(tr);
  }
}

async function refresh() {
  const { routes: r } = await api('/_routes');
  routes = r || [];
  render();
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.copy) {
    e.preventDefault();
    await navigator.clipboard.writeText(t.dataset.copy);
    toast('URL copied');
  } else if (t.dataset.edit) {
    const r = routes.find(x => x.slug === t.dataset.edit);
    if (!r) return;
    resetForm();
    $('#f-slug').value = r.slug;
    $('#f-upstream').value = r.upstream;
    for (const [k, v] of Object.entries(r.headers || {})) addHeaderRow(k, v);
    $('#f-slug').focus();
  } else if (t.dataset.del) {
    const slug = t.dataset.del;
    if (!confirm('Delete /' + slug + ' ?')) return;
    try {
      await api('/_routes/' + slug, { method: 'DELETE' });
      routes = routes.filter(x => x.slug !== slug);
      render();
      toast('Deleted');
    } catch (err) { toast(err.message); }
  }
});

$('#add-header').addEventListener('click', () => addHeaderRow());

$('#route-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slug = $('#f-slug').value.trim();
  const upstream = $('#f-upstream').value.trim();
  if (!slug || !upstream) { toast('Path and URL required'); return; }
  try {
    const saved = await api('/_routes/' + encodeURIComponent(slug), {
      method: 'PUT',
      body: JSON.stringify({ upstream, headers: collectHeaders() }),
    });
    // Update the list from the write response. KV list() is eventually consistent,
    // so re-fetching right after a write can return a stale (empty) list.
    const entry = { slug: saved.slug, upstream: saved.upstream, headers: saved.headers || {} };
    const i = routes.findIndex(x => x.slug === entry.slug);
    if (i >= 0) routes[i] = entry; else routes.push(entry);
    render();
    resetForm();
    toast('Saved');
  } catch (err) { toast(err.message); }
});

refresh().catch(err => toast('Load failed: ' + err.message));
</script>
</body>
</html>`;
