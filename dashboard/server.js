'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { THEME } = require('../theme');
const auth = require('./auth');
const { handleCardRoute } = require('./cardeditor');

const PORT = Number(process.env.DASHBOARD_PORT) || 3000;
const FRIENDLY_ERRORS = process.env.DASHBOARD_FRIENDLY_ERRORS === 'true';

const LEVEL_API_URL = process.env.LEVEL_API_URL || '';
const LEVEL_API_TOKEN = process.env.LEVEL_API_TOKEN || '';
async function levelApi(method, pathname, body) {
    if (!LEVEL_API_URL || !LEVEL_API_TOKEN) throw new Error('level api not configured');
    const res = await fetch(`${LEVEL_API_URL}${pathname}`, {
        method,
        headers: { 'x-api-token': LEVEL_API_TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`level api ${res.status}`);
    return res.json();
}
const BIND_HOST = '127.0.0.1';
const PUBLIC_HOST = (process.env.DASHBOARD_HOST || 'ruby-bot.lol').toLowerCase();
const COOKIE_NAME = '__Host-ruby_dash';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 10;
const MAX_BODY_BYTES = 8 * 1024;
const AUDIT_FILE = path.join(auth.DASHBOARD_DIR, 'audit.log');
const SNOWFLAKE = /^\d{17,20}$/;

const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_ON = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);

const CSS = fs.readFileSync(path.join(__dirname, 'static', 'app.css'));

const sessions = new Map();
const ipAttempts = new Map();

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`=/]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function clientIp(req) {
    const socketIp = req.socket.remoteAddress || '';
    const fromLocal = socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1';
    const cf = req.headers['cf-connecting-ip'];
    return fromLocal && typeof cf === 'string' && cf.length < 64 ? cf : socketIp;
}

function audit(line) {
    try {
        auth.ensureDir();
        fs.appendFileSync(AUDIT_FILE, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    } catch (err) {
        console.error('[dashboard] could not write audit log:', err.message);
    }
}

function allowedHost(req) {
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    return host === PUBLIC_HOST || host === 'localhost' || host === '127.0.0.1';
}

function allowedOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return true;
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    try {
        const originHost = new URL(origin).hostname.toLowerCase();
        if (originHost === host || originHost === PUBLIC_HOST || originHost === 'localhost' || originHost === '127.0.0.1') return true;
    } catch {}
    console.warn(`[dashboard] blocked cross-origin POST: origin=${origin} host=${req.headers.host}`);
    return false;
}

function setSecurityHeaders(res) {
    const turnstile = TURNSTILE_ON ? ' https://challenges.cloudflare.com' : '';
    res.setHeader('Content-Security-Policy', [
        "default-src 'none'",
        `script-src 'self'${turnstile}`,
        `frame-src${turnstile || " 'none'"}`,
        `connect-src 'self'${turnstile}`,
        "style-src 'self'",
        "img-src 'self' data: https://cdn.discordapp.com https://i.ytimg.com",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

function send(res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
    res.writeHead(303, { Location: location, ...extraHeaders });
    res.end();
}

function readForm(req) {
    return new Promise((resolve, reject) => {
        const type = String(req.headers['content-type'] || '');
        if (!type.startsWith('application/x-www-form-urlencoded')) return reject(new Error('bad-type'));
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.removeAllListeners('data');
                req.resume();
                reject(new Error('too-big'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
        req.on('error', reject);
    });
}

function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}

function createSession(username, ip) {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(sha256(token), {
        username,
        csrf: crypto.randomBytes(24).toString('base64url'),
        createdAt: Date.now(),
        lastSeen: Date.now(),
        ip,
        flash: null,
    });
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_SESSION_MS / 1000}`;
}

const CLEAR_COOKIE = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const loginCodes = new Map();
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;

function pruneLoginCodes() {
    const now = Date.now();
    for (const [t, v] of loginCodes) if (v.expires <= now) loginCodes.delete(t);
}

function createLoginCode(username) {
    pruneLoginCodes();
    const name = auth.normalizeUsername(username);
    if (!auth.loadUsers()[name]) return { error: `No dashboard account called "${name}". Create one with: node dashboard/users.js add <name>` };
    const token = crypto.randomBytes(24).toString('base64url');
    loginCodes.set(token, { username: name, expires: Date.now() + LOGIN_CODE_TTL_MS });
    return { token, url: `https://${PUBLIC_HOST}/otc/${token}`, username: name, minutes: Math.round(LOGIN_CODE_TTL_MS / 60000) };
}

function redeemLoginCode(rawToken) {
    pruneLoginCodes();
    const token = String(rawToken ?? '').trim();
    const entry = token && loginCodes.get(token);
    if (!entry) return null;
    loginCodes.delete(token);
    return entry.username;
}

function getSession(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token || token.length > 100) return null;
    const key = sha256(token);
    const session = sessions.get(key);
    if (!session) return null;
    const now = Date.now();
    const user = auth.loadUsers()[session.username];
    const expired = now - session.lastSeen > IDLE_TIMEOUT_MS
        || now - session.createdAt > MAX_SESSION_MS
        || !user
        || (user.sessionsValidAfter && session.createdAt < user.sessionsValidAfter);
    if (expired) {
        sessions.delete(key);
        return null;
    }
    session.lastSeen = now;
    session.key = key;
    return session;
}

function takeFlash(session) {
    const flash = session.flash;
    session.flash = null;
    return flash;
}

function ipBlocked(ip) {
    const now = Date.now();
    const recent = (ipAttempts.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
    ipAttempts.set(ip, recent);
    return recent.length >= IP_MAX_ATTEMPTS;
}

function noteIpFailure(ip) {
    const list = ipAttempts.get(ip) || [];
    list.push(Date.now());
    ipAttempts.set(ip, list);
}

async function verifyTurnstile(token, ip) {
    if (!TURNSTILE_ON) return true;
    if (!token || token.length > 4096) return false;
    try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
            signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();
        return data.success === true;
    } catch (err) {
        console.error('[dashboard] Turnstile check failed:', err.message);
        return false;
    }
}

const LOGO_LETTER = escapeHtml((THEME.botName || 'B').trim().charAt(0).toUpperCase());
const LOGO = `<span class="logo" aria-hidden="true">${LOGO_LETTER}</span>`;
const FAVICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230f6cbd'/%3E%3Ctext x='16' y='23' font-family='Segoe UI,Arial,sans-serif' font-size='20' font-weight='700' fill='white' text-anchor='middle'%3E${encodeURIComponent(LOGO_LETTER)}%3C/text%3E%3C/svg%3E`;
const SITE_FOOTER = `<footer class="site-footer"><span>${THEME.botName}</span><span class="dot">·</span><span>Music, moderation &amp; security</span></footer>`;

