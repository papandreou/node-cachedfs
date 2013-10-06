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

    options = options || {};

    var fs = options.fs || require('fs'),
        context = options.context || fs,
        cache = that.cache = options.cache || new LRUCache(options),
        cacheKeyPrefix;

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
