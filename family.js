const MAX_PARENTS = 2;
const MAX_CHILDREN = 10;

const recordOf = (data, guildId, userId) => data[guildId]?.[userId];

function ensureRecord(data, guildId, userId) {
    data[guildId] ??= {};
    data[guildId][userId] ??= { partner: null, parents: [] };
    return data[guildId][userId];
}

function tidy(data, guildId, ...userIds) {
    for (const id of userIds) {
        const rec = recordOf(data, guildId, id);
        if (rec && !rec.partner && !rec.parents.length) delete data[guildId][id];
    }
    if (data[guildId] && !Object.keys(data[guildId]).length) delete data[guildId];
}

function childrenOf(data, guildId, userId) {
    return Object.entries(data[guildId] ?? {})
        .filter(([, rec]) => rec.parents.includes(userId))
        .map(([id]) => id);
}

function ancestorsOf(data, guildId, userId) {
    const seen = new Set();
    const queue = [...(recordOf(data, guildId, userId)?.parents ?? [])];
    while (queue.length) {
        const id = queue.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(...(recordOf(data, guildId, id)?.parents ?? []));
    }
    return seen;
}

function areRelated(data, guildId, a, b) {
    if (ancestorsOf(data, guildId, a).has(b) || ancestorsOf(data, guildId, b).has(a)) return true;
    const parentsA = recordOf(data, guildId, a)?.parents ?? [];
    return (recordOf(data, guildId, b)?.parents ?? []).some((p) => parentsA.includes(p));
}

const hasFamily = (data, guildId, userId) => Boolean(recordOf(data, guildId, userId)) || childrenOf(data, guildId, userId).length > 0;

function marry(data, guildId, a, b) {
    if (a === b) return { ok: false, reason: 'self' };
    if (recordOf(data, guildId, a)?.partner) return { ok: false, reason: 'partnered' };
    if (recordOf(data, guildId, b)?.partner) return { ok: false, reason: 'target_partnered' };
    if (areRelated(data, guildId, a, b)) return { ok: false, reason: 'related' };
    ensureRecord(data, guildId, a).partner = b;
    ensureRecord(data, guildId, b).partner = a;
    return { ok: true };
}

function divorce(data, guildId, userId) {
    const partner = recordOf(data, guildId, userId)?.partner;
    if (!partner) return { ok: false, reason: 'no_partner' };
    data[guildId][userId].partner = null;
    if (recordOf(data, guildId, partner)) data[guildId][partner].partner = null;
    tidy(data, guildId, userId, partner);
    return { ok: true, partner };
}

function adopt(data, guildId, parentId, childId) {
    if (parentId === childId) return { ok: false, reason: 'self' };
    const parentRec = recordOf(data, guildId, parentId);
    const partnerId = parentRec?.partner ?? null;
    if (partnerId === childId) return { ok: false, reason: 'partner_is_child' };
    if (recordOf(data, guildId, childId)?.parents.includes(parentId)) return { ok: false, reason: 'already_parent' };
    if ((recordOf(data, guildId, childId)?.parents.length ?? 0) >= MAX_PARENTS) return { ok: false, reason: 'max_parents' };
    if (ancestorsOf(data, guildId, parentId).has(childId)) return { ok: false, reason: 'ancestor' };
    if (partnerId && ancestorsOf(data, guildId, partnerId).has(childId)) return { ok: false, reason: 'ancestor' };
    if (childrenOf(data, guildId, parentId).length >= MAX_CHILDREN) return { ok: false, reason: 'too_many_children' };

    const child = ensureRecord(data, guildId, childId);
    child.parents.push(parentId);
    ensureRecord(data, guildId, parentId);
    let coParent = null;
    if (partnerId && child.parents.length < MAX_PARENTS && !child.parents.includes(partnerId)) {
        child.parents.push(partnerId);
        coParent = partnerId;
    }
    return { ok: true, coParent };
}