function layout({ title, body, session }) {
    const nav = session
        ? `<header class="topbar"><a class="brand" href="/">${LOGO}<span>${THEME.botName} Dashboard</span></a>
             <div class="topbar-right"><span class="who">${escapeHtml(session.username)}</span>
             <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button class="btn subtle small">Sign out</button></form></div></header>`
        : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#ffffff">
<title>${escapeHtml(title)} · ${THEME.botName} Dashboard</title>
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/static/app.css">
${TURNSTILE_ON && !session ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
</head><body>${nav}<main>${body}</main>${SITE_FOOTER}</body></html>`;
}

function flashHtml(flash) {
    if (!flash) return '';
    return `<p class="flash ${flash.ok ? 'ok' : 'err'}">${escapeHtml(flash.text)}</p>`;
}

function loginPage(message) {
    return layout({
        title: 'Log in',
        body: `<section class="card login">
  <div class="login-head">${LOGO}<h1>${THEME.botName} Dashboard</h1></div>
  <p class="tag">Sign in to continue. Staff only.</p>
  ${message ? `<p class="flash err">${escapeHtml(message)}</p>` : ''}
  <form method="post" action="/login" autocomplete="on">
    <label>Username <input name="username" autocomplete="username" required maxlength="32" autocapitalize="none" spellcheck="false"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
    ${auth.REQUIRE_2FA ? '<label>Authenticator code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required maxlength="7"></label>' : ''}
    ${TURNSTILE_ON ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(TURNSTILE_SITE_KEY)}" data-theme="dark"></div>` : ''}
    <button class="btn">Log in</button>
  </form>
  <details class="otc">
    <summary>Use a one-time code</summary>
    <form method="post" action="/otc" autocomplete="off">
      <label>One-time code <input name="code" autocomplete="off" spellcheck="false" required maxlength="80" placeholder="Paste the code the bot sent you"></label>
      <button class="btn ghost">Log in with code</button>
    </form>
  </details>
</section>`,
    });
}

function otcConfirmPage(token) {
    return layout({
        title: 'Log in',
        body: `<section class="card login">
  <div class="login-head">${LOGO}<h1>${THEME.botName} Dashboard</h1></div>
  <p class="tag">Press the button to log in with your one-time link.</p>
  <form method="post" action="/otc" autocomplete="off">
    <input type="hidden" name="code" value="${escapeHtml(token)}">
    <button class="btn">Log in</button>
  </form>
</section>`,
    });
}

function csrfField(session) {
    return `<input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">`;
}

function guildIcon(guild) {
    const url = guild.iconURL?.({ size: 64, extension: 'png' });
    return url
        ? `<img class="icon" src="${escapeHtml(url)}" alt="">`
        : `<span class="icon letter">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
}

function statsHtml(ctx) {
    const { client } = ctx;
    const mem = process.memoryUsage();
    return `<div class="stats">
  <div><span>Status</span><b class="good">Online</b></div>
  <div><span>Uptime</span><b>${formatUptime(Date.now() - ctx.BOT_START_TIME)}</b></div>
  <div><span>Ping</span><b>${Math.round(client.ws.ping)} ms</b></div>
  <div><span>Servers</span><b>${client.guilds.cache.size}</b></div>
  <div><span>Memory</span><b>${Math.round(mem.rss / 1024 / 1024)} MB</b></div>
</div>`;
}

function homePage(ctx, session) {
    const guilds = [...ctx.client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    const eq = '<span class="badge-play"><span class="eq"><i></i><i></i><i></i></span> Playing</span>';
    const cards = guilds.map((g) => {
        const playing = ctx.distube.getQueue(g.id);
        return `<a class="guild" href="/g/${g.id}">${guildIcon(g)}<span><b>${escapeHtml(g.name)}</b>
      <small>${g.memberCount.toLocaleString('en-US')} members${playing ? ` · ${eq}` : ''}</small></span></a>`;
    }).join('');
    return layout({
        title: 'Home',
        session,
        body: `${flashHtml(takeFlash(session))}
<div class="page-head">
  <h1>Good to see you, ${escapeHtml(session.username)}</h1>
  <p>Manage ${THEME.botName}'s music, moderation and security across your servers.</p>
</div>
<section class="card"><h2>Overview</h2>${statsHtml(ctx)}</section>
<section class="card"><h2>Your servers</h2><div class="guilds">${cards || `<p class="muted">${THEME.botName} isn't in any servers.</p>`}</div></section>`,
    });
}

function songTitle(ctx, song) {
    const info = ctx.songInfo.get(song.url);
    const title = info?.title ?? song.name ?? 'Unknown song';
    const duration = info ? ctx.formatDuration(info.duration) : (song.formattedDuration ?? '');
    return { title, duration };
}

function musicHtml(ctx, guild, session) {
    const queue = ctx.distube.getQueue(guild.id);
    if (!queue || !queue.songs?.length) {
        return '<p class="muted">Nothing is playing. Use the play command in Discord to start music.</p>';
    }
    const [current, ...upcoming] = queue.songs;
    const now = songTitle(ctx, current);
    const voice = queue.voice?.channel?.name;
    const button = (action, label, cls = '') => `<form method="post" action="/g/${guild.id}/music">${csrfField(session)}<input type="hidden" name="_tab" value="music">
      <input type="hidden" name="action" value="${action}"><button class="btn ${cls}">${label}</button></form>`;
    const list = upcoming.slice(0, 25).map((song, i) => {
        const s = songTitle(ctx, song);
        return `<li><span>${i + 1}. ${escapeHtml(s.title)}</span><small>${escapeHtml(s.duration)}</small></li>`;
    }).join('');
    const more = upcoming.length > 25 ? `<p class="muted">...and ${upcoming.length - 25} more.</p>` : '';
    return `<div class="now">
  <div><span class="stage-label">${queue.paused ? 'Paused' : 'Now playing'}${voice ? ` · ${escapeHtml(voice)}` : ''}</span>
  <h3>${escapeHtml(now.title)}</h3><small class="muted">${escapeHtml(now.duration)}</small></div>
  <div class="controls">
    ${queue.paused ? button('resume', '▶️ Resume') : button('pause', '⏸️ Pause')}
    ${button('skip', '⏭️ Skip')}
    ${upcoming.length ? button('clear', '🧹 Clear setlist', 'ghost') : ''}
    ${button('stop', '⏹️ Stop', 'danger')}
  </div>
</div>
<h3>Up next (${upcoming.length})</h3>
${list ? `<ol class="queue">${list}</ol>${more}` : '<p class="muted">Nothing queued after this song.</p>'}`;
}

function guildChannelOptions(guild, selId, placeholder) {
    const me = guild.members.me;
    const channels = [...guild.channels.cache.values()]
        .filter((c) => c.isTextBased?.() && !c.isThread?.() && !c.isVoiceBased?.())
        .filter((c) => !me || c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']))
        .sort((a, b) => a.rawPosition - b.rawPosition);
    return `<option value="">${placeholder}</option>` + channels.map((c) => `<option value="${c.id}"${c.id === selId ? ' selected' : ''}>#${escapeHtml(c.name)}</option>`).join('');
}

function overviewSection(ctx, guild, session) {
    const sec = ctx.securitySettings.get(guild.id) ?? {};
    const csrf = csrfField(session);
    const raidOn = Boolean(ctx.isRaidMode?.(guild.id));
    const tile = (label, on, detail) => `<div class="mod-tile"><span class="dot ${on ? 'on' : 'off'}"></span><div><b>${label}</b><small>${detail}</small></div></div>`;
    const tiles = [
        tile('Anti-nuke', true, `${sec.limits ?? 'normal'} · ${sec.punish ?? 'strip'}`),
        tile('Verification gate', Boolean(sec.verify?.enabled), sec.verify?.enabled ? 'On' : 'Off'),
        tile('Raid mode', raidOn, raidOn ? 'Active' : 'Off'),
        tile('Server lockdown', Boolean(sec.lockdown), sec.lockdown ? 'Locked' : 'Off'),
        tile('Account-age gate', Boolean(sec.minAge), sec.minAge ? `${sec.minAge.days}d · ${sec.minAge.action}` : 'Off'),
        tile('Trusted members', (sec.trusted ?? []).length > 0, `${(sec.trusted ?? []).length}`),
        tile('Backups', ctx.listBackups(guild.id).length > 0, `${ctx.listBackups(guild.id).length} saved`),
    ].join('');
    return `<section class="card"><h2>At a glance</h2><div class="mod-grid">${tiles}</div></section>
<section class="card"><h2>General</h2>
  <form method="post" action="/g/${guild.id}/settings" class="settings">${csrf}<input type="hidden" name="_tab" value="overview">
    <label>Command prefix <input name="prefix" value="${escapeHtml(ctx.getPrefix(guild.id))}" required maxlength="2" pattern="\\S{1,2}"></label>
    <button class="btn">Save</button>
  </form>
</section>`;
}

function securitySection(ctx, guild, session) {
    const sec = ctx.securitySettings.get(guild.id) ?? {};
    const csrf = csrfField(session);
    const sel = (v, cur) => (v === cur ? ' selected' : '');
    const limits = sec.limits ?? 'normal';
    const punish = sec.punish ?? 'strip';
    const minDays = sec.minAge?.days ?? 0;
    const minAction = sec.minAge?.action ?? 'timeout';
    const trusted = sec.trusted ?? [];
    const raidOn = Boolean(ctx.isRaidMode?.(guild.id));
    const lockOn = Boolean(sec.lockdown);
    const verify = sec.verify?.enabled ? sec.verify : null;
    const vChanName = verify ? (guild.channels.cache.get(verify.channelId)?.name ?? verify.channelId) : '';
    const vRoleName = verify ? (guild.roles.cache.get(verify.roleId)?.name ?? 'Unverified') : '';
    const toggle = (name, label, hint, isOn) => `<form method="post" action="/g/${guild.id}/switch" class="switch-row">${csrf}<input type="hidden" name="_tab" value="security">
    <input type="hidden" name="name" value="${name}"><input type="hidden" name="value" value="${isOn ? 'off' : 'on'}">
    <div class="switch-text"><b>${label}</b><small>${hint}</small></div>
    <button class="switch${isOn ? ' on' : ''}" type="submit" aria-pressed="${isOn}"><span class="track"><span class="thumb"></span></span></button></form>`;
    const chips = trusted.length
        ? `<div class="chips">${trusted.map((id) => `<span class="chip">${escapeHtml(id)}<form method="post" action="/g/${guild.id}/trusted">${csrf}<input type="hidden" name="_tab" value="security"><input type="hidden" name="action" value="remove"><input type="hidden" name="userId" value="${escapeHtml(id)}"><button class="chip-x" type="submit" aria-label="Remove">×</button></form></span>`).join('')}</div>`
        : '<p class="muted">No trusted members yet.</p>';
    return `
<section class="card"><h2>Anti-nuke</h2>
  <form method="post" action="/g/${guild.id}/settings" class="settings">${csrf}<input type="hidden" name="_tab" value="security">
    <label>Strictness <select name="limits"><option value="strict"${sel('strict', limits)}>Strict - acts sooner</option><option value="normal"${sel('normal', limits)}>Normal</option><option value="relaxed"${sel('relaxed', limits)}>Relaxed - acts later</option></select></label>
    <label>Punishment <select name="punish"><option value="strip"${sel('strip', punish)}>Remove their roles</option><option value="kick"${sel('kick', punish)}>Kick them</option><option value="ban"${sel('ban', punish)}>Ban them</option></select></label>
    <label>Minimum account age <input type="number" name="minAgeDays" min="0" max="365" value="${minDays}"><small class="hint">In days. 0 turns the gate off.</small></label>
    <label>Action for new accounts <select name="minAgeAction"><option value="timeout"${sel('timeout', minAction)}>Time out until old enough</option><option value="kick"${sel('kick', minAction)}>Kick</option></select></label>
    <button class="btn">Save</button>
  </form>
</section>
<section class="card"><h2>Live controls</h2>
  ${toggle('raid', 'Raid mode', 'Quarantines brand-new accounts as they join. Turns itself off after 1 hour.', raidOn)}
  ${toggle('lockdown', 'Server lockdown', 'Stops everyone posting in every channel at once. Turn off to restore.', lockOn)}
</section>
<section class="card"><h2>Verification gate</h2>
  ${verify
        ? `<p class="muted">On in <b>#${escapeHtml(vChanName)}</b> · role <b>${escapeHtml(vRoleName)}</b>. New members must pass a captcha before they can see or chat.</p>
       <form method="post" action="/g/${guild.id}/verify">${csrf}<input type="hidden" name="_tab" value="security"><input type="hidden" name="action" value="off"><button class="btn danger">Turn off</button></form>`
        : `<p class="muted">Require new members to pass a quick captcha before they can see or chat. ${THEME.botName} hides every other channel behind an <b>Unverified</b> role and posts a Verify button in the channel you pick.</p>
       <form method="post" action="/g/${guild.id}/verify" class="inline-add">${csrf}<input type="hidden" name="_tab" value="security"><input type="hidden" name="action" value="on">
         <label>Verification channel <select name="channelId" required>${guildChannelOptions(guild, '', 'Choose a channel...')}</select></label>
         <button class="btn">Turn on</button></form>`}
</section>
<section class="card"><h2>Trusted members</h2>
  <p class="muted">Trusted people are exempt from auto-undo, and from anti-nuke unless they go far past the limits.</p>
  ${chips}
  <form method="post" action="/g/${guild.id}/trusted" class="inline-add">${csrf}<input type="hidden" name="_tab" value="security"><input type="hidden" name="action" value="add">
    <label>Add by user ID <input name="userId" pattern="\\d{17,20}" placeholder="e.g. 123456789012345678" required></label>
    <button class="btn subtle">Add</button></form>
</section>
<section class="card"><h2>Discord AutoMod</h2>
  <p class="muted">Set up the built-in AutoMod rules ${THEME.botName} manages - they block CSAM ads, invites and spam before anyone sees them.</p>
  <form method="post" action="/g/${guild.id}/automod">${csrf}<input type="hidden" name="_tab" value="security"><button class="btn">Set up / refresh AutoMod</button></form>
</section>
<section class="card"><h2>Custom auto-moderation</h2>
  <p class="muted">${THEME.botName} removes matching messages. Leave blank or 0 to turn a filter off. Staff are never affected.</p>
  <form method="post" action="/g/${guild.id}/automodcfg" class="settings">${csrf}<input type="hidden" name="_tab" value="security">
    <label>Blocked words <small class="hint">Comma-separated words or phrases.</small><input name="words" value="${escapeHtml((sec.automod?.words ?? []).join(', '))}" maxlength="1000"></label>
    <label>Caps filter % <small class="hint">40-100; messages this % uppercase are removed.</small><input type="number" name="caps" min="0" max="100" value="${sec.automod?.caps ?? 0}"></label>
    <label>Max mentions <small class="hint">3-20 user mentions in one message.</small><input type="number" name="mentions" min="0" max="20" value="${sec.automod?.mentions ?? 0}"></label>
    <label>Max emojis <small class="hint">3-50 emojis in one message.</small><input type="number" name="emoji" min="0" max="50" value="${sec.automod?.emoji ?? 0}"></label>
    <button class="btn">Save auto-mod</button>
  </form>
</section>`;
}

function loggingSection(ctx, guild, session) {
    const sec = ctx.securitySettings.get(guild.id) ?? {};
    const csrf = csrfField(session);
    return `<section class="card"><h2>Logging</h2>
  <p class="muted">Where ${THEME.botName} posts logs. Leave on ${THEME.botName}'s default to use the built-in channels.</p>
  <form method="post" action="/g/${guild.id}/settings" class="settings">${csrf}<input type="hidden" name="_tab" value="logging">
    <label>Security alerts <select name="alertChannelId">${guildChannelOptions(guild, sec.alertChannelId || '', `(${THEME.botName}'s default)`)}</select></label>
    <label>Message log <small class="hint">Edited &amp; deleted messages.</small><select name="messageLogChannelId">${guildChannelOptions(guild, sec.messageLogChannelId || '', `(${THEME.botName}'s default)`)}</select></label>
    <label>Member log <small class="hint">Joins &amp; leaves.</small><select name="modLogChannelId">${guildChannelOptions(guild, sec.modLogChannelId || '', `(${THEME.botName}'s default)`)}</select></label>
    <button class="btn">Save logging</button>
  </form>
</section>`;
}

function musicSection(ctx, guild, session) {
    return `<section class="card"><h2>Music</h2>${musicHtml(ctx, guild, session)}</section>`;
}

function backupsHtml(ctx, guild, session) {
    const csrf = csrfField(session);
    const list = ctx.listBackups(guild.id).slice(0, 10);
    const rows = list.map((b) => {
        let counts = '';
        try { const s = JSON.parse(fs.readFileSync(b.file, 'utf8')); counts = `${s.roles?.length ?? 0} roles · ${s.channels?.length ?? 0} channels`; } catch { counts = 'unreadable'; }
        const when = new Date(b.takenAt).toISOString().slice(0, 16).replace('T', ' ');
        return `<li><div><b>${when} UTC</b><small>${escapeHtml(b.reason)} · ${counts}</small></div>
      <div class="row-actions">
        <a class="btn subtle small" href="/g/${guild.id}/backup?dl=${b.takenAt}">Download</a>
        <form method="post" action="/g/${guild.id}/backup">${csrf}<input type="hidden" name="_tab" value="backups"><input type="hidden" name="action" value="restore"><input type="hidden" name="takenAt" value="${b.takenAt}"><button class="btn small">Restore</button></form>
      </div></li>`;
    }).join('');
    return `<section class="card"><h2>Backups</h2>
  <p class="muted">Snapshots of roles, channels and who has which role. Restoring only re-creates what's missing - it never deletes anything that still exists. Saved automatically each day; the last 10 are kept.</p>
  <form method="post" action="/g/${guild.id}/backup">${csrf}<input type="hidden" name="_tab" value="backups"><input type="hidden" name="action" value="create"><button class="btn">Create backup now</button></form>
  ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="muted">No backups yet.</p>'}
</section>`;
}

const GUILD_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'security', label: 'Moderation & Security' },
    { id: 'logging', label: 'Logging' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'leveling', label: 'Leveling' },
    { id: 'music', label: 'Music' },
    { id: 'community', label: 'Community' },
    { id: 'economy', label: 'Economy' },
    { id: 'backups', label: 'Backups' },
];

function economySection(ctx, guild, session) {
    const csrf = csrfField(session);
    const d = ctx.getEconomyOverview(guild);
    const medals = ['🥇', '🥈', '🥉'];
    const rich = d.rich.map((e, i) => `<li><div><b>${medals[i] ?? `${i + 1}.`} ${escapeHtml(guild.members.cache.get(e.id)?.user.username ?? e.id)}</b><small>${THEME.currency}${e.worth.toLocaleString('en-US')} net · ${THEME.currency}${e.cash.toLocaleString('en-US')} cash</small></div></li>`).join('');
    const stocks = d.stocks.map((s) => `<li><div><b>${s.t}</b><small>${escapeHtml(s.name)}</small></div><span>${THEME.currency}${s.price.toLocaleString('en-US')}</span></li>`).join('');
    const crypto = (d.crypto ?? []).map((c) => `<li><div><b>${c.t}</b><small>${escapeHtml(c.name)}</small></div><span>${THEME.currency}${c.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></li>`).join('');
    return `<section class="card"><h2>Rich list</h2>${rich ? `<ul class="rows">${rich}</ul>` : '<p class="muted">No one has earned yen yet.</p>'}</section>
<section class="card"><h2>Stock market</h2><ul class="rows">${stocks}</ul></section>
<section class="card"><h2>Crypto market</h2>${crypto ? `<ul class="rows">${crypto}</ul>` : '<p class="muted">Market warming up...</p>'}</section>
<section class="card"><h2>Adjust a balance</h2>
  <p class="muted">Give or take a member's on-hand yen. Use a negative amount to take it away.</p>
  <form method="post" action="/g/${guild.id}/eco" class="inline-add">${csrf}<input type="hidden" name="_tab" value="economy">
    <label>User ID <input name="userId" pattern="\\d{17,20}" placeholder="e.g. 123456789012345678" required></label>
    <label>Amount <input name="amount" type="number" required></label>
    <button class="btn">Apply</button></form>
</section>`;
}

async function levelingSection(ctx, guild, session) {
    const csrf = csrfField(session);
    let data;
    try { data = await levelApi('GET', `/settings?guild=${guild.id}`); }
    catch { return '<section class="card"><h2>Leveling</h2><p class="muted">The level bot isn\'t reachable right now. Make sure the level bot is running.</p></section>'; }
    let board = { rows: [], total: 0 };
    try { board = await levelApi('GET', `/leaderboard?guild=${guild.id}&limit=25`); } catch {}
    const s = data.settings ?? {};
    const noxp = data.noxp ?? [];
    const eventOn = s.event_ends_at && s.event_ends_at > Date.now();
    const rows = board.rows.map((r, i) => `<li><div><b>#${i + 1} ${escapeHtml(guild.members.cache.get(r.userId)?.user.username ?? r.userId)}</b><small>Level ${r.level} · ${Number(r.xp).toLocaleString('en-US')} XP</small></div></li>`).join('');
    const noxpChips = noxp.length
        ? `<div class="chips">${noxp.map((id) => `<span class="chip">#${escapeHtml(guild.channels.cache.get(id)?.name ?? id)}<form method="post" action="/g/${guild.id}/noxp">${csrf}<input type="hidden" name="_tab" value="leveling"><input type="hidden" name="remove" value="${escapeHtml(id)}"><button class="chip-x" type="submit" aria-label="Remove">×</button></form></span>`).join('')}</div>`
        : '<p class="muted">XP is earned in every channel.</p>';
    return `
<section class="card"><h2>Leveling settings</h2>
  ${eventOn ? `<p class="flash ok">Active XP event: ×${s.event_multiplier} until ${new Date(s.event_ends_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>` : ''}
  <form method="post" action="/g/${guild.id}/levelingcfg" class="settings">${csrf}<input type="hidden" name="_tab" value="leveling">
    <label>Level-up announcement channel <select name="levelup_channel_id">${guildChannelOptions(guild, s.levelup_channel_id || '', '(where the level-up happens)')}</select></label>
    <label>XP event multiplier <input type="number" name="event_multiplier" min="1" max="5" step="0.25" value="${eventOn ? s.event_multiplier : 1}"><small class="hint">1 = off.</small></label>
    <label>Event duration (hours) <input type="number" name="event_hours" min="0" max="168" value="0"><small class="hint">Set with a multiplier above 1 to start an event. 0 = leave unchanged.</small></label>
    <button class="btn">Save leveling</button>
  </form>
</section>
<section class="card"><h2>No-XP channels</h2>
  ${noxpChips}
  <form method="post" action="/g/${guild.id}/noxp" class="inline-add">${csrf}<input type="hidden" name="_tab" value="leveling">
    <label>Add a no-XP channel <select name="add">${guildChannelOptions(guild, '', 'Choose a channel...')}</select></label>
    <button class="btn subtle">Add</button></form>
</section>
<section class="card"><h2>Leaderboard <a class="btn subtle small" href="/g/${guild.id}/leaderboard" target="_blank" rel="noopener">Full page</a></h2>
  ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="muted">No one has earned XP yet.</p>'}
  <p class="muted">${board.total ?? 0} ranked member(s).</p>
</section>`;
}

async function leaderboardPage(ctx, guild, session) {
    let board = { rows: [], total: 0 };
    try { board = await levelApi('GET', `/leaderboard?guild=${guild.id}&limit=100`); } catch {}
    const rows = board.rows.map((r, i) => `<li><div><b>#${i + 1} ${escapeHtml(guild.members.cache.get(r.userId)?.user.username ?? r.userId)}</b><small>Level ${r.level} · ${Number(r.xp).toLocaleString('en-US')} XP · ${r.messages} msgs</small></div></li>`).join('');
    return layout({
        title: `${guild.name} leaderboard`,
        session,
        body: `<a class="back" href="/g/${guild.id}?tab=leveling">← Leveling</a>
<div class="page-head"><h1>🏆 ${escapeHtml(guild.name)} Leaderboard</h1><p class="muted">${board.total ?? 0} ranked members</p></div>
<section class="card">${rows ? `<ul class="rows">${rows}</ul>` : '<p class="muted">No XP earned yet.</p>'}</section>`,
    });
}

function communitySection(ctx, guild) {
    const d = ctx.getCommunityData(guild);
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const afk = d.afk.map((a) => `<li><div><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.reason) || 'AFK'} · since <time>${new Date(a.since).toISOString().slice(0, 16).replace('T', ' ')}</time></small></div></li>`).join('');
    const bdays = d.birthdays.map((b) => `<li><div><b>${escapeHtml(b.name)}</b><small>${months[b.month] ?? '?'} ${b.day}</small></div></li>`).join('');
    const tz = d.timezones.map((t) => `<li><div><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.zone)}</small></div></li>`).join('');
    const card = (title, rows, empty) => `<section class="card"><h2>${title}</h2>${rows ? `<ul class="rows">${rows}</ul>` : `<p class="muted">${empty}</p>`}</section>`;
    return card(`💤 AFK (${d.afk.length})`, afk, 'No one is AFK.')
        + card(`🎂 Birthdays (${d.birthdays.length})`, bdays, 'No birthdays set.')
        + card(`🌍 Timezones (${d.timezones.length})`, tz, 'No timezones set.');
}

function ticketsSection(ctx, guild, session) {
    const cfg = ctx.getTicketConfig(guild.id);
    const csrf = csrfField(session);
    const roleOpts = (sel) => '<option value="">(none)</option>' + [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position).slice(0, 100).map((r) => `<option value="${r.id}"${r.id === sel ? ' selected' : ''}>@${escapeHtml(r.name)}</option>`).join('');
    const catOpts = (sel) => '<option value="">(none)</option>' + [...guild.channels.cache.values()].filter((c) => c.type === 4).sort((a, b) => a.rawPosition - b.rawPosition).map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const trows = ctx.listTranscripts(guild.id).slice(0, 20).map((t) => `<li><div><b>#${escapeHtml(t.channel)}</b><small>closed by ${escapeHtml(t.closedBy)} · ${new Date(t.at).toISOString().slice(0, 16).replace('T', ' ')} · ${t.messages} msgs</small></div><a class="btn subtle small" href="/g/${guild.id}/transcript?id=${encodeURIComponent(t.id)}" target="_blank" rel="noopener">View</a></li>`).join('');
    return `<section class="card"><h2>Ticket setup</h2>
  <form method="post" action="/g/${guild.id}/ticketcfg" class="settings">${csrf}<input type="hidden" name="_tab" value="tickets">
    <label>Panel channel <select name="panelChannelId">${guildChannelOptions(guild, cfg.panelChannelId || '', '(not set)')}</select></label>
    <label>Support role <select name="supportRoleId">${roleOpts(cfg.supportRoleId || '')}</select></label>
    <label>Ticket category <select name="categoryId">${catOpts(cfg.categoryId || '')}</select></label>
    <label>Transcript log channel <select name="logChannelId">${guildChannelOptions(guild, cfg.logChannelId || '', '(none)')}</select></label>
    <label>Reason menu <small class="hint">Comma-separated options. Blank = a single Open button.</small><input name="reasons" value="${escapeHtml((cfg.reasons ?? []).join(', '))}" maxlength="600"></label>
    <button class="btn">Save ticket settings</button>
  </form>
  <form method="post" action="/g/${guild.id}/ticketpanel" class="mt12">${csrf}<input type="hidden" name="_tab" value="tickets"><button class="btn subtle">Post / repost the panel</button></form>
</section>
<section class="card"><h2>Transcripts</h2>
  ${trows ? `<ul class="rows">${trows}</ul>` : '<p class="muted">No ticket transcripts yet.</p>'}
</section>`;
}

function guildSidebar(guild, active) {
    const links = GUILD_TABS.map((t) => `<a class="side-link${t.id === active ? ' active' : ''}" href="/g/${guild.id}?tab=${t.id}">${t.label}</a>`).join('');
    return `<nav class="side">
    <a class="side-back" href="/">← All servers</a>
    <div class="side-guild">${guildIcon(guild)}<b>${escapeHtml(guild.name)}</b></div>
    ${links}
  </nav>`;
}

async function guildPage(ctx, guild, session, tab) {
    const active = GUILD_TABS.some((t) => t.id === tab) ? tab : 'overview';
    const section = active === 'leveling' ? await levelingSection(ctx, guild, session)
        : active === 'overview' ? overviewSection(ctx, guild, session)
            : active === 'security' ? securitySection(ctx, guild, session)
                : active === 'logging' ? loggingSection(ctx, guild, session)
                    : active === 'tickets' ? ticketsSection(ctx, guild, session)
                        : active === 'music' ? musicSection(ctx, guild, session)
                            : active === 'community' ? communitySection(ctx, guild, session)
                                : active === 'economy' ? economySection(ctx, guild, session)
                                    : backupsHtml(ctx, guild, session);
    const title = GUILD_TABS.find((t) => t.id === active).label;
    return layout({
        title: guild.name,
        session,
        body: `<div class="g-shell">${guildSidebar(guild, active)}
  <div class="g-main">
    ${flashHtml(takeFlash(session))}
    <div class="page-head"><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(guild.name)} · ${guild.memberCount.toLocaleString('en-US')} members</p></div>
    ${section}
  </div>
</div>`,
    });
}

async function alertDiscord(ctx, title, description, color) {
    const channelId = process.env.DASHBOARD_ALERT_CHANNEL_ID;
    if (!channelId || !SNOWFLAKE.test(channelId)) return;
    try {
        const channel = await ctx.client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
            await channel.send({ embeds: [{ title, description, color, timestamp: new Date().toISOString() }] });
        }
    } catch (err) {
        console.error('[dashboard] could not send Discord alert:', err.message);
    }
}

function whereFrom(req) {
    const country = String(req.headers['cf-ipcountry'] || '').slice(0, 4);
    return `IP \`${clientIp(req)}\`${country ? ` (${country})` : ''}`;
}

function finishLogin(ctx, req, res, username, ip) {
    const users = auth.loadUsers();
    const record = users[username];
    if (!record) return send(res, 401, loginPage('Login failed. Check your username and password.'));
    record.failedLogins = 0;
    record.lockedUntil = 0;
    record.lastLogin = { at: Date.now(), ip };
    auth.saveUsers(users);
    ipAttempts.delete(ip);
    const cookie = createSession(username, ip);
    audit(`LOGIN-OK user=${username} ip=${ip}`);
    alertDiscord(ctx, '🔐 Dashboard login', `**${username}** logged in to the ${THEME.botName} dashboard.\n${whereFrom(req)}\n-# Not you? Run \`node dashboard/users.js kick ${username}\` on the server and change the password.`, 0x57f287);
    return redirect(res, '/', { 'Set-Cookie': cookie });
}

function countFailedLogin(ctx, req, users, username, record, ip) {
    record.failedLogins = (record.failedLogins || 0) + 1;
    if (record.failedLogins >= MAX_FAILED_LOGINS) {
        record.lockedUntil = Date.now() + LOCKOUT_MS;
        record.failedLogins = 0;
        audit(`LOCKOUT user=${username} ip=${ip}`);
        alertDiscord(ctx, '🚨 Dashboard account locked', `**${username}** was locked for 15 minutes after ${MAX_FAILED_LOGINS} failed logins.\n${whereFrom(req)}`, 0xed4245);
    }
    users[username] = record;
    auth.saveUsers(users);
}

const pendingQuestions = new Map();
const QUESTION_TTL_MS = 5 * 60 * 1000;
function createPendingQuestion(username, ip) {
    const now = Date.now();
    for (const [t, v] of pendingQuestions) if (v.expires <= now) pendingQuestions.delete(t);
    const token = crypto.randomBytes(24).toString('base64url');
    pendingQuestions.set(token, { username, ip, expires: now + QUESTION_TTL_MS });
    return token;
}

function questionPage(token, question, message) {
    return layout({
        title: 'Log in',
        body: `<section class="card login">
  <div class="login-head">${LOGO}<h1>${THEME.botName} Dashboard</h1></div>
  <p class="tag">One more step: answer your security question.</p>
  ${message ? `<p class="flash err">${escapeHtml(message)}</p>` : ''}
  <form method="post" action="/login/question" autocomplete="off">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <label>${escapeHtml(question)} <input name="answer" type="password" autocomplete="off" required maxlength="200" autocapitalize="none" spellcheck="false"></label>
    <button class="btn">Log in</button>
  </form>
</section>`,
    });
}

async function handleSecurityQuestion(ctx, req, res) {
    const ip = clientIp(req);
    if (ipBlocked(ip)) return send(res, 429, loginPage('Too many attempts. Wait 15 minutes and try again.'));
    const form = await readForm(req).catch(() => null);
    const token = String(form?.get('token') || '');
    const pending = token && pendingQuestions.get(token);
    pendingQuestions.delete(token);
    if (!pending || pending.expires <= Date.now() || pending.ip !== ip) {
        return send(res, 401, loginPage('That took too long. Log in again.'));
    }
    const users = auth.loadUsers();
    const record = users[pending.username];
    if (!record?.securityAnswer) return finishLogin(ctx, req, res, pending.username, ip);
    if (record.lockedUntil && record.lockedUntil > Date.now()) {
        return send(res, 401, loginPage('This account is locked for a while after too many failed logins.'));
    }
    const ok = await auth.verifyPasswordAsync(auth.normalizeAnswer(form.get('answer')), record.securityAnswer);
    if (ok) return finishLogin(ctx, req, res, pending.username, ip);
    noteIpFailure(ip);
    countFailedLogin(ctx, req, users, pending.username, record, ip);
    audit(`LOGIN-FAIL ip=${ip} user=${JSON.stringify(pending.username)} reason=question`);
    return send(res, 401, loginPage('Wrong answer to the security question. Log in again.'));
}

async function handleLogin(ctx, req, res) {
    const ip = clientIp(req);
    if (ipBlocked(ip)) {
        audit(`LOGIN-BLOCKED ip=${ip} (too many attempts)`);
        return send(res, 429, loginPage('Too many attempts. Wait 15 minutes and try again.'));
    }

    let form;
    try {
        form = await readForm(req);
    } catch {
        return send(res, 400, loginPage('Something went wrong. Try again.'));
    }

    const username = auth.normalizeUsername(form.get('username'));
    const password = form.get('password') || '';
    const code = form.get('code') || '';

    const codeDigits = code.replace(/\D/g, '');
    if (!username) return send(res, 400, loginPage('Enter your username.'));
    if (!password) return send(res, 400, loginPage('Enter your password.'));
    if (auth.REQUIRE_2FA && !codeDigits) return send(res, 400, loginPage('Enter the 6-digit code from your authenticator app.'));
    if (auth.REQUIRE_2FA && codeDigits.length !== 6) return send(res, 400, loginPage(`The authenticator code is 6 digits - you entered ${codeDigits.length}. It changes every 30 seconds, so use the current one.`));

    if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip))) {
        noteIpFailure(ip);
        audit(`LOGIN-FAIL ip=${ip} user=${JSON.stringify(username)} reason=bot-check`);
        return send(res, 401, loginPage('Bot check failed. Refresh the page and try again.'));
    }

    const users = auth.loadUsers();
    const record = auth.USERNAME_PATTERN.test(username) ? users[username] : undefined;
    const now = Date.now();

    const passwordOk = await auth.verifyPasswordAsync(password.slice(0, 200), record ?? auth.DUMMY_RECORD);
    const locked = record?.lockedUntil && record.lockedUntil > now;
    const step = auth.REQUIRE_2FA && record?.totpSecret ? auth.checkTotp(record.totpSecret, code) : null;
    const codeOk = !auth.REQUIRE_2FA || (step !== null && step > (record.lastTotpStep ?? -1));

    if (record && passwordOk && codeOk && !locked) {
        if (step !== null) {
            record.lastTotpStep = step;
            users[username] = record;
            auth.saveUsers(users);
        }
        if (record.securityQuestion && record.securityAnswer) {
            return send(res, 200, questionPage(createPendingQuestion(username, ip), record.securityQuestion));
        }
        return finishLogin(ctx, req, res, username, ip);
    }

    noteIpFailure(ip);
    if (record && !locked) countFailedLogin(ctx, req, users, username, record, ip);
    const reason = !record ? 'no-user' : locked ? 'locked' : !passwordOk ? 'password' : 'code';
    audit(`LOGIN-FAIL ip=${ip} user=${JSON.stringify(username)} reason=${reason}`);
    let message = auth.REQUIRE_2FA ? 'Login failed. Check your username, password and the 6-digit code (it changes every 30 seconds).' : 'Login failed. Check your username and password.';
    if (locked) {
        const mins = Math.ceil((record.lockedUntil - now) / 60000);
        message = `This account is locked for about ${mins} more minute(s) after too many failed logins.`;
    } else if (FRIENDLY_ERRORS) {
        message = reason === 'no-user' ? `No dashboard account called "${username}". Create one on the server with: node dashboard/users.js add <name>`
            : reason === 'password' ? 'That password is wrong for this account.'
                : 'Your username and password are correct, but that 6-digit code is wrong or expired - open your authenticator and enter the current code.';
    }
    return send(res, 401, loginPage(message));
}

async function handleMusic(ctx, req, res, session, guild, form) {
    const action = form.get('action');
    const queue = ctx.distube.getQueue(guild.id);
    let text = 'Nothing is playing.';
    let ok = false;
    try {
        if (queue) {
            ok = true;
            if (action === 'pause' && !queue.paused) {
                await queue.pause();
                text = 'Paused.';
            } else if (action === 'resume' && queue.paused) {
                await queue.resume();
                text = 'Resumed.';
            } else if (action === 'skip') {
                text = (await ctx.skipOrFinish(queue)) ? 'Skipped to the next song.' : 'That was the last song, so the show is over.';
            } else if (action === 'clear') {
                const removed = Math.max(queue.songs.length - 1, 0);
                queue.songs.splice(1);
                ctx.saveQueueState();
                text = `Cleared ${removed} song(s) from the setlist.`;
            } else if (action === 'stop') {
                await queue.stop();
                queue.voice?.leave();
                ctx.cleanUpQueueFiles(queue);
                ctx.saveQueueState();
                text = 'Stopped the music and left voice.';
            } else {
                ok = false;
                text = 'That action is not available right now.';
            }
        }
    } catch (err) {
        ok = false;
        text = 'Something went wrong doing that.';
        console.error('[dashboard] music action failed:', err);
    }
    if (ok) {
        audit(`MUSIC user=${session.username} guild=${guild.id} action=${action}`);
        queue?.textChannel?.send({ embeds: [{ description: `🎛️ ${text} *(from the dashboard)*`, color: 0xff6fae }] }).catch(() => {});
    }
    session.flash = { ok, text };
    return redirect(res, backTo(guild, form));
}

async function handleSettings(ctx, req, res, session, guild, form) {
    const changes = [];
    const sec = ctx.securitySettings.get(guild.id) ?? {};
    const patch = {};

    const channelName = (id) => `#${guild.channels.cache.get(id)?.name ?? id}`;
    const validChannel = (id) => !id || (SNOWFLAKE.test(id) && guild.channels.cache.get(id)?.isTextBased());

    if (form.has('prefix')) {
        const prefix = String(form.get('prefix') ?? '').trim();
        if (prefix.length < 1 || prefix.length > 2 || /\s/.test(prefix)) {
            session.flash = { ok: false, text: 'The prefix must be 1 or 2 characters with no spaces.' };
            return redirect(res, backTo(guild, form));
        }
        if (prefix !== ctx.getPrefix(guild.id)) { ctx.prefixes.set(guild.id, prefix); ctx.savePrefixes(); changes.push(`prefix → \`${prefix}\``); }
    }

    for (const [field, label] of [['alertChannelId', 'security alerts'], ['messageLogChannelId', 'message log'], ['modLogChannelId', 'member log']]) {
        if (!form.has(field)) continue;
        const id = String(form.get(field) ?? '');
        if (id === (sec[field] || '')) continue;
        if (!validChannel(id)) {
            session.flash = { ok: false, text: `That ${label} channel doesn't exist in this server.` };
            return redirect(res, backTo(guild, form));
        }
        patch[field] = id || undefined;
        changes.push(`${label} → ${id ? channelName(id) : `${THEME.botName}'s default`}`);
    }

    if (form.has('limits')) {
        const limits = String(form.get('limits') ?? '');
        if (['strict', 'normal', 'relaxed'].includes(limits) && limits !== (sec.limits ?? 'normal')) {
            patch.limits = limits === 'normal' ? undefined : limits;
            changes.push(`anti-nuke strictness → ${limits}`);
        }
    }

    if (form.has('punish')) {
        const punish = String(form.get('punish') ?? '');
        if (['strip', 'kick', 'ban'].includes(punish) && punish !== (sec.punish ?? 'strip')) {
            patch.punish = punish === 'strip' ? undefined : punish;
            changes.push(`anti-nuke punishment → ${punish}`);
        }
    }

    if (form.has('minAgeDays')) {
        const days = Math.max(0, Math.min(365, parseInt(form.get('minAgeDays'), 10) || 0));
        const action = form.get('minAgeAction') === 'kick' ? 'kick' : 'timeout';
        if (days !== (sec.minAge?.days ?? 0) || (days > 0 && action !== (sec.minAge?.action ?? 'timeout'))) {
            patch.minAge = days > 0 ? { days, action } : undefined;
            changes.push(days > 0 ? `minimum account age → ${days} day(s), ${action}` : 'minimum account age → off');
        }
    }

    if (Object.keys(patch).length) ctx.updateGuildSecurity(guild.id, patch);
    if (changes.length) {
        audit(`SETTINGS user=${session.username} guild=${guild.id} ${changes.join('; ')}`);
        alertDiscord(ctx, '⚙️ Dashboard settings changed', `**${session.username}** changed settings in **${guild.name}**:\n${changes.map((c) => `• ${c}`).join('\n')}`, 0x0f6cbd);
    }
    session.flash = { ok: true, text: changes.length ? 'Settings saved.' : 'Nothing changed.' };
    return redirect(res, backTo(guild, form));
}

async function handleTrusted(ctx, req, res, session, guild, form) {
    const action = form.get('action');
    const userId = String(form.get('userId') ?? '').trim();
    if ((action === 'add' || action === 'remove') && !SNOWFLAKE.test(userId)) {
        session.flash = { ok: false, text: 'Enter a valid user ID (17-20 digits).' };
        return redirect(res, backTo(guild, form));
    }
    const trusted = new Set(ctx.securitySettings.get(guild.id)?.trusted ?? []);
    if (action === 'add') trusted.add(userId);
    else if (action === 'remove') trusted.delete(userId);
    else return redirect(res, backTo(guild, form));
    ctx.updateGuildSecurity(guild.id, { trusted: [...trusted] });
    audit(`TRUSTED user=${session.username} guild=${guild.id} ${action}=${userId}`);
    alertDiscord(ctx, '🔐 Trusted list changed', `**${session.username}** ${action === 'add' ? 'added' : 'removed'} <@${userId}> ${action === 'add' ? 'to' : 'from'} the trusted list in **${guild.name}**.`, 0x0f6cbd);
    session.flash = { ok: true, text: `${action === 'add' ? 'Added' : 'Removed'} ${userId} ${action === 'add' ? 'to' : 'from'} trusted.` };
    return redirect(res, backTo(guild, form));
}

async function handleVerify(ctx, req, res, session, guild, form) {
    const action = form.get('action');
    try {
        if (action === 'on') {
            const channel = guild.channels.cache.get(String(form.get('channelId') ?? ''));
            if (!channel?.isTextBased?.()) {
                session.flash = { ok: false, text: 'Pick a channel for the verification message.' };
                return redirect(res, backTo(guild, form));
            }
            const { role, channels } = await ctx.setupVerification(guild, channel);
            session.flash = { ok: true, text: `Verification gate is on in #${channel.name}. Hid ${channels} channel(s) behind the ${role.name} role.` };
            alertDiscord(ctx, '✅ Verification gate enabled', `**${session.username}** turned the verification gate on in **${guild.name}** (<#${channel.id}>) from the dashboard.`, 0x0f6cbd);
        } else if (action === 'off') {
            const released = await ctx.disableVerification(guild);
            session.flash = { ok: true, text: `Verification gate turned off. ${released} member(s) released.` };
            alertDiscord(ctx, '✅ Verification gate disabled', `**${session.username}** turned the verification gate off in **${guild.name}** from the dashboard.`, 0x0f6cbd);
        } else {
            return redirect(res, backTo(guild, form));
        }
        audit(`VERIFY user=${session.username} guild=${guild.id} ${action}`);
    } catch (err) {
        console.error('[dashboard] verify failed:', err);
        session.flash = { ok: false, text: `That failed - check ${THEME.botName} can manage roles and channels.` };
    }
    return redirect(res, backTo(guild, form));
}

const TAB_IDS = ['overview', 'security', 'logging', 'music', 'backups'];
function backTo(guild, form) {
    const t = form?.get?.('_tab');
    return `/g/${guild.id}${TAB_IDS.includes(t) ? `?tab=${t}` : ''}`;
}

async function handleAutoMod(ctx, req, res, session, guild, form) {
    try {
        const results = await ctx.setupAutoModRules(guild);
        session.flash = { ok: true, text: `Discord AutoMod set up.${Array.isArray(results) && results.length ? ` ${results.length} rule(s) configured.` : ''}` };
        audit(`AUTOMOD user=${session.username} guild=${guild.id}`);
    } catch (err) {
        console.error('[dashboard] automod failed:', err);
        session.flash = { ok: false, text: `AutoMod setup failed - check ${THEME.botName} has the Manage Server permission.` };
    }
    return redirect(res, backTo(guild, form));
}

function serveBackupDownload(ctx, req, res, guild, url) {
    const ts = Number(url.searchParams.get('dl'));
    const entry = ctx.listBackups(guild.id).find((b) => b.takenAt === ts);
    if (!entry) return send(res, 404, 'No such backup.');
    let data;
    try { data = fs.readFileSync(entry.file); } catch { return send(res, 404, 'No such backup.'); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="ruby-backup-${ts}.json"` });
    return res.end(data);
}

async function handleBackup(ctx, req, res, session, guild, form) {
    const action = form.get('action');
    try {
        if (action === 'create') {
            const snap = ctx.saveBackup(guild, 'dashboard');
            session.flash = { ok: true, text: `Backup created - ${snap.roles.length} role(s), ${snap.channels.length} channel(s).` };
            audit(`BACKUP-CREATE user=${session.username} guild=${guild.id}`);
        } else if (action === 'restore') {
            const entry = ctx.listBackups(guild.id).find((b) => b.takenAt === Number(form.get('takenAt')));
            if (!entry) { session.flash = { ok: false, text: 'That backup no longer exists.' }; return redirect(res, backTo(guild, form)); }
            const snapshot = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
            const result = await ctx.restoreBackup(guild, snapshot);
            session.flash = { ok: true, text: `Restored ${result.roles} role(s) and ${result.channels} channel(s); gave roles back to ${result.memberRoles} member(s).${result.failed?.length ? ' Some items could not be restored.' : ''}` };
            audit(`BACKUP-RESTORE user=${session.username} guild=${guild.id} ts=${entry.takenAt}`);
            alertDiscord(ctx, '♻️ Backup restored', `**${session.username}** restored a backup in **${guild.name}** from the dashboard.`, 0x0f6cbd);
        }
    } catch (err) {
        console.error('[dashboard] backup failed:', err);
        session.flash = { ok: false, text: 'That backup action failed.' };
    }
    return redirect(res, backTo(guild, form));
}

async function handleLevelingCfg(ctx, req, res, session, guild, form) {
    const ch = String(form.get('levelup_channel_id') ?? '');
    const body = { levelup_channel_id: (ch && guild.channels.cache.get(ch)?.isTextBased()) ? ch : '' };
    const mult = parseFloat(form.get('event_multiplier'));
    const hours = parseFloat(form.get('event_hours'));
    if (Number.isFinite(mult)) body.event_multiplier = Math.max(1, Math.min(5, mult));
    if (Number.isFinite(hours) && hours > 0 && (body.event_multiplier ?? 1) > 1) body.event_ends_at = Date.now() + hours * 3600000;
    try { await levelApi('POST', `/settings?guild=${guild.id}`, body); session.flash = { ok: true, text: 'Leveling settings saved.' }; }
    catch { session.flash = { ok: false, text: 'The level bot is not reachable.' }; }
    return redirect(res, backTo(guild, form));
}

async function handleNoxp(ctx, req, res, session, guild, form) {
    const add = String(form.get('add') ?? '');
    const remove = String(form.get('remove') ?? '');
    try { await levelApi('POST', `/noxp?guild=${guild.id}`, { add: add || undefined, remove: remove || undefined }); session.flash = { ok: true, text: 'No-XP channels updated.' }; }
    catch { session.flash = { ok: false, text: 'The level bot is not reachable.' }; }
    return redirect(res, backTo(guild, form));
}

async function handleTicketCfg(ctx, req, res, session, guild, form) {
    const chan = (id) => (id && SNOWFLAKE.test(id) && guild.channels.cache.get(id)?.isTextBased()) ? id : undefined;
    const cat = (id) => (id && SNOWFLAKE.test(id) && guild.channels.cache.get(id)?.type === 4) ? id : undefined;
    const role = (id) => (id && SNOWFLAKE.test(id) && guild.roles.cache.has(id)) ? id : undefined;
    const reasons = String(form.get('reasons') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25);
    ctx.setTicketConfig(guild.id, {
        panelChannelId: chan(String(form.get('panelChannelId') ?? '')),
        supportRoleId: role(String(form.get('supportRoleId') ?? '')),
        categoryId: cat(String(form.get('categoryId') ?? '')),
        logChannelId: chan(String(form.get('logChannelId') ?? '')),
        reasons: reasons.length ? reasons : undefined,
    });
    await ctx.refreshTicketPanel(guild).catch(() => {});
    audit(`TICKETCFG user=${session.username} guild=${guild.id}`);
    session.flash = { ok: true, text: 'Ticket settings saved.' };
    return redirect(res, backTo(guild, form));
}

async function handleTicketPanel(ctx, req, res, session, guild, form) {
    const cfg = ctx.getTicketConfig(guild.id);
    const channel = cfg.panelChannelId ? guild.channels.cache.get(cfg.panelChannelId) : null;
    if (!channel?.isTextBased?.()) { session.flash = { ok: false, text: 'Set (and save) a panel channel first.' }; return redirect(res, backTo(guild, form)); }
    try { await ctx.setupTicketPanel(channel); session.flash = { ok: true, text: `Panel posted in #${channel.name}.` }; }
    catch (err) { console.error('[dashboard] ticket panel:', err); session.flash = { ok: false, text: 'Could not post the panel - check my permissions there.' }; }
    return redirect(res, backTo(guild, form));
}

function serveTranscript(ctx, req, res, guild, url) {
    const html = ctx.readTranscriptHtml(guild.id, url.searchParams.get('id'));
    if (!html) return send(res, 404, 'Transcript not found.');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
}

async function handleEcoAdjust(ctx, req, res, session, guild, form) {
    const userId = String(form.get('userId') ?? '');
    const amount = parseInt(form.get('amount'), 10);
    if (!SNOWFLAKE.test(userId) || !Number.isInteger(amount)) { session.flash = { ok: false, text: 'Enter a valid user ID and whole amount.' }; return redirect(res, backTo(guild, form)); }
    const bal = ctx.ecoAdjust(guild.id, userId, amount);
    audit(`ECO user=${session.username} guild=${guild.id} target=${userId} delta=${amount}`);
    session.flash = { ok: true, text: `Done - they now hold ${THEME.currency}${bal.toLocaleString('en-US')} on hand.` };
    return redirect(res, backTo(guild, form));
}

async function handleAutomodCfg(ctx, req, res, session, guild, form) {
    const words = String(form.get('words') ?? '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean).slice(0, 100);
    const clamp = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined; };
    ctx.updateGuildSecurity(guild.id, { automod: { words, caps: clamp(form.get('caps'), 40, 100), mentions: clamp(form.get('mentions'), 3, 20), emoji: clamp(form.get('emoji'), 3, 50) } });
    audit(`AUTOMODCFG user=${session.username} guild=${guild.id} words=${words.length}`);
    session.flash = { ok: true, text: 'Auto-moderation saved.' };
    return redirect(res, backTo(guild, form));
}

async function handleSwitch(ctx, req, res, session, guild, form) {
    const name = form.get('name');
    const on = form.get('value') === 'on';
    try {
        if (name === 'raid') {
            ctx.setRaidMode(guild.id, on ? 60 * 60 * 1000 : 0);
            session.flash = { ok: true, text: on ? 'Raid mode is on for 1 hour.' : 'Raid mode is off.' };
            alertDiscord(ctx, on ? '🛡️ Raid mode enabled' : '🛡️ Raid mode disabled', `**${session.username}** turned raid mode **${on ? 'on' : 'off'}** in **${guild.name}** from the dashboard.`, on ? 0xd13438 : 0x0f6cbd);
        } else if (name === 'lockdown') {
            if (on) {
                const n = await ctx.lockdownServer(guild);
                session.flash = { ok: true, text: `Server locked (${n} channel(s)).` };
            } else {
                const n = await ctx.unlockServer(guild);
                session.flash = { ok: true, text: n == null ? 'The server wasn\'t locked.' : `Server unlocked (${n} channel(s)).` };
            }
            alertDiscord(ctx, on ? '🔒 Server locked down' : '🔓 Lockdown lifted', `**${session.username}** ${on ? 'locked down' : 'unlocked'} **${guild.name}** from the dashboard.`, on ? 0xd13438 : 0x0f6cbd);
        } else {
            return redirect(res, backTo(guild, form));
        }
        audit(`SWITCH user=${session.username} guild=${guild.id} ${name}=${on ? 'on' : 'off'}`);
    } catch (err) {
        console.error('[dashboard] switch failed:', err);
        session.flash = { ok: false, text: `That action failed - check ${THEME.botName} has the right permissions.` };
    }
    return redirect(res, backTo(guild, form));
}

async function route(ctx, req, res) {
    setSecurityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const method = req.method;

    if (!allowedHost(req)) return send(res, 421, 'Wrong host.');
    if (method !== 'GET' && method !== 'POST') return send(res, 405, 'Method not allowed.');
    if (method === 'POST' && !allowedOrigin(req)) return send(res, 403, 'Forbidden.');

    if (pathname === '/static/app.css' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        return res.end(CSS);
    }
    if (pathname === '/favicon.ico' || pathname === '/robots.txt') {
        res.writeHead(pathname === '/robots.txt' ? 200 : 204, { 'Content-Type': 'text/plain' });
        return res.end(pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /\n' : '');
    }

    if (pathname.startsWith('/card/') && await handleCardRoute(ctx, req, res, pathname, url)) return;

    const session = getSession(req);

    if (pathname === '/login/question' && method === 'POST') {
        if (session) return redirect(res, '/');
        return handleSecurityQuestion(ctx, req, res);
    }

    if (pathname === '/login') {
        if (session) return redirect(res, '/');
        if (method === 'GET') return send(res, 200, loginPage());
        return handleLogin(ctx, req, res);
    }

    if (pathname === '/otc' || pathname.startsWith('/otc/')) {
        if (session) return redirect(res, '/');
        let token = pathname.startsWith('/otc/') ? decodeURIComponent(pathname.slice(5)) : '';
        if (method === 'GET') return send(res, 200, otcConfirmPage(token.slice(0, 80)));
        if (method === 'POST') {
            const form = await readForm(req).catch(() => null);
            token = String(form?.get('code') || token || '').trim();
        }
        const username = redeemLoginCode(token);
        if (!username) {
            audit(`OTC-FAIL ip=${clientIp(req)}`);
            return send(res, 401, loginPage('That one-time code is invalid, already used, or expired. Ask the bot owner for a new one.'));
        }
        audit(`OTC-OK user=${username} ip=${clientIp(req)}`);
        return redirect(res, '/', { 'Set-Cookie': createSession(username, clientIp(req)) });
    }

    if (!session) {
        return method === 'GET' ? redirect(res, '/login', { 'Set-Cookie': CLEAR_COOKIE }) : send(res, 401, 'Please log in again.');
    }

    let form = null;
    if (method === 'POST') {
        try {
            form = await readForm(req);
        } catch {
            return send(res, 400, 'Bad request.');
        }
        const sent = Buffer.from(String(form.get('csrf') || ''));
        const expected = Buffer.from(session.csrf);
        if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
            audit(`CSRF-REJECTED user=${session.username} ip=${clientIp(req)} path=${pathname}`);
            return send(res, 403, 'Forbidden.');
        }
    }

    if (pathname === '/logout' && method === 'POST') {
        sessions.delete(session.key);
        audit(`LOGOUT user=${session.username}`);
        return redirect(res, '/login', { 'Set-Cookie': CLEAR_COOKIE });
    }

    if (pathname === '/' && method === 'GET') return send(res, 200, homePage(ctx, session));

    const match = pathname.match(/^\/g\/(\d{17,20})(\/music|\/settings|\/trusted|\/switch|\/verify|\/backup|\/automod|\/automodcfg|\/ticketcfg|\/ticketpanel|\/transcript|\/levelingcfg|\/noxp|\/leaderboard|\/eco)?$/);
    if (match) {
        const guild = ctx.client.guilds.cache.get(match[1]);
        if (!guild) return send(res, 404, layout({ title: 'Not found', session, body: `<section class="card"><h2>${THEME.botName} isn't in that server.</h2><p><a href="/">← Back</a></p></section>` }));
        if (!match[2] && method === 'GET') return send(res, 200, await guildPage(ctx, guild, session, url.searchParams.get('tab')));
        if (match[2] === '/music' && method === 'POST') return handleMusic(ctx, req, res, session, guild, form);
        if (match[2] === '/settings' && method === 'POST') return handleSettings(ctx, req, res, session, guild, form);
        if (match[2] === '/trusted' && method === 'POST') return handleTrusted(ctx, req, res, session, guild, form);
        if (match[2] === '/switch' && method === 'POST') return handleSwitch(ctx, req, res, session, guild, form);
        if (match[2] === '/verify' && method === 'POST') return handleVerify(ctx, req, res, session, guild, form);
        if (match[2] === '/backup' && method === 'GET') return serveBackupDownload(ctx, req, res, guild, url);
        if (match[2] === '/backup' && method === 'POST') return handleBackup(ctx, req, res, session, guild, form);
        if (match[2] === '/automod' && method === 'POST') return handleAutoMod(ctx, req, res, session, guild, form);
        if (match[2] === '/automodcfg' && method === 'POST') return handleAutomodCfg(ctx, req, res, session, guild, form);
        if (match[2] === '/eco' && method === 'POST') return handleEcoAdjust(ctx, req, res, session, guild, form);
        if (match[2] === '/ticketcfg' && method === 'POST') return handleTicketCfg(ctx, req, res, session, guild, form);
        if (match[2] === '/ticketpanel' && method === 'POST') return handleTicketPanel(ctx, req, res, session, guild, form);
        if (match[2] === '/levelingcfg' && method === 'POST') return handleLevelingCfg(ctx, req, res, session, guild, form);
        if (match[2] === '/noxp' && method === 'POST') return handleNoxp(ctx, req, res, session, guild, form);
        if (match[2] === '/leaderboard' && method === 'GET') return send(res, 200, await leaderboardPage(ctx, guild, session));
        if (match[2] === '/transcript' && method === 'GET') return serveTranscript(ctx, req, res, guild, url);
    }

    return send(res, 404, layout({ title: 'Not found', session, body: '<section class="card"><h2>Page not found.</h2><p><a href="/">← Back</a></p></section>' }));
}

function startDashboard(ctx) {
    if (process.env.DASHBOARD_ENABLED === 'false') {
        console.log('[dashboard] Disabled (DASHBOARD_ENABLED=false).');
        return null;
    }
    auth.ensureDir();

    const server = http.createServer((req, res) => {
        route(ctx, req, res).catch((err) => {
            console.error('[dashboard] request failed:', err);
            if (!res.headersSent) send(res, 500, 'Something went wrong.');
            else res.end();
        });
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    server.maxHeadersCount = 50;

    server.on('error', (err) => console.error(`[dashboard] Could not start on port ${PORT}: ${err.message}`));
    server.listen(PORT, BIND_HOST, () => {
        const count = Object.keys(auth.loadUsers()).length;
        console.log(`[dashboard] Listening on http://${BIND_HOST}:${PORT} (${count} account(s)${TURNSTILE_ON ? ', Turnstile on' : ''})`);
    });

    setInterval(() => {
        const now = Date.now();
        for (const [key, s] of sessions) {
            if (now - s.lastSeen > IDLE_TIMEOUT_MS || now - s.createdAt > MAX_SESSION_MS) sessions.delete(key);
        }
        for (const [ip, list] of ipAttempts) {
            const recent = list.filter((t) => now - t < IP_WINDOW_MS);
            if (recent.length) ipAttempts.set(ip, recent);
            else ipAttempts.delete(ip);
        }
    }, 60_000).unref();

    return server;
}

module.exports = { startDashboard, createLoginCode };
