function getModerationRoute(commandName, routes) {
    return Object.hasOwn(routes, commandName) ? routes[commandName] : null;
}

module.exports = { getModerationRoute };
