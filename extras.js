function parseChoices(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return [];
    const parts = /[|,]/.test(raw) ? raw.split(/\s*[|,]\s*|\s+or\s+/i) : raw.split(/\s+or\s+/i);
    const choices = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
    return choices.length >= 2 ? choices : [];
}

function zoneOffsetMs(zone, date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedTime(year, month, day, hour, minute, zone) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = guess - zoneOffsetMs(zone, new Date(guess));
    return guess - zoneOffsetMs(zone, new Date(first));
}

function parseWhen(text, { zone = 'UTC', now = Date.now() } = {}) {
    let t = String(text ?? '').trim().toLowerCase().replace(/^in\s+/, '');
    if (!t) return null;

    const span = t.replace(/\s+/g, '');
    if (/^(\d+(s|m|h|d|w))+$/.test(span)) {
        const units = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 };
        let ms = 0;
        for (const [, n, u] of span.matchAll(/(\d+)(s|m|h|d|w)/g)) ms += Number(n) * units[u];
        return ms > 0 && ms <= 50 * 365 * 864e5 ? now + ms : null;
    }

    let validZone = zone;
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { validZone = 'UTC'; }
    const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: validZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(now)).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));

    let date = null;
    let dayShift = 0;
    const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b\s*/);
    if (iso) {
        date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
        t = t.slice(iso[0].length);
    } else if (t.startsWith('tomorrow')) {
        dayShift = 1;
        t = t.slice('tomorrow'.length).trim();
    } else if (t.startsWith('today')) {
        t = t.slice('today'.length).trim();
    }

    let hour = 0;
    let minute = 0;
    if (t) {
        const clock = t.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
        if (!clock) return null;
        hour = Number(clock[1]);
        minute = Number(clock[2] ?? 0);
        if (!clock[2] && !clock[3]) return null;
        if (clock[3]) {
            if (hour < 1 || hour > 12) return null;
            hour = (hour % 12) + (clock[3] === 'pm' ? 12 : 0);
        }
        if (hour > 23 || minute > 59) return null;
    } else if (!date && !dayShift) {
        return null;
    }

    const base = date ?? today;
    if (base.month < 1 || base.month > 12 || base.day < 1 || base.day > 31) return null;
    const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + dayShift));
    let when = zonedTime(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), hour, minute, validZone);
    if (!date && !dayShift && when <= now) {
        const next = new Date(Date.UTC(base.year, base.month - 1, base.day + 1));
        when = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), hour, minute, validZone);
    }
    return when;
}

function timestampTags(ms) {
    const s = Math.floor(ms / 1000);
    return [
        ['Short time', `<t:${s}:t>`],
        ['Long time', `<t:${s}:T>`],
        ['Short date', `<t:${s}:d>`],
        ['Long date', `<t:${s}:D>`],
        ['Date and time', `<t:${s}:f>`],
        ['Full', `<t:${s}:F>`],
        ['Relative', `<t:${s}:R>`],
    ];
}

function cleanServerAddress(text) {
    const address = String(text ?? '').trim().toLowerCase();
    return /^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(address) && address.includes('.') ? address : null;
}

function describeMcStatus(data) {
    if (!data?.online) return { online: false };
    const motd = (data.motd?.clean ?? []).join('\n').trim();
    return {
        online: true,
        players: `${data.players?.online ?? 0}/${data.players?.max ?? '?'}`,
        version: String(data.version ?? data.protocol?.name ?? 'Unknown').replace(/§./g, '').slice(0, 100),
        motd: motd.slice(0, 300),
        names: (data.players?.list ?? []).map((p) => p.name ?? p).filter(Boolean).slice(0, 10),
    };
}

const ANILIST_QUERY = `query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type, isAdult: false, sort: SEARCH_MATCH) {
    siteUrl
    title { romaji english }
    coverImage { large }
    averageScore
    format
    episodes
    chapters
    volumes
    status
    seasonYear
    startDate { year }
    genres
    description(asHtml: false)
  }
}`;

const ANILIST_FORMATS = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music video', MANGA: 'Manga', NOVEL: 'Light novel', ONE_SHOT: 'One shot' };
const ANILIST_STATUSES = { FINISHED: 'Finished', RELEASING: 'Releasing', NOT_YET_RELEASED: 'Not out yet', CANCELLED: 'Cancelled', HIATUS: 'On hiatus' };

function cleanAniListText(text) {
    return String(text ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/\n*\(Source:[^)]*\)\s*$/i, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function describeAniListMedia(media, kind = 'anime') {
    if (!media) return null;
    const count = kind === 'manga'
        ? [media.volumes && `${media.volumes} volumes`, media.chapters && `${media.chapters} chapters`].filter(Boolean).join(' · ')
        : media.episodes ? `${media.episodes} episode${media.episodes === 1 ? '' : 's'}` : '';
    const synopsis = cleanAniListText(media.description);
    const english = media.title?.english;
    const romaji = media.title?.romaji;
    return {
        title: english || romaji || 'Unknown',
        original: english && romaji && english !== romaji ? romaji : null,
        url: media.siteUrl ?? null,
        image: media.coverImage?.large ?? null,
        score: media.averageScore ? `${(media.averageScore / 10).toFixed(1)}/10` : 'Not rated yet',
        type: [ANILIST_FORMATS[media.format] ?? media.format, count].filter(Boolean).join(' · ') || 'Unknown',
        status: ANILIST_STATUSES[media.status] ?? 'Unknown',
        year: media.seasonYear ?? media.startDate?.year ?? null,
        genres: (media.genres ?? []).slice(0, 6).join(', ') || 'None listed',
        synopsis: synopsis.length > 700 ? `${synopsis.slice(0, 700).replace(/\s+\S*$/, '')}...` : synopsis || 'No synopsis yet.',
    };
}

const STICKY_MAX_LENGTH = 1500;
function parseStickyCommand(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return { action: 'show' };
    const [word] = raw.split(/\s+/, 1);
    const sub = word.toLowerCase();
    if (sub === 'list') return { action: 'list' };
    if (['off', 'remove', 'clear', 'delete', 'stop'].includes(sub)) return { action: 'remove' };
    if (sub === 'set') {
        const content = raw.slice(word.length).trim();
        if (!content || content.length > STICKY_MAX_LENGTH) return { action: 'usage' };
        return { action: 'set', content };
    }
    return { action: 'usage' };
}

function starboardAction({ stars, threshold, posted }) {
    if (stars >= threshold) return posted ? 'update' : 'post';
    return posted ? 'remove' : 'none';
}

module.exports = { parseChoices, parseWhen, zonedTime, timestampTags, cleanServerAddress, describeMcStatus, ANILIST_QUERY, describeAniListMedia, STICKY_MAX_LENGTH, parseStickyCommand, starboardAction };
