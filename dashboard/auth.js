'use strict';
const { THEME } = require('../theme');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_DIR = path.join(__dirname, '..', 'data', 'dashboard');
const USERS_FILE = path.join(DASHBOARD_DIR, 'users.json');

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;

const REQUIRE_2FA = process.env.DASHBOARD_2FA === 'on';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

function ensureDir() {
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true, mode: 0o700 });
}

function loadUsers(file = USERS_FILE) {
    let contents;
    try {
        contents = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }

    let users;
    try {
        users = JSON.parse(contents);
    } catch (err) {
        throw new Error(`Dashboard account file is not valid JSON: ${file}`, { cause: err });
    }
    if (!users || typeof users !== 'object' || Array.isArray(users)) {
        throw new Error(`Dashboard account file must contain a JSON object: ${file}`);
    }
    return users;
}

function saveUsers(users) {
    ensureDir();
    const tmp = `${USERS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, USERS_FILE);
    try { fs.chmodSync(USERS_FILE, 0o600); } catch {}
}

function normalizeUsername(name) {
    return String(name ?? '').trim().toLowerCase();
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password).normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
    return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(password, record) {
    const salt = Buffer.from(record.salt, 'base64');
    const expected = Buffer.from(record.hash, 'base64');
    const actual = crypto.scryptSync(String(password).normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeAnswer(answer) {
    return String(answer ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

function verifyPasswordAsync(password, record) {
    return new Promise((resolve) => {
        const salt = Buffer.from(record.salt, 'base64');
        const expected = Buffer.from(record.hash, 'base64');
        crypto.scrypt(String(password).normalize('NFKC'), salt, KEY_LENGTH, SCRYPT, (err, actual) => {
            if (err) return resolve(false);
            resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
        });
    });
}

const DUMMY_RECORD = hashPassword(crypto.randomBytes(32).toString('hex'));

// --- 2FA ---

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        value = (value << 5) | BASE32.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function newTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function totpAt(secret, step) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 15;
    const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return String(code).padStart(6, '0');
}

function checkTotp(secret, code, now = Date.now()) {
    const clean = String(code ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return null;
    const step = Math.floor(now / 30000);
    for (const s of [step - 1, step, step + 1]) {
        const expected = Buffer.from(totpAt(secret, s));
        if (crypto.timingSafeEqual(expected, Buffer.from(clean))) return s;
    }
    return null;
}

function otpauthUri(username, secret) {
    const label = encodeURIComponent(`${THEME.botName} Dashboard:${username}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(`${THEME.botName} Dashboard`)}&algorithm=SHA1&digits=6&period=30`;
}

function checkPasswordRules(password, username) {
    const pw = String(password ?? '');
    if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (pw.length > MAX_PASSWORD_LENGTH) return `Password must be under ${MAX_PASSWORD_LENGTH} characters.`;
    if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Password can't contain the username.";
    if (/^(.)\1+$/.test(pw)) return "Password can't be one character repeated.";
    return null;
}

module.exports = {
    REQUIRE_2FA,
    normalizeAnswer,
    DASHBOARD_DIR,
    USERS_FILE,
    USERNAME_PATTERN,
    DUMMY_RECORD,
    ensureDir,
    loadUsers,
    saveUsers,
    normalizeUsername,
    hashPassword,
    verifyPassword,
    verifyPasswordAsync,
    newTotpSecret,
    checkTotp,
    totpAt,
    otpauthUri,
    checkPasswordRules,
};
