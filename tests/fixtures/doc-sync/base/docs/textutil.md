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

`truncate(text, max)` returns `text` unchanged when it is at most `max`
characters long, otherwise the first `max` characters. `max` must be a
non-negative integer, otherwise a `RangeError` is thrown. It throws a
`TypeError` when `text` is not a string.

`truncate` behaves sensibly for most inputs.

```js
truncate('abcdef', 3); // 'abc'
```
