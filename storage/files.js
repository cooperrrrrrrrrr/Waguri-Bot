const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir(directory = DATA_DIR) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

function writeFileAtomic(file, data) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
}

module.exports = { DATA_DIR, ensureDataDir, writeFileAtomic };
