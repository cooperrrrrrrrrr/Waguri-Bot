const assert = require('node:assert/strict');
const test = require('node:test');
const family = require('../family');

const G = 'guild';

test('marriage needs two single, unrelated people', () => {
    const data = {};
    assert.equal(family.marry(data, G, 'a', 'a').reason, 'self');
    assert.deepEqual(family.marry(data, G, 'a', 'b'), { ok: true });
    assert.equal(family.marry(data, G, 'a', 'c').reason, 'partnered');
    assert.equal(family.marry(data, G, 'c', 'b').reason, 'target_partnered');
    assert.equal(data[G].a.partner, 'b');
    assert.equal(data[G].b.partner, 'a');
});

test('divorce clears both sides and tidies empty records', () => {
    const data = {};
    family.marry(data, G, 'a', 'b');
    assert.equal(family.divorce(data, G, 'b').partner, 'a');
    assert.deepEqual(data, {});
    assert.equal(family.divorce(data, G, 'a').reason, 'no_partner');
});

test('adopting also makes the partner a parent', () => {
    const data = {};
    family.marry(data, G, 'a', 'b');
    assert.deepEqual(family.adopt(data, G, 'a', 'kid'), { ok: true, coParent: 'b' });
    assert.deepEqual(data[G].kid.parents, ['a', 'b']);
    assert.deepEqual(family.childrenOf(data, G, 'b'), ['kid']);
    assert.equal(family.adopt(data, G, 'a', 'kid').reason, 'already_parent');
    assert.equal(family.adopt(data, G, 'x', 'kid').reason, 'max_parents');
});

test('adoption cannot make loops or adopt a spouse', () => {
    const data = {};
    family.adopt(data, G, 'grandma', 'mum');
    family.adopt(data, G, 'mum', 'kid');
    assert.equal(family.adopt(data, G, 'kid', 'grandma').reason, 'ancestor');
    assert.equal(family.adopt(data, G, 'kid', 'mum').reason, 'ancestor');
    assert.equal(family.adopt(data, G, 'mum', 'mum').reason, 'self');
    family.marry(data, G, 'p', 'q');
    assert.equal(family.adopt(data, G, 'p', 'q').reason, 'partner_is_child');
});

test('relatives cannot marry', () => {
    const data = {};
    family.adopt(data, G, 'mum', 'a');
    family.adopt(data, G, 'mum', 'b');
    assert.equal(family.marry(data, G, 'a', 'b').reason, 'related');
    assert.equal(family.marry(data, G, 'mum', 'a').reason, 'related');
});

test('disown and runaway remove parent links', () => {
    const data = {};
    family.marry(data, G, 'a', 'b');
    family.adopt(data, G, 'a', 'kid');
    assert.deepEqual(family.disown(data, G, 'a', 'kid'), { ok: true });
    assert.deepEqual(data[G].kid.parents, ['b']);
    assert.equal(family.disown(data, G, 'a', 'kid').reason, 'not_child');
    assert.deepEqual(family.runaway(data, G, 'kid').parents, ['b']);
    assert.equal(family.runaway(data, G, 'kid').reason, 'no_parents');
    assert.equal(data[G].kid, undefined);
});

test('servers keep separate families', () => {
    const data = {};
    family.marry(data, 'one', 'a', 'b');
    assert.equal(family.hasFamily(data, 'two', 'a'), false);
    assert.deepEqual(family.marry(data, 'two', 'a', 'c'), { ok: true });
});

test('a parent can only have so many children', () => {
    const data = {};
    for (let i = 0; i < family.MAX_CHILDREN; i += 1) assert.equal(family.adopt(data, G, 'p', `k${i}`).ok, true);
    assert.equal(family.adopt(data, G, 'p', 'extra').reason, 'too_many_children');
});

test('tree layout puts a couple above their children, centred', () => {
    const data = {};
    family.marry(data, G, 'joy', 'cece');
    family.adopt(data, G, 'joy', 'cooper');
    family.adopt(data, G, 'joy', 'mars');
    family.adopt(data, G, 'grand', 'joy');
    const tree = family.buildTree(data, G, 'cooper');

    assert.equal(tree.members, 5);
    assert.equal(tree.generations, 3);
    const unitWith = (id) => tree.units.find((u) => u.ids.includes(id));
    assert.deepEqual(new Set(unitWith('joy').ids), new Set(['joy', 'cece']));
    assert.equal(unitWith('grand').gen, 0);
    assert.equal(unitWith('joy').gen, 1);
    assert.equal(unitWith('cooper').gen, 2);
    const kids = [unitWith('cooper'), unitWith('mars')];
    assert.ok(kids[0].cx < kids[1].cx);
    assert.ok(Math.abs((kids[0].cx + kids[1].cx) / 2 - unitWith('joy').cx) < 1e-9);
    assert.ok(tree.links.length >= 3);
});

test('tree layout survives in-law loops and caps the size', () => {
    const data = {};
    family.marry(data, G, 'a', 'b');
    family.marry(data, G, 'c', 'd');
    family.adopt(data, G, 'c', 'a');
    family.adopt(data, G, 'b', 'd');
    assert.ok(family.buildTree(data, G, 'a').members >= 4);

    const big = {};
    for (let i = 0; i < 10; i += 1) family.adopt(big, G, 'root', `c${i}`);
    for (let i = 0; i < 10; i += 1) for (let j = 0; j < 5; j += 1) family.adopt(big, G, `c${i}`, `g${i}-${j}`);
    assert.equal(family.buildTree(big, G, 'root', 20).members, 20);
});
