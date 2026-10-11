function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}

function findBanEvasion(member, banFingerprints, squashName) {
    const user = member.user;
    for (const banned of banFingerprints[member.guild.id] ?? []) {
        if (banned.id === user.id) continue;
        if (user.avatar && banned.avatar && user.avatar === banned.avatar) {
            return { strength: 'strong', match: banned, why: 'the same profile picture' };
        }
        const currentNames = [user.username, user.globalName].map(squashName).filter((name) => name.length >= 4);
        const bannedNames = [banned.username, banned.globalName].map(squashName).filter((name) => name.length >= 4);
        for (const currentName of currentNames) {
            for (const bannedName of bannedNames) {
                if (currentName === bannedName || (currentName.length >= 6 && editDistance(currentName, bannedName) <= 1)) {
                    return { strength: 'weak', match: banned, why: 'an almost identical name' };
                }
            }
        }
    }
    return null;
}

module.exports = { editDistance, findBanEvasion };
