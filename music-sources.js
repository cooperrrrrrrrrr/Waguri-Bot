const dns = require('node:dns').promises;
const net = require('node:net');

const AUDIO_FILE_EXTENSION = /\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i;
const SOUNDCLOUD_SEARCH = /^scsearch[1-5]:[\s\S]+$/i;

function isYoutubeHostname(hostname) {
    const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
        || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
}

function isSoundCloudHostname(hostname) {
    const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com')
        || host === 'snd.sc' || host.endsWith('.snd.sc');
}

function classifyMusicUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return 'not-url';
    }

    if (url.protocol !== 'https:' || url.username || url.password || url.port) return 'unsupported';
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (isYoutubeHostname(hostname)) return 'youtube';
    if (net.isIP(hostname)) return 'unsupported';
    if (isSoundCloudHostname(hostname)) return 'soundcloud';
    if (!hostname.includes('.') || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return 'unsupported';
    return AUDIO_FILE_EXTENSION.test(url.pathname) ? 'direct-audio' : 'unsupported';
}

function soundCloudSearchQuery(query, limit = 5) {
    const text = String(query ?? '').trim();
    if (!text || SOUNDCLOUD_SEARCH.test(text)) throw new Error('A non-empty search query is required.');
    const count = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 5)) : 5;
    return `scsearch${count}:${text}`;
}

function isSoundCloudSearch(value) {
    return SOUNDCLOUD_SEARCH.test(String(value ?? ''));
}

function isSpotifyUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname.toLowerCase() === 'open.spotify.com'
            && /^\/(?:intl-[a-z-]+\/)?(?:track|album|playlist)\/[a-z0-9]+\/?$/i.test(url.pathname);
    } catch {
        return false;
    }
}

function isPublicIpv4(address) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c <= 2) || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
}

function isPublicIp(address) {
    const version = net.isIP(address);
    if (version === 4) return isPublicIpv4(address);
    if (version !== 6) return false;

    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicIp(normalized.slice(7));
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith('2001:db8:');
}

async function validateMusicUrl(value, lookup = dns.lookup) {
    const kind = classifyMusicUrl(value);
    if (kind !== 'soundcloud' && kind !== 'direct-audio') {
        throw new Error(kind === 'youtube'
            ? 'YouTube links are not supported. Use SoundCloud or a direct HTTPS audio-file URL.'
            : 'Use a SoundCloud link or a direct HTTPS audio-file URL.');
    }

    const url = new URL(value);
    url.hash = '';
    if (kind === 'direct-audio') {
        let addresses;
        try {
            addresses = await lookup(url.hostname, { all: true, verbatim: true });
        } catch (error) {
            throw new Error(`Could not verify the audio host: ${error.message}`);
        }
        if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
            throw new Error('The audio URL must resolve only to public internet addresses.');
        }
    }
    return url.href;
}

async function validateMusicTarget(value, lookup) {
    if (isSoundCloudSearch(value)) return value;
    return validateMusicUrl(value, lookup);
}

module.exports = {
    classifyMusicUrl,
    isSpotifyUrl,
    isSoundCloudSearch,
    soundCloudSearchQuery,
    validateMusicTarget,
    validateMusicUrl,
};
