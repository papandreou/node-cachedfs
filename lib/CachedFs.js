var Path = require('path'),
    _ = require('underscore'),
    memoizeAsync = require('memoizeasync'),
    memoizeSync = require('memoizesync'),
    passError = require('passerror'),
    BufferedStream = require('bufferedstream'),
    LRUCache = require('lru-cache'),
    squeal = require('./squeal'),
    nextCacheKeyPrefix = 1; // Make sure that multiple CachedFs instances can share the same cache

function CachedFs(options) {
    var that = this;

    if (options && options.readFile) {
        // Support new CachedFs(require('fs'))
        options = {fs: options};
    } else {
        options = _.extend({}, options);
    }

    var fs = options.fs || require('fs'),
        context = options.context || fs,
        cache,
        cacheKeyPrefix;

    if (options.cache) {
        cache = options.cache;
    } else {
        options.length = options.length || CachedFs.estimateLengthOfMemoizedValue;
        cache = new LRUCache(options);
    }

    that.cache = cache;

    if ('cacheKeyPrefix' in options) {
        cacheKeyPrefix = String(options.cacheKeyPrefix);
    } else {
        cacheKeyPrefix = nextCacheKeyPrefix + '\x1d';
        nextCacheKeyPrefix += 1;
    }

    function getCacheKey(asyncFunctionName) { // ...
        return cacheKeyPrefix + asyncFunctionName + '\x1d' + (arguments.length > 1 ? argumentsStringifier(Array.prototype.slice.call(arguments, 1)) : '');
    }

    that.cache = cache;
    that.cacheKeyPrefix = cacheKeyPrefix;
    that.getCacheKey = getCacheKey;

    // Override the default argumentsStringifier to make sure that paths are absolutified and
    // that options objects with different options stringify differently
    function argumentsStringifier(args) {
        return args.map(function (arg, i) {
            if (arg && typeof arg === 'object') {
                return JSON.stringify(arg);
            } else {
                if (i === 0) {
                    // The first argument is always a path to a file or directory.
                    // Absolutify and normalize it so relative and unnormalized representations share the same
                    // cache key:
                    return Path.resolve(process.cwd(), arg);
                } else {
                    return String(arg);
                }
            }
        }).join('\x1d');
    };

    that.argumentsStringifier = argumentsStringifier;

    ['stat', 'lstat', 'readlink', 'realpath', 'readdir', 'readFile', 'exists'].forEach(function (asyncFunctionName) {
        var memoizedAsyncFunction,
            memoizerOptions = {
                context: context,
                argumentsStringifier: argumentsStringifier,
                cacheKeyPrefix: getCacheKey(asyncFunctionName),
                cache: cache
            };

        if (asyncFunctionName in fs) {
            memoizedAsyncFunction = that[asyncFunctionName] = memoizeAsync(fs[asyncFunctionName], memoizerOptions);
            if (options.debug) {
                squeal(that, asyncFunctionName);
            }
        }
        var syncFunctionName = asyncFunctionName + 'Sync';
        if (syncFunctionName in fs) {
            that[syncFunctionName] = memoizeSync(fs[syncFunctionName], memoizerOptions);
            if (options.debug) {
                squeal(that, syncFunctionName);
            }
        } else if (memoizedAsyncFunction) {
            that[syncFunctionName] = function () { // ...
                var resultCallbackParams = memoizedAsyncFunction.peek.apply(memoizedAsyncFunction, arguments);
                if (resultCallbackParams) {
                    if (resultCallbackParams[0]) {
                        throw resultCallbackParams[0];
                    } else {
                        return resultCallbackParams[1];
                    }
                } else {
                    throw new Error('CachedFs.' + syncFunctionName + ': No memoized ' + asyncFunctionName + ' result found');
                }
            };
            if (options.debug) {
                squeal(that, syncFunctionName);
            }
        }
    });

    if (fs.createReadStream || fs.readFile || fs.readFileSync) {
        var getReadStreamChunks = memoizeAsync(function (fileName, options, cb) { // ...
            var chunks = [];
            if ('createReadStream' in fs) {
                fs.createReadStream(fileName, options)
                    .on('data', function (chunk) {
                        chunks.push(chunk);
                    })
                    .on('end', function () {
                        cb(null, chunks);
                    })
                    .on('error', cb);
            } else {
                var encoding = (options && options.encoding) || null;
                if (fs.readFile) {
                    fs.readFile(fileName, encoding, passError(cb, function (contents) {
                        chunks.push(contents);
                        cb(null, chunks);
                    }));
                } else {
                    // fs.readFileSync
                    chunks.push(fs.readFileSync(fileName, encoding));
                    process.nextTick(function () {
                        cb(null, chunks);
                    });
                }
            }
        }, {argumentsStringifier: argumentsStringifier});

        // TODO: The first reader doesn't really need to wait for all the chunks to be emitted.
        that.createReadStream = function (fileName, options) {
            var bufferedStream = new BufferedStream();
            getReadStreamChunks(fileName, options, function (err, chunks) {
                if (err) {
                    return bufferedStream.emit('error', err);
                }
                chunks.forEach(function (chunk) {
                    bufferedStream.write(chunk);
                });
                bufferedStream.end();
            });
            return bufferedStream;
        };
    }

    if (!options.skipUnimplemented) {
        // This is a read-only fs, so the watch functions don't need to do anything:
        that.watchFile = that.watch = function () {};

        // Make all other functions from the wrapped fs module error out:
        Object.keys(fs).forEach(function (fsPropertyName) {
            if (typeof fs[fsPropertyName] === 'function' && !(fsPropertyName in that)) {
                that[fsPropertyName] = function () {
                    var err = new Error('CachedFs.' + fsPropertyName + ': Not implemented');
                    if (/Sync$/.test(fsPropertyName)) {
                        throw err;
                    } else {
                        var cb = arguments[arguments.length - 1];
                        process.nextTick(function () {
                            cb(err);
                        });
                    }
                };
            }
        });
    }
}

