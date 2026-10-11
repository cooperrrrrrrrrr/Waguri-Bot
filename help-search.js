function editDistance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[a.length][b.length];
}

function suggestCommand(input, names) {
    const word = String(input ?? '').toLowerCase();
    if (word.length < 4 || !/^[a-z0-9]+$/.test(word)) return null;
    const limit = word.length >= 7 ? 2 : 1;
    let best = null;
    let bestDistance = Infinity;
    let tied = false;
    for (const name of new Set(names)) {
        if (name === word) return null;
        if (name[0] !== word[0] || Math.abs(name.length - word.length) > limit) continue;
        const distance = editDistance(word, name);
        if (distance < bestDistance) {
            best = name;
            bestDistance = distance;
            tied = false;
        } else if (distance === bestDistance) {
            tied = true;
        }
    }
    return best && bestDistance <= limit && !tied ? best : null;
}

function helpCommandNames(pages) {
    const names = new Set();
    for (const page of pages) for (const line of page.lines) for (const m of line.matchAll(/\{\{PREFIX\}\}([a-z0-9]+)/g)) names.add(m[1]);
    return names;
}

function findHelpPage(pages, query) {
    const q = String(query ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (q.length < 3) return null;
    return pages.find((p) => p.id === q)
        ?? pages.find((p) => p.label.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(q))
        ?? null;
}

function findHelpLines(pages, name) {
    const cmd = String(name ?? '').toLowerCase();
    if (!/^[a-z0-9]+$/.test(cmd)) return [];
    const pattern = new RegExp(`\\{\\{PREFIX\\}\\}${cmd}(?![a-z0-9])`);
    const found = [];
    for (const page of pages) for (const line of page.lines) if (!line.startsWith('-#') && pattern.test(line)) found.push({ page, line });
    return found;
}

module.exports = { editDistance, suggestCommand, helpCommandNames, findHelpPage, findHelpLines };
