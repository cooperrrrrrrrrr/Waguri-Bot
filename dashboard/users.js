'use strict';

const readline = require('node:readline');
const auth = require('./auth');
const { THEME } = require('../theme');

function ask(question, { hidden = false } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        if (hidden) {
            rl._writeToOutput = (text) => {
                if (text.includes(question)) rl.output.write(text);
                else if (text.includes('\n') || text.includes('\r')) rl.output.write('\n');
            };
        }
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

function fail(message) {
    console.error(`✖ ${message}`);
    process.exit(1);
}

async function askNewPassword(username) {
    for (let tries = 0; tries < 3; tries++) {
        const pw = await ask('New password (at least 12 characters): ', { hidden: true });
        const problem = auth.checkPasswordRules(pw, username);
        if (problem) {
            console.log(`  ${problem}`);
            continue;
        }
        const again = await ask('Type it again: ', { hidden: true });
        if (pw !== again) {
            console.log("  Those didn't match.");
            continue;
        }
        return pw;
    }
    return fail('Too many tries.');
}

async function setUpTwoFactor(username) {
    const secret = auth.newTotpSecret();
    console.log('\nSet up two-factor login:');
    console.log('  1. Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator...).');
    console.log('  2. Add an account → "Enter a setup key" (not "scan QR code").');
    console.log(`  3. Account name: ${THEME.botName} Dashboard (${username})`);
    console.log(`     Key:          ${secret.match(/.{1,4}/g).join(' ')}`);
    console.log('     Type:         Time based');
    console.log('\n  (Some apps accept this link instead:)');
    console.log(`  ${auth.otpauthUri(username, secret)}\n`);
    for (let tries = 0; tries < 3; tries++) {
        const code = await ask('Enter the 6-digit code the app shows now: ');
        const step = auth.checkTotp(secret, code);
        if (step !== null) return { secret, step };
        console.log("  That code didn't match. Check the key was typed exactly, then try the next code.");
    }
    return fail("2FA wasn't confirmed, so nothing was saved. Run the command again.");
}

function requireUser(users, name) {
    if (!users[name]) fail(`No account called "${name}". Use "list" to see accounts.`);
    return users[name];
}

async function main() {
    const [command, rawName] = process.argv.slice(2);
    const name = auth.normalizeUsername(rawName);
    const users = auth.loadUsers();

    switch (command) {
        case 'add': {
            if (!auth.USERNAME_PATTERN.test(name)) fail('Usernames must be 3-32 characters: letters, numbers, _ . -');
            if (users[name]) fail(`"${name}" already exists.`);
            const password = await askNewPassword(name);
            const { secret, step } = auth.REQUIRE_2FA ? await setUpTwoFactor(name) : { secret: null, step: -1 };
            users[name] = {
                ...auth.hashPassword(password),
                totpSecret: secret,
                lastTotpStep: step,
                createdAt: Date.now(),
                sessionsValidAfter: Date.now(),
                failedLogins: 0,
                lockedUntil: 0,
            };
            auth.saveUsers(users);
            console.log(`\n✔ Account "${name}" created. It can log in straight away.`);
            break;
        }
        case 'list': {
            const names = Object.keys(users);
            if (!names.length) {
                console.log('No accounts yet. Create one with: node dashboard/users.js add <name>');
                break;
            }
            for (const n of names) {
                const u = users[n];
                const last = u.lastLogin ? `last login ${new Date(u.lastLogin.at).toLocaleString()} from ${u.lastLogin.ip}` : 'never logged in';
                const locked = u.lockedUntil > Date.now() ? ' [LOCKED]' : '';
                console.log(`• ${n}${locked} - ${last}`);
            }
            break;
        }
        case 'passwd': {
            const user = requireUser(users, name);
            Object.assign(user, auth.hashPassword(await askNewPassword(name)), { sessionsValidAfter: Date.now() });
            auth.saveUsers(users);
            console.log(`✔ Password changed for "${name}". They've been logged out everywhere.`);
            break;
        }
        case 'reset-2fa': {
            const user = requireUser(users, name);
            const { secret, step } = await setUpTwoFactor(name);
            Object.assign(user, { totpSecret: secret, lastTotpStep: step, sessionsValidAfter: Date.now() });
            auth.saveUsers(users);
            console.log(`✔ New authenticator set for "${name}". Delete the old entry from the app.`);
            break;
        }
        case 'unlock': {
            const user = requireUser(users, name);
            Object.assign(user, { lockedUntil: 0, failedLogins: 0 });
            auth.saveUsers(users);
            console.log(`✔ "${name}" is unlocked.`);
            break;
        }
        case 'rename': {
            const user = requireUser(users, name);
            const newName = auth.normalizeUsername(process.argv[4]);
            if (!auth.USERNAME_PATTERN.test(newName)) fail('Usernames must be 3-32 characters: letters, numbers, _ . -');
            if (users[newName]) fail(`"${newName}" already exists.`);
            user.sessionsValidAfter = Date.now();
            users[newName] = user;
            delete users[name];
            auth.saveUsers(users);
            console.log(`✔ "${name}" is now "${newName}". Same password and security question.`);
            console.log(`  If DASHBOARD_ACCESS in .env uses "${name}", change it to "${newName}" and restart.`);
            break;
        }
        case 'question': {
            const user = requireUser(users, name);
            if ((process.argv[4] || '').toLowerCase() === 'off') {
                delete user.securityQuestion;
                delete user.securityAnswer;
                auth.saveUsers(users);
                console.log(`✔ "${name}" no longer has a security question.`);
                break;
            }
            const question = (await ask('Security question (e.g. What is my pet\'s name?): ')).trim().slice(0, 150);
            if (!question) fail('No question entered, nothing changed.');
            const answer = auth.normalizeAnswer(await ask('Answer (hidden, capitals don\'t matter): ', { hidden: true }));
            if (!answer) fail('No answer entered, nothing changed.');
            const again = auth.normalizeAnswer(await ask('Type the answer again: ', { hidden: true }));
            if (answer !== again) fail("Those didn't match, nothing changed.");
            user.securityQuestion = question;
            user.securityAnswer = auth.hashPassword(answer);
            auth.saveUsers(users);
            console.log(`✔ "${name}" will be asked "${question}" after their password.`);
            break;
        }
        case 'kick': {
            requireUser(users, name).sessionsValidAfter = Date.now();
            auth.saveUsers(users);
            console.log(`✔ "${name}" has been logged out everywhere.`);
            break;
        }
        case 'remove': {
            requireUser(users, name);
            const sure = await ask(`Type "${name}" to confirm deleting this account: `);
            if (auth.normalizeUsername(sure) !== name) fail('Cancelled.');
            delete users[name];
            auth.saveUsers(users);
            console.log(`✔ "${name}" deleted and logged out.`);
            break;
        }
        default:
            console.log([
                `${THEME.botName} dashboard accounts:`,
                '  node dashboard/users.js add <name>',
                '  node dashboard/users.js list',
                '  node dashboard/users.js passwd <name>',
                '  node dashboard/users.js reset-2fa <name>',
                '  node dashboard/users.js unlock <name>',
                '  node dashboard/users.js rename <name> <new name>',
                '  node dashboard/users.js question <name> [off]',
                '  node dashboard/users.js kick <name>',
                '  node dashboard/users.js remove <name>',
            ].join('\n'));
    }
}

main().catch((err) => fail(err.message));
