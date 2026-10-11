function shapeChatTurns(turns) {
    const merged = [];
    for (const turn of turns) {
        if (!turn.content.trim()) continue;
        const last = merged[merged.length - 1];
        if (last && last.role === turn.role) last.content += `\n${turn.content}`;
        else merged.push({ role: turn.role, content: turn.content });
    }
    const opening = [];
    while (merged.length && merged[0].role !== 'user') opening.push(merged.shift().content);
    return { messages: merged, opening };
}

function cleanChatReply(text, botName) {
    const name = String(botName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(text)
        .replace(new RegExp(`^\\s*(?:\\*\\*)?${name}(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?\\s*`, 'i'), '')
        .replace(/^#+\s*/gm, '')
        .replace(/@(everyone|here)/gi, '$1')
        .replace(/<@[!&]?\d+>/g, '')
        .replace(/([!?.,~])\s*\u2014\s*/g, '$1 ')
        .replace(/\s*\u2014\s*/g, ', ')
        .trim();
}

module.exports = { shapeChatTurns, cleanChatReply };