// The default 'length' function for lru-cache
CachedFs.estimateLengthOfMemoizedValue = function (errorAndResult) {
    var err = errorAndResult[0],
        result = errorAndResult[1];
    if (err) {
        // Arbitrarily count memoized errors as equivalent to 1 KB:
        return 1024;
    } else if (typeof result === 'string' || Buffer.isBuffer(result)) {
        return result.length; // Should actually be Buffer.byteLength(body) for strings, but that would need to plow through the entire thing
    } else if (Array.isArray(result)) {
        // Arbitrarily count readdir results as half a kilobyte plus 10 times the number of items
        return 512 + 10 * result.length;
    } else if (result && typeof result === 'object') {
        // Arbitrarily count stat results as 1 KB:
        return 1024;
    } else {
        // In case the above don't cover all the possible return values, count everything else as half a KB:
        return 512;
    }
};

CachedFs.patchInPlace = function (options) {
    options = _.extend({}, options);
    options.fs = options.fs || require('fs');
    options.skipUnimplemented = true; // So it doesn't overwrite openSync etc.
    var fs = options.fs,
        fsShallowCopy = _.extend({}, fs);
    options.context = fsShallowCopy;
    var cachedFs = new CachedFs(options);
    _.extend(fs, cachedFs);
    fs.unpatch = function () {
        if ('unpatch' in fsShallowCopy) {
            fs.unpatch = fsShallowCopy.unpatch;
        } else {
            delete fs.unpatch;
        }
        Object.keys(cachedFs).forEach(function (propertyName) {
            if (propertyName in fsShallowCopy) {
                fs[propertyName] = fsShallowCopy[propertyName];
            } else {
                delete fs[propertyName];
            }
        });
    };
};

module.exports = CachedFs;
