const { THEME } = require('../theme');
const { BACKGROUNDS, PRESETS, POSITIONS, sanitize, getPrefs, setPrefs, resetPrefs, checkEditorToken, saveUpload } = require('../levels/cardprefs');
const { buildRankCard } = require('../levels/xp');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const lastRender = new Map();
const lastUpload = new Map();
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.removeAllListeners('data'); req.resume(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.removeAllListeners('data'); req.resume(); resolve(null); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

async function cardFor(ctx, entry, prefs) {
  const guild = ctx.client.guilds.cache.get(entry.guildId);
  if (!guild) return null;
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  const user = member?.user ?? await ctx.client.users.fetch(entry.userId).catch(() => null);
  if (!user) return null;
  return buildRankCard(guild, user, member, prefs);
}

function page(title, body, script = true) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · ${escapeHtml(THEME.botName)}</title>
<link rel="stylesheet" href="/card/assets/editor.css?v=${ASSET_VERSION}">
</head><body>${body}${script ? `<script src="/card/assets/editor.js?v=${ASSET_VERSION}"></script>` : ''}</body></html>`;
}

function expiredPage() {
  return page('Link expired', `<main class="wrap narrow"><h1>This link has expired</h1>
<p class="muted">Editor links work for 30 minutes. Run <code>.rank</code> or <code>.stats</code> in the server and press the card customization button to get a new one.</p></main>`, false);
}

function editorPage(token, prefs) {
  const presets = Object.entries(PRESETS).map(([key, p]) => `<button type="button" class="chip" data-preset="${key}" data-accent="${p.accent}" data-bg="${p.bg}"><span class="ball"></span><span class="name">${escapeHtml(p.label)}</span></button>`).join('');
  const backgrounds = Object.entries(BACKGROUNDS).map(([key, b]) => `<button type="button" class="scene" data-bg-builtin="${key}" data-css="${escapeHtml(b.css)}"><span class="thumb"></span><span class="name">${escapeHtml(b.label)}</span></button>`).join('');
  const positions = POSITIONS.map((p) => `<button type="button" class="pos-${p}" data-pos="${p}">${p[0].toUpperCase()}${p.slice(1)}</button>`).join('');
  const colour = (id, name, hint) => `<div class="well"><label class="ring" title="Pick ${name.toLowerCase()}"><input type="color" id="${id}"></label><b>${name}</b><small>${hint}</small><input type="text" id="${id}Hex" maxlength="7" spellcheck="false" aria-label="${name} hex code"></div>`;
  return page('Card studio', `<div class="top"><div class="brand"><span class="logo"></span>${escapeHtml(THEME.botName)} <span class="muted">card studio</span></div><span class="topright"><span id="status" class="pill">Up to date</span><button type="button" class="topbtn" id="reset" title="Go back to the default card">Start over</button></span></div>
<main class="wrap">
  <section class="stage"><div class="frame"><img id="preview" alt="Your rank card preview" src="/card/${token}/preview.png"></div><p class="muted small">This preview shows your rank card. The saved colours, scenery and pfp style also apply to your .stats card.</p></section>

  <nav class="tabs" role="tablist">
    <button type="button" role="tab" data-tab="looks" class="on">Looks</button>
    <button type="button" role="tab" data-tab="colours">Colours</button>
    <button type="button" role="tab" data-tab="scenery">Scenery</button>
    <button type="button" role="tab" data-tab="picture">Your picture</button>
  </nav>

  <section class="sheet" id="editor" data-token="${token}" data-prefs="${escapeHtml(JSON.stringify(prefs))}">
    <div class="panel" data-panel="looks">
      <h3>Pick a look</h3>
      <div class="chips">${presets}</div>
      <h3>Pfp</h3>
      <div class="tiles" id="shape">
        <button type="button" class="tile" data-shape="circle"><span class="ico circle"></span>Circle</button>
        <button type="button" class="tile" data-shape="rounded"><span class="ico rounded"></span>Rounded</button>
        <label class="tile switch"><input type="checkbox" id="glow"><span class="knob"></span>Glow</label>
      </div>
      <h3>XP bar</h3>
      <div class="tiles" id="bar">
        <button type="button" class="tile" data-bar="gradient"><span class="ico fade"></span>Fade</button>
        <button type="button" class="tile" data-bar="solid"><span class="ico flat"></span>Flat</button>
      </div>
    </div>

    <div class="panel" data-panel="colours" hidden>
      <div class="wells">${colour('accent', 'Highlight', 'pfp ring and bar')}${colour('bg', 'Card', 'behind everything')}${colour('text', 'Text', 'name and numbers')}</div>
      <label class="slider">Dim the background <output id="tintOut"></output><input type="range" id="tint" min="0" max="100"><small>Covers the scenery or picture with your card colour so the text is easier to read.</small></label>
    </div>

    <div class="panel" data-panel="scenery" hidden>
      <div class="scenes">${backgrounds}<button type="button" class="scene" data-bg-builtin=""><span class="thumb plain"></span><span class="name">Plain</span></button></div>
    </div>

    <div class="panel" data-panel="picture" hidden>
      <label class="drop" id="drop"><input type="file" id="bgFile" accept="image/png,image/jpeg,image/webp,image/gif"><span class="plus">+</span><b id="dropText">Choose a picture</b><small>or drag one here · PNG, JPG, WebP or GIF, up to 8 MB</small></label>
      <div id="imageOptions">
        <div class="split">
          <div><h3>Which part shows</h3><div class="pad" id="pos">${positions}</div></div>
          <div class="grow"><label class="slider">Blur <output id="blurOut"></output><input type="range" id="blur" min="0" max="30"></label>
          <button type="button" class="ghost" id="clearImage">Remove picture</button></div>
        </div>
      </div>
    </div>
  </section>
</main>
<footer class="dock" id="dock" hidden><span class="muted small">You have unsaved changes</span><span class="right"><button type="button" class="ghost" id="discard">Undo changes</button><button type="button" class="primary" id="save">Save card</button></span></footer>
<div id="saved" class="toast"></div>`);
}

const EDITOR_CSS = `:root{--bg:#0d131c;--sheet:#151d29;--line:#253246;--text:#e6edf6;--muted:#8a9bb2;--blue:#4f93d6;--soft:#1d2838;--raised:#223047;--bar:#1f5a8f}
*{box-sizing:border-box}body{margin:0;color-scheme:dark;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding-bottom:24px}body.dirty{padding-bottom:90px}
.wrap{max-width:900px;margin:0 auto;padding:0 16px}.wrap.narrow{max-width:560px;padding-top:80px}
h1{margin:0 0 4px;font-size:28px}h3{font-size:14px;margin:20px 0 10px}h3:first-child{margin-top:4px}
.muted{color:var(--muted)}.small{font-size:13px}code{background:var(--soft);padding:1px 6px;border-radius:5px}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;background:var(--bar);color:#fff}
.top .muted{color:#cfe0f2;font-weight:400}.brand{font-weight:700;display:flex;align-items:center;gap:8px}
.logo{width:22px;height:22px;border-radius:50%;background:conic-gradient(#fff 0 25%,#9cc4ea 0 50%,#fff 0 75%,#9cc4ea 0)}
.pill{background:rgba(255,255,255,.18);border-radius:99px;padding:3px 12px;font-size:13px;white-space:nowrap}
.stage{position:sticky;top:0;z-index:2;background:var(--bg);padding:14px 0 8px}
.frame{background:#313338;border-radius:12px;padding:12px;box-shadow:0 6px 24px rgba(0,0,0,.45)}.frame img{width:100%;display:block;border-radius:8px;aspect-ratio:1000/330}
.stage p{margin:6px 2px 0}
.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin-top:10px;overflow-x:auto}
.tabs button{background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-2px;padding:10px 14px;font:inherit;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.tabs button.on{color:var(--blue);border-bottom-color:var(--blue)}
.sheet{background:var(--sheet);border:1px solid var(--line);border-top:0;border-radius:0 0 14px 14px;padding:18px}
.chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:10px}
.chip{background:none;border:0;padding:6px 2px;cursor:pointer;font:inherit;color:var(--text);display:flex;flex-direction:column;align-items:center;gap:6px;border-radius:12px}
.ball{width:54px;height:54px;border-radius:50%;border:3px solid var(--sheet);box-shadow:0 0 0 1px var(--line)}
.chip .name{font-size:12px;text-align:center;line-height:1.2}
.chip.on .ball{box-shadow:0 0 0 3px var(--blue)}.chip.on .name{color:var(--blue);font-weight:700}
.tiles{display:flex;gap:10px;flex-wrap:wrap}
.tile{display:flex;flex-direction:column;align-items:center;gap:6px;width:96px;padding:12px 6px 8px;background:var(--soft);border:2px solid transparent;border-radius:12px;font:inherit;font-size:13px;font-weight:600;color:var(--text);cursor:pointer}
.tile.on{border-color:var(--blue);background:var(--raised)}
.ico{display:block;width:34px;height:34px;background:var(--blue)}.ico.circle{border-radius:50%}.ico.rounded{border-radius:9px}
.ico.fade,.ico.flat{width:60px;height:10px;margin:12px 0;border-radius:5px}.ico.fade{background:linear-gradient(90deg,var(--blue),#9cc4ea)}
.switch input{position:absolute;opacity:0;pointer-events:none}
.knob{width:46px;height:26px;margin:4px 0;border-radius:13px;background:#3a4a62;position:relative;transition:background .15s}
.knob:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.switch input:checked+.knob{background:var(--blue)}.switch input:checked+.knob:after{left:23px}.switch input:focus-visible+.knob{outline:2px solid var(--blue);outline-offset:2px}
.wells{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.well{display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px}
.well small{color:var(--muted);font-size:12px;margin-bottom:6px}
.ring{width:72px;height:72px;border-radius:50%;overflow:hidden;border:4px solid var(--soft);box-shadow:0 0 0 1px var(--line),0 4px 10px rgba(0,0,0,.35);cursor:pointer;margin-bottom:8px;position:relative}
.ring input{position:absolute;inset:-10px;width:calc(100% + 20px);height:calc(100% + 20px);border:0;padding:0;cursor:pointer}
.well input[type=text]{width:100%;max-width:110px;text-align:center;font-family:ui-monospace,monospace}
input[type=text],input[type=url]{min-width:0;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit}
.scenes{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px}
.scene{background:none;border:0;padding:0;cursor:pointer;font:inherit;color:var(--text);text-align:left}
.thumb{display:block;height:64px;border-radius:10px;border:3px solid transparent;box-shadow:0 0 0 1px var(--line)}.thumb.plain{background:var(--soft)}
.scene .name{display:block;font-size:13px;margin:4px 2px 0}.scene.on .thumb{border-color:var(--blue);box-shadow:none}.scene.on .name{color:var(--blue);font-weight:700}
.drop{display:flex;flex-direction:column;align-items:center;gap:4px;padding:26px 16px;border:2px dashed var(--line);border-radius:14px;background:var(--soft);cursor:pointer;text-align:center;position:relative}.drop:hover,.drop.over{border-color:var(--blue)}.drop input{position:absolute;opacity:0;pointer-events:none;width:1px}.drop small{color:var(--muted)}.drop .plus{width:44px;height:44px;border-radius:50%;background:var(--blue);color:#fff;font-size:28px;line-height:42px;font-weight:700}.drop:focus-within{outline:2px solid var(--blue);outline-offset:2px}
#imageOptions{margin-top:16px}.split{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start}.grow{flex:1;min-width:200px;padding-top:28px}
.pad{display:grid;grid-template-columns:repeat(3,64px);grid-template-rows:repeat(3,40px);gap:4px}
.pad button{background:var(--soft);border:2px solid transparent;border-radius:8px;font:inherit;font-size:12px;color:var(--text);cursor:pointer;padding:0}.pad button.on{border-color:var(--blue);background:var(--raised);font-weight:700}
.pos-top{grid-area:1/2}.pos-left{grid-area:2/1}.pos-centre{grid-area:2/2}.pos-right{grid-area:2/3}.pos-bottom{grid-area:3/2}
.slider{display:block;font-weight:600;margin-top:18px}.grow .slider{margin-top:0}.slider input{width:100%;accent-color:var(--blue)}.slider output{float:right;color:var(--muted);font-weight:400}.slider small{display:block;font-weight:400;color:var(--muted)}
button.ghost{background:var(--soft);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:9px 14px;font:inherit;cursor:pointer}
#clearImage{margin-top:14px}
.dock{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--sheet);border-top:1px solid var(--line);box-shadow:0 -4px 14px rgba(0,0,0,.35);z-index:5}
.dock[hidden]{display:none}.dock .right{display:flex;gap:8px;margin-left:auto}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--blue);color:#fff;border-radius:99px;padding:7px 16px;font-size:14px;white-space:nowrap;max-width:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis;z-index:6}.toast:empty{display:none}body.dirty .toast{bottom:84px}
.topright{display:flex;align-items:center;gap:8px}.topbtn{background:none;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:99px;padding:3px 12px;font:inherit;font-size:13px;cursor:pointer}.topbtn:hover{background:rgba(255,255,255,.12)}
.dock .primary{background:var(--blue);border:0;color:#fff;border-radius:9px;padding:10px 18px;font:inherit;font-weight:700;cursor:pointer}
@media(max-width:620px){.wells{grid-template-columns:minmax(0,1fr)}.well{flex-direction:row;flex-wrap:wrap;justify-content:flex-start;text-align:left;gap:4px 12px}.ring{width:52px;height:52px;margin:0}.well small{margin:0;flex-basis:100%;order:3}
.dock{padding:10px 12px;gap:6px}.dock>.muted{display:none}.top .muted{display:none}.dock button{padding:9px 10px!important;font-size:14px!important}.tabs button{flex:1;padding:10px 4px;font-size:14px}.tile{width:84px}.grow{padding-top:0}}`;

const EDITOR_JS = `(() => {
  const root = document.getElementById('editor');
  if (!root) return;
  const token = root.dataset.token;
  const saved = JSON.parse(root.dataset.prefs);
  let prefs = { ...saved };
  const $ = (id) => document.getElementById(id);
  const all = (sel) => document.querySelectorAll(sel);
  let img = $('preview');
  const status = $('status');

  all('.tabs button').forEach((t) => t.addEventListener('click', () => {
    all('.tabs button').forEach((x) => x.classList.toggle('on', x === t));
    all('.panel').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  all('.scene[data-css] .thumb').forEach((t) => { t.style.background = t.parentElement.dataset.css; });
  all('.chip').forEach((b) => { b.querySelector('.ball').style.background = 'linear-gradient(135deg,' + b.dataset.bg + ' 50%,' + b.dataset.accent + ' 50%)'; });

  const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(v);
  const changed = () => JSON.stringify(prefs) !== JSON.stringify(saved);
  function syncDock() { const dirty = changed(); $('dock').hidden = !dirty; document.body.classList.toggle('dirty', dirty); }
  let toastTimer = null;
  function say(text) { $('saved').textContent = text; clearTimeout(toastTimer); if (text) toastTimer = setTimeout(() => { $('saved').textContent = ''; }, 4000); }
  function fill() {
    for (const key of ['accent', 'bg', 'text']) { $(key).value = prefs[key]; $(key + 'Hex').value = prefs[key]; }
    $('glow').checked = prefs.glow;
    $('blur').value = prefs.blur; $('blurOut').textContent = prefs.blur + 'px';
    $('tint').value = prefs.tint; $('tintOut').textContent = prefs.tint + '%';
    $('imageOptions').hidden = !prefs.bgImage;
    all('#bar .tile').forEach((b) => b.classList.toggle('on', b.dataset.bar === prefs.bar));
    all('#shape [data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === prefs.shape));
    $('glow').parentElement.classList.toggle('on', prefs.glow);
    all('#pos button').forEach((b) => b.classList.toggle('on', b.dataset.pos === prefs.bgPos));
    all('.scene').forEach((b) => b.classList.toggle('on', (b.dataset.bgBuiltin || null) === prefs.bgBuiltin && !prefs.bgImage));
    syncDock();
  }

  let timer = null; let busy = false; let again = false;
  function refresh() {
    clearTimeout(timer);
    status.textContent = 'Updating...';
    timer = setTimeout(load, 350);
  }
  function load() {
    if (busy) { again = true; return; }
    busy = true;
    const q = btoa(unescape(encodeURIComponent(JSON.stringify(prefs)))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    const next = new Image();
    next.onload = () => { next.id = 'preview'; next.alt = img.alt; img.replaceWith(next); img = next; done(changed() ? 'Not saved yet' : 'Up to date'); };
    next.onerror = () => done('Could not draw it. If you added a picture, check the link opens an image.');
    next.src = '/card/' + token + '/preview.png?p=' + q + '&t=' + Date.now();
  }
  function done(text) {
    busy = false;
    status.textContent = text;
    if (again) { again = false; load(); }
  }
  function change(patch) { prefs = { ...prefs, ...patch }; fill(); refresh(); say(''); }

  all('.chip').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset];
    change({ accent: p.accent, bg: p.bg, text: p.text, bgBuiltin: p.bgBuiltin, bgImage: null, barColor: null });
    all('.chip').forEach((x) => x.classList.toggle('on', x === b));
  }));
  for (const key of ['accent', 'bg', 'text']) {
    $(key).addEventListener('input', () => change({ [key]: $(key).value }));
    $(key + 'Hex').addEventListener('change', () => { const v = $(key + 'Hex').value.trim(); if (hexOk(v)) change({ [key]: v.toLowerCase() }); else fill(); });
  }
  all('#bar .tile').forEach((b) => b.addEventListener('click', () => change({ bar: b.dataset.bar })));
  all('#shape [data-shape]').forEach((b) => b.addEventListener('click', () => change({ shape: b.dataset.shape })));
  all('#pos button').forEach((b) => b.addEventListener('click', () => change({ bgPos: b.dataset.pos })));
  $('glow').addEventListener('change', () => change({ glow: $('glow').checked }));
  $('blur').addEventListener('input', () => change({ blur: Number($('blur').value) }));
  $('tint').addEventListener('input', () => change({ tint: Number($('tint').value) }));
  all('.scene').forEach((b) => b.addEventListener('click', () => change({ bgBuiltin: b.dataset.bgBuiltin || null, bgImage: null })));
  async function upload(file) {
    if (!file) return;
    if (!/^image\\/(png|jpeg|webp|gif)$/.test(file.type)) { say('That has to be a PNG, JPG, WebP or GIF.'); return; }
    if (file.size > 8 * 1024 * 1024) { say('That picture is too big. The limit is 8 MB.'); return; }
    $('dropText').textContent = 'Uploading...';
    try {
      const res = await fetch('/card/' + token + '/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (res.status === 410) { say('This link has expired. Run .rank again for a new one.'); return; }
      const result = res.ok ? await res.json() : null;
      if (!result) { say(res.status === 429 ? 'Slow down a little, then try again.' : "Couldn't use that picture. Try a different one."); return; }
      change({ bgImage: result.ref, bgBuiltin: null, tint: prefs.tint || 35 });
    } catch { say('Upload failed. Check your connection and try again.'); }
    finally { $('dropText').textContent = 'Choose a different picture'; $('bgFile').value = ''; }
  }
  $('bgFile').addEventListener('change', () => upload($('bgFile').files[0]));
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); });
  $('clearImage').addEventListener('click', () => change({ bgImage: null, bgBuiltin: 'sky' }));

  async function post(path, body) {
    const res = await fetch('/card/' + token + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (res.status === 410) { say('This link has expired. Run .rank again for a new one.'); return null; }
    return res.ok ? res.json() : null;
  }
  $('save').addEventListener('click', async () => {
    const result = await post('/save', prefs);
    if (result) { Object.assign(saved, result.prefs); prefs = { ...result.prefs }; fill(); status.textContent = 'Up to date'; say('Saved! .rank shows this card now.'); }
    else if (!$('saved').textContent) say('Could not save. Try again.');
  });
  $('discard').addEventListener('click', () => { prefs = { ...saved }; fill(); refresh(); say('Back to your saved card.'); });
  $('reset').addEventListener('click', async () => {
    if (!confirm('Go back to the default card? Your saved card will be replaced.')) return;
    const result = await post('/reset');
    if (result) { Object.assign(saved, result.prefs); prefs = { ...result.prefs }; fill(); refresh(); say('Started over with the default card.'); }
  });

  const PRESETS = ${JSON.stringify(PRESETS)};
  fill();
})();`;

const ASSET_VERSION = require('node:crypto').createHash('sha1').update(EDITOR_CSS + EDITOR_JS).digest('hex').slice(0, 10);

async function handleCardRoute(ctx, req, res, pathname, url) {
  if (!pathname.startsWith('/card/')) return false;
  const method = req.method;

  if (pathname === '/card/assets/editor.css' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(EDITOR_CSS);
    return true;
  }
  if (pathname === '/card/assets/editor.js' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.end(EDITOR_JS);
    return true;
  }

  const match = pathname.match(/^\/card\/([A-Za-z0-9_-]{20,64})(\/preview\.png|\/save|\/reset|\/upload)?$/);
  if (!match) return false;
  const [, token, action] = match;
  const entry = checkEditorToken(token);
  const html = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (!entry) {
    if (!action) html(410, expiredPage());
    else json(410, { error: 'expired' });
    return true;
  }

  if (!action && method === 'GET') {
    html(200, editorPage(token, getPrefs(entry.userId)));
    return true;
  }

  if (action === '/preview.png' && method === 'GET') {
    const now = Date.now();
    if (now - (lastRender.get(token) ?? 0) < 250) { json(429, { error: 'slow down' }); return true; }
    lastRender.set(token, now);
    let prefs = getPrefs(entry.userId);
    const raw = url.searchParams.get('p');
    if (raw) {
      try { prefs = sanitize(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))); } catch {}
    }
    const png = await cardFor(ctx, entry, prefs).catch((err) => { console.error('[card editor]', err.message); return null; });
    if (!png) { json(404, { error: 'not found' }); return true; }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from(png));
    return true;
  }

  if (action === '/save' && method === 'POST') {
    const body = await readJson(req);
    if (!body) { json(400, { error: 'bad request' }); return true; }
    json(200, { prefs: setPrefs(entry.userId, body) });
    return true;
  }

  if (action === '/upload' && method === 'POST') {
    const now = Date.now();
    if (now - (lastUpload.get(token) ?? 0) < 2000) { json(429, { error: 'slow down' }); return true; }
    lastUpload.set(token, now);
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(req.headers['content-type'] ?? '')) { json(415, { error: 'images only' }); return true; }
    const body = await readBody(req, MAX_UPLOAD_BYTES);
    if (!body?.length) { json(413, { error: 'too big' }); return true; }
    const ref = await saveUpload(entry.userId, body).catch((err) => { console.error('[card editor] upload:', err.message); return null; });
    if (!ref) { json(400, { error: 'not an image' }); return true; }
    json(200, { ref });
    return true;
  }

  if (action === '/reset' && method === 'POST') {
    resetPrefs(entry.userId);
    json(200, { prefs: getPrefs(entry.userId) });
    return true;
  }

  json(405, { error: 'method not allowed' });
  return true;
}

module.exports = { handleCardRoute };
