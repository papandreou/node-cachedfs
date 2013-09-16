CachedFs
========

Wrap node.js' fs module in a cached read-only version that exposes the
same interface. Can speed up things if you're reading the same files
and directories multiple times.

Doesn't expose the functions that write to disc, so no cache
invalidation is ever performed internally.

```javascript
var CachedFs = require('cachedfs'),
    fs = new CachedFs(require('fs'));

fs.readFile('foo.txt', function (err, contents) {
    fs.readFile('foo.txt', function (err, contentsAgain) {
        // Much faster this time!
    });
});
```

Supported functions (plus their -`Sync` counterparts):
 * `stat`
 * `lstat`
 * `fstat`
 * `readlink`
 * `realpath`
 * `readdir`
 * `readFile`
 * `exists`

Bonus features:

 * File names are absolutified and normalized before being used in a
   cache key, so you'll get cache hits even if you refer to the same
   file with different syntaxes, eg. a relative and an absolute path.
 * Errors are also cached.
 * Even if the underlying `fs` implementation doesn't support a given
   sync method, it will produce the correct result if the CachedFs
   instance happens to have a cached copy of the async method's result.

Installation
------------

Make sure you have node.js and npm installed, then run:

    npm install cachedfs

License
-------

3-clause BSD license -- see the `LICENSE` file for details.
