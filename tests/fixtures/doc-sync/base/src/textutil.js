// Small dependency-free text helpers used to demonstrate documentation sync.

function requireString(value, name) {
    if (typeof value !== 'string') {
        throw new TypeError(`${name} must be a string`);
    }
}

function slugify(text) {
    requireString(text, 'text');
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function truncate(text, max) {
    requireString(text, 'text');
    if (!Number.isInteger(max) || max < 0) {
        throw new RangeError('max must be a non-negative integer');
    }
    return text.length <= max ? text : text.slice(0, max);
}

module.exports = { slugify, truncate };
