const COMMAND_ALIASES = Object.freeze({
    q: 'queue',
    v: 'volume',
    s: 'skip',
    p: 'play',
    np: 'nowplaying',
    playlists: 'playlist',
    curated: 'playlist',
    bday: 'birthday',
    tz: 'timezone',
    settz: 'settimezone',
    commands: 'help',
    bumptimer: 'bumpcountdown',
    bumplb: 'bumpleaderboard',
    bumptop: 'bumpleaderboard',
    makeitaquote: 'miaq',
    fmr: 'fmrecent',
    wk: 'whoknows',
    taste: 'fmtaste',
    compatibility: 'fmtaste',
    fmc: 'fmcover',
    pats: 'pat',
    handhold: 'handholding',
    hf: 'highfive',
    fmsummary: 'fmoverview',
    fmo: 'fmoverview',
    fmrate: 'ratetaste',
    tasterate: 'ratetaste',
    cover: 'fmcover',
    fmunlink: 'fmremove',
    info: 'serverinfo',
    repeat: 'loop',
    clearqu: 'clearqueue',
    translate: 'ts',
    removebackground: 'rbg',
    removebg: 'rbg',
    su: 'submit',
    neverhaveiever: 'nhie',
    pick: 'choose',
    esnipe: 'editsnipe',
    minecraft: 'mcstatus',
});

const MUSIC_CONTROL_COMMANDS = new Set([
    'pause', 'resume', 'skip', 'stop', 'remove', 'clearqueue', 'volume', 'seek', 'loop', 'shuffle',
    'restart', 'previous', 'jump', 'bassboost', 'trebleboost', 'resetfilter', 'playnext',
]);

function resolveCommandName(name) {
    return COMMAND_ALIASES[name] ?? name;
}

function parsePrefixCommand(content, prefix) {
    if (!content.startsWith(prefix)) return null;
    const args = content.slice(prefix.length).trim().split(/ +/);
    const commandName = resolveCommandName(args.shift().toLowerCase());
    return { commandName, args };
}

module.exports = { COMMAND_ALIASES, MUSIC_CONTROL_COMMANDS, parsePrefixCommand, resolveCommandName };
