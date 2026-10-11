function visibleTrackPlayCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 10 ? count : null;
}

module.exports = { visibleTrackPlayCount };
