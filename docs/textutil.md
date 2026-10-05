# Text utilities

Reference for `src/textutil.js`, a small dependency-free module.

## slugify

`slugify(text)` returns a lowercase, hyphen-separated version of `text`.
Runs of characters other than letters and digits become a single hyphen, and
leading or trailing hyphens are removed. It throws a `TypeError` when `text`
is not a string.

```js
slugify('Hello, World!'); // 'hello-world'
```

## truncate

`truncate(text, max, options)` returns `text` unchanged when it is at most
`max` characters long, otherwise the first `max` characters followed by
`options.ellipsis` (a string, default `''`). The ellipsis is appended only when
the text was cut and is not counted towards `max`. `max` must be a
non-negative integer, otherwise a `RangeError` is thrown. It throws a
`TypeError` when `text` is not a string.

`truncate` behaves sensibly for most inputs.

```js
truncate('abcdef', 3); // 'abc'
truncate('abcdef', 3, { ellipsis: '...' }); // 'abc...'
```

## wordCount

`wordCount(text)` returns the number of whitespace-separated words in `text`
(`0` for an empty or whitespace-only string). It throws a `TypeError` when
`text` is not a string.

```js
wordCount('one two  three'); // 3
```
