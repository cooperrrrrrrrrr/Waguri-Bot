function getTargetUserId(arg) {
    return arg?.match(/^<@!?(\d{17,20})>$/)?.[1] ?? arg?.match(/^(\d{17,20})$/)?.[1] ?? null;
}

async function resolveTargetMember(message, arg) {
    const id = getTargetUserId(arg);
    if (!id || !message.guild) return null;
    return message.guild.members.fetch(id).catch(() => null);
}

module.exports = { getTargetUserId, resolveTargetMember };