function disown(data, guildId, parentId, childId) {
    const child = recordOf(data, guildId, childId);
    if (!child?.parents.includes(parentId)) return { ok: false, reason: 'not_child' };
    child.parents = child.parents.filter((p) => p !== parentId);
    tidy(data, guildId, childId, parentId);
    return { ok: true };
}

function runaway(data, guildId, childId) {
    const child = recordOf(data, guildId, childId);
    if (!child?.parents.length) return { ok: false, reason: 'no_parents' };
    const parents = child.parents;
    child.parents = [];
    tidy(data, guildId, childId, ...parents);
    return { ok: true, parents };
}

function buildTree(data, guildId, rootId, max = 36) {
    const children = new Map();
    for (const [id, rec] of Object.entries(data[guildId] ?? {})) {
        for (const p of rec.parents) children.set(p, [...(children.get(p) ?? []), id]);
    }

    const generation = new Map([[rootId, 0]]);
    const order = [rootId];
    for (let i = 0; i < order.length; i += 1) {
        const id = order[i];
        const g = generation.get(id);
        const rec = recordOf(data, guildId, id);
        const near = [
            ...(rec?.partner ? [[rec.partner, g]] : []),
            ...(rec?.parents ?? []).map((p) => [p, g - 1]),
            ...(children.get(id) ?? []).map((c) => [c, g + 1]),
        ];
        for (const [other, otherGen] of near) {
            if (order.length >= max) break;
            if (!generation.has(other)) {
                generation.set(other, otherGen);
                order.push(other);
            }
        }
    }
    const minGen = Math.min(...generation.values());
    const people = new Set(order);

    const units = [];
    const unitOf = new Map();
    for (const id of order) {
        if (unitOf.has(id)) continue;
        const partner = recordOf(data, guildId, id)?.partner;
        const ids = partner && people.has(partner) ? [id, partner] : [id];
        const unit = { ids, gen: generation.get(id) - minGen, parentUnits: [], kids: [], cx: 0 };
        units.push(unit);
        for (const member of ids) unitOf.set(member, unit);
    }

    const links = [];
    for (const unit of units) {
        for (const member of unit.ids) {
            for (const p of recordOf(data, guildId, member)?.parents ?? []) {
                const parentUnit = unitOf.get(p);
                if (parentUnit && parentUnit !== unit && !unit.parentUnits.includes(parentUnit)) unit.parentUnits.push(parentUnit);
            }
        }
        for (const parentUnit of unit.parentUnits) links.push({ parent: units.indexOf(parentUnit), child: units.indexOf(unit) });
        let up = unit.parentUnits[0];
        const first = up;
        while (up && up !== unit) up = up.primary;
        if (first && !up) {
            unit.primary = first;
            first.kids.push(unit);
        }
    }

    const COUPLE = 2.15;
    const GAP = 0.15;
    const widthOf = (unit) => {
        const own = unit.ids.length === 2 ? COUPLE : 1;
        const kids = unit.kids.reduce((sum, k) => sum + widthOf(k), 0);
        unit.width = Math.max(own, kids);
        return unit.width;
    };
    const place = (unit, left) => {
        const kidsWidth = unit.kids.reduce((sum, k) => sum + k.width, 0);
        let cursor = left + (unit.width - kidsWidth) / 2;
        for (const kid of unit.kids) {
            place(kid, cursor);
            cursor += kid.width;
        }
        unit.cx = left + unit.width / 2;
    };
    let cursor = 0;
    for (const unit of units.filter((u) => !u.primary)) {
        widthOf(unit);
        place(unit, cursor);
        cursor += unit.width + GAP;
    }

    return {
        units: units.map(({ ids, gen, cx }) => ({ ids, gen, cx })),
        links,
        members: order.length,
        generations: Math.max(...units.map((u) => u.gen)) + 1,
        width: Math.max(cursor - GAP, 1),
    };
}

module.exports = { MAX_PARENTS, MAX_CHILDREN, childrenOf, ancestorsOf, areRelated, hasFamily, marry, divorce, adopt, disown, runaway, buildTree };
