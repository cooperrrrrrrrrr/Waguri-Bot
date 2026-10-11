const test = require('node:test');
const assert = require('node:assert/strict');
const { shapeChatTurns, cleanChatReply } = require('../chat-turns');

test('chat keeps the bot\'s own message when someone replies to it', () => {
    const { messages, opening } = shapeChatTurns([
        { role: 'assistant', content: 'rain on the window again, perfect nap weather' },
        { role: 'user', content: 'mia: what are you listening to?' },
    ]);
    assert.deepEqual(messages, [{ role: 'user', content: 'mia: what are you listening to?' }]);
    assert.deepEqual(opening, ['rain on the window again, perfect nap weather']);
});

test('chat merges neighbouring turns from the same side and drops empty ones', () => {
    const { messages, opening } = shapeChatTurns([
        { role: 'user', content: 'mia: hi' },
        { role: 'user', content: '  ' },
        { role: 'user', content: 'kai: hey' },
        { role: 'assistant', content: 'hiya' },
        { role: 'user', content: 'mia: how are you?' },
    ]);
    assert.deepEqual(messages, [
        { role: 'user', content: 'mia: hi\nkai: hey' },
        { role: 'assistant', content: 'hiya' },
        { role: 'user', content: 'mia: how are you?' },
    ]);
    assert.deepEqual(opening, []);
});

test('chat does not change the turns it was given', () => {
    const turns = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }];
    shapeChatTurns(turns);
    assert.deepEqual(turns, [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]);
});

test('chat replies lose em dashes, name labels and pings', () => {
    assert.equal(cleanChatReply('omg hi!! \u2014 rehearsal was fun', 'Waguri'), 'omg hi!! rehearsal was fun');
    assert.equal(cleanChatReply('tea first \u2014 then a nap', 'Waguri'), 'tea first, then a nap');
    assert.equal(cleanChatReply('**Waguri:** hey <@123> @everyone', 'Waguri'), 'hey  everyone');
    assert.equal(cleanChatReply('## big news\nok', 'Waguri'), 'big news\nok');
});
