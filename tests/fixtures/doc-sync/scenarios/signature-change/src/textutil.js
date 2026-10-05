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

function truncate(text, max, options = {}) {
    requireString(text, 'text');
    if (!Number.isInteger(max) || max < 0) {
        throw new RangeError('max must be a non-negative integer');
    }
    if (text.length <= max) return text;
    return text.slice(0, max) + (options.ellipsis || '');
}

function wordCount(text) {
    requireString(text, 'text');
    return text.split(/\s+/).filter(Boolean).length;
}

module.exports = { slugify, truncate, wordCount };
