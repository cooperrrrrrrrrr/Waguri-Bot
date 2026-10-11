# Custom Discord Bot

A customisable copy of the Ruby Hoshino bot: music, moderation, security, economy and casino, reaction GIFs, games and more. The bot's **name, colours and wording come from `theme.json`**, while each server's channels and roles are configured separately with `.setup`.

## 1. Pick your theme: `theme.json`

```json
{
    "botName": "Sora",
    "serverName": "the server",
    "color": "#6fa8dc",
    "errorColor": "#e06666",
    "footer": "🌊 Sora • taking it easy",
    "currency": "¥",
    "helpTitle": "🍵 Help",
    "helpIntro": "Hi, I'm **Sora**. Pick a category below to see what I can do.",
    "welcomeImages": [],
    "showLevelBotCommands": false
}
```

| Setting | What it changes |
|---|---|
| `botName` | The bot's name everywhere it talks about itself ("Nova will hug you instead!") |
| `serverName` | Fallback server wording outside a guild; guild messages use the actual Discord server name |
| `color` / `errorColor` | The colour bar on normal and error embeds (hex, like `#7c5cff`) |
| `footer` | The small text at the bottom of every embed |
| `currency` | The money symbol for the economy and casino (`$`, `¥`, `🪙` and so on) |
| `helpTitle` / `helpIntro` | The title and greeting of the `.help` menu |
| `welcomeImages` | Image or GIF links for welcome messages (empty = a random anime wave GIF) |
| `showLevelBotCommands` | Show the Levels help page (only if you also run a separate level bot) |

`theme.json` applies to the whole bot, not separately to each server. Server
owners cannot currently set their own bot name, colours or currency. Guild
messages use that guild's actual Discord name. Restart the bot after editing
the theme.

## 2. Fill in `.env`

Copy `.env.example` to `.env` and paste in your **bot token**. Configure server channels and roles in Discord with `.setup`. Legacy channel/role IDs in `.env` or `config.json` are only used when they exist in the current server; don't rely on them for multi-server setup. Leave the dashboard port as it is if the bot shares a machine with another bot.

For local runs, `config.json` can provide the bot token instead. Keep `.env` and `config.json` private; both are ignored by Git.

## 3. Register slash commands

Slash commands are not registered just by starting the bot. Copy `config.example.json` to `config.json` and fill in the bot token and application ID. For quick testing, also set your test server ID, then run:

```sh
node deploy-commands.js
```

That registers commands only in the configured test server. To make slash commands available in all servers where the bot is installed, run:

```sh
node deploy-commands.js --global
```

Global command updates may take time to appear in Discord. Re-running either deployment replaces the application's existing command set for that scope.

## 4. Pick channels and roles in Discord: `.setup`

The server owner (or anyone with **Administrator**) types `.setup` in the server to see every setting with a ✅ or ❌ and the command to change it:

| Command | What it sets |
|---|---|
| `.setup welcome #channel` | Where new members are greeted |
| `.setup birthday #channel` / `.setup birthdayrole @role` | Birthday announcements and the birthday role |
| `.setup modlog #channel` | Moderation activity |
| `.setup joinlog #channel` | Who joins and leaves the server |
| `.setup caselog #channel` | Numbered warn/mute/jail/kick/ban cases |
| `.setup messagelog #channel` | Edited and deleted messages |
| `.setup alerts #channel` | Raid, spam and anti-nuke alerts |
| `.setup securitytest #channel` | Where the security self-test may run |
| `.setup jail #channel` / `.setup jailrole @role` | The jail channel and jail role |
| `.setup bump #channel` | DISBOARD bump reminders |
| `.setup streaks #channel` | Where daily chat streaks are announced (see below) |
| `.setup starboard #channel` | Where messages with enough ⭐ reactions are reposted (`.starboard threshold <n>`, default 3) |
| `.setup adminrole @role` / `.setup modrole @role` | Who counts as admin and mod |
| `.setup coowner add @user` | Give someone the owner's powers (owner only) |
| `.setup coowner remove @user` | Remove a co-owner (owner only) |
| `.setup ownerrole @role` | Everyone with this role gets the owner's powers (owner only) |
| `.setup updates #channel` | Where the bot posts its update notes |

Use `.setup <name> off` to clear one. Anything not set is simply switched off. Settings are saved per server in `data/setup.json`, and the bot warns you if it can't post in a channel or give out a role you picked. When the bot joins a server, it DMs the owner to tell them about `.setup`.

## Chat streaks

Chatting on consecutive days builds a streak. The first message each day posts "🔥 @member: Your **5-day streak** continues!" (with their profile picture) in the streaks channel and swaps their **Streak Day N** role (day 30+ keeps the day-30 role). Missing a whole day resets it and removes the role. A "day" follows the member's `.settimezone`, otherwise UTC.

- `.setup streaks #channel` - where streaks are announced
- `.streak roles auto` - link existing roles named like *Streak Day 1* to *Streak Day 30* (`create` makes missing ones, `clear` unlinks)
- `.streak [@user]` - current and best streak · `.streaktop` - leaderboard · `.streak reset @user` (admins)

Economy accounts, reminders, custom commands, and scheduled announcements are
scoped to the server where they are created. `.reminders` only lists reminders
created in the current server; each reminder is delivered to the channel where
it was set. Timezone preferences and Last.fm links are tied to the Discord user
and follow them between servers.

Birthdays are stored separately for each server. Existing user-only records
migrate to the configured `guildId` in `config.json`; without it, migration
uses the bot owner's configured birthday server or the only server with
birthday setup. If that target is ambiguous, the bot preserves the old data
and logs a warning. Public birthday displays show only the day and month.
The bot deletes a successful `.setbirthday` command to avoid leaving the birth
year in chat; if it cannot delete the command, it tells the user to remove it
manually.

## 5. Run it

The bot requires Node.js 22.12.0 or newer. Run these commands from the project
root (the directory containing `package.json` and `index.js`):

```
npm install
npm start
```

On a server, run it with pm2 so it restarts by itself: `pm2 start index.js --name custom-bot`.

## Development checks

Run `npm run check` to syntax-check every JavaScript file, and `npm test` to run the automated tests. GitHub Actions runs both checks on Node 22.12 and 24 on Linux and Windows.

These automated checks do not connect to Discord or validate a live bot token, server permissions, or Discord API behavior. Test those separately in a private server before deploying changes that affect moderation or security.

## The default theme

Out of the box the bot has a calm, blue, cozy theme: tea and cake, flowers, rainy days, naps and the odd strawberry milk. The shop sells strawberry milk, shortcake and flower bouquets, the status cycles through things like "rain on the window", and the wording is laid-back. Change `botName` (and `footer` / `helpIntro`) in `theme.json` to make it your own.
