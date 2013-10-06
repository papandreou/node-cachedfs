var Path = require('path'),
    memoizeAsync = require('memoizeasync'),
    memoizeSync = require('memoizesync'),
    passError = require('passerror'),
    BufferedStream = require('bufferedstream');

function CachedFs(fs, options) {
    fs = fs || require('fs');

    var that = this;

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

    ['stat', 'lstat', 'fstat', 'readlink', 'realpath', 'readdir', 'readFile', 'exists'].forEach(function (asyncFunctionName) {
        var memoizedAsyncFunction;
        if (asyncFunctionName in fs) {
            memoizedAsyncFunction = that[asyncFunctionName] = memoizeAsync(fs[asyncFunctionName], {argumentsStringifier: argumentsStringifier});
        }
        var syncFunctionName = asyncFunctionName + 'Sync';
        if (syncFunctionName in fs) {
            that[syncFunctionName] = memoizeSync(fs[syncFunctionName], {argumentsStringifier: argumentsStringifier});
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

module.exports = CachedFs;
