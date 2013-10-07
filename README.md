CachedFs
========

Wrap node.js' fs module in a cached read-only version that exposes the
same interface. Can speed up things if you're reading the same files
and directories multiple times, and things don't change on disc.

Doesn't expose the functions that write to disc, so no cache
invalidation is ever performed internally.

```javascript
var CachedFs = require('cachedfs'),
    fs = new CachedFs();

fs.readFile('foo.txt', function (err, contents) {
    fs.readFile('foo.txt', function (err, contentsAgain) {
        // Much faster this time!
    });
});
```

You can also patch the built-in `fs` module or a compatible one
in-place (this should be considered a bit experimental):

```javascript
require('cachedfs').patchInPlace();

require('fs').readFile('foo.txt', function (err, contents) {
    // Yup, this will be cached!
});
```

The `CachedFs` constructor and `CachedFs.patchInPlace` support an
options object with the following options:

* `cache`: An existing `node-lru` instance to use for the cached
  data. The default is to create a new one (exposed via `cachedFs.cache`).

* `cacheKeyPrefix`: Defaults to a session-unique number so that
  multiple `CachedFs` instances can be backed by the same `lru-cache`
  instance. You can override this to explicitly force two `CachedFs`
  instances to share the same cached data for some reason.

* `max`, `maxAge`, `length`, `dispose`, `stale`, : Passed to the
  `lru-cache` constructor unless the `cache` option is specified. See
  [the lru-cache README for
  details](https://github.com/isaacs/node-lru-cache).

If you don't specify a `length` option, it will default to a function
that approximates the number of bytes occupied by the cached
values. That means you can use the `max` option to set an upper limit
on the memory usage in bytes.

An instantiated `CachedFs` has the following properties:

* `cacheKeyPrefix`: The string prefix of all keys stored in the cache.

* `cache`: The `lru-cache` instance. Useful for checking
  `cache.length`, `cache.itemCount`, or purging all cached items via
  `cache.reset()`, etc. See [the lru-cache
  README](https://github.com/isaacs/node-lru-cache).

Supported methods (plus their -`Sync` counterparts):
 * `stat`
 * `lstat`
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
