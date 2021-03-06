var expect = require('unexpected-sinon'),
    sinon = require('sinon'),
    Path = require('path'),
    LRUCache = require('lru-cache'),
    passError = require('passerror'),
    CachedFs = require('../lib/CachedFs'),
    pathToTestFiles = Path.resolve(__dirname, 'root'),
    pathToFooTxt = Path.resolve(pathToTestFiles, 'foo.txt'),
    pathToBarTxt = Path.resolve(pathToTestFiles, 'bar.txt'),
    pathToQuuxTxt = Path.resolve(pathToTestFiles, 'quux.txt'),
    pathToNonExistentFile = Path.resolve(pathToTestFiles, 'i', 'do', 'not', 'exist.txt'),
    alternativePathToFooTxt = pathToTestFiles + Path.sep + '.' + Path.sep + 'foo.txt';

describe('CachedFs', function () {
    describe('applied to a stubbed out fs module with only a readFile function', function () {
        var stubbedFs,
            cachedFs;

        beforeEach(function () {
            stubbedFs = {
                readFile: function (fileName, encoding, cb) {
                    if (typeof encoding === 'function') {
                        cb = encoding;
                        encoding = null;
                    }
                    process.nextTick(function () {
                        var contents = new Buffer('the contents of ' + fileName, 'utf-8');
                        if (encoding) {
                            contents = contents.toString('utf-8');
                        }
                        cb(null, contents);
                    });
                }
            };
            sinon.spy(stubbedFs, 'readFile');
            cachedFs = new CachedFs(stubbedFs);
        });

        it('should produce an object with a readFile and readFileSync property', function () {
            expect(cachedFs, 'to have keys', ['readFile', 'readFileSync']);
        });

        it('should only call the stubbed-out readFile once if the same file is first read a Buffer, then again synchronously with an encoding parameter', function (done) {
            cachedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                expect(firstContents, 'to be a', Buffer);
                var syncReadContents = cachedFs.readFileSync(pathToFooTxt, 'utf-8');
                expect(syncReadContents, 'to be a string');
                expect(firstContents.toString('utf-8'), 'to equal', syncReadContents);
                expect(stubbedFs.readFile, 'was called once');
                done();
            }));
        });

        it('should only call the stubbed-out readFile once', function (done) {
            cachedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (secondContents) {
                    expect(stubbedFs.readFile, 'was called once');
                    done();
                }));
            }));
        });

        it('should have a readFileSync that throws if readFile has not previously been called with the same arguments', function () {
            expect(function () {
                cachedFs.readFileSync(pathToFooTxt);
            }, 'to throw exception', 'CachedFs.readFileSync: No memoized readFile result found');
        });

        it('should have a readFileSync that works if readFile has previously been called with the same arguments', function (done) {
            cachedFs.readFile(pathToFooTxt, passError(done, function (contents) {
                var syncReadContents = cachedFs.readFileSync(pathToFooTxt);
                expect(syncReadContents, 'to be', contents);
                done();
            }));
        });

        it('should make createReadStream work', function (done) {
            var chunks = [];
            cachedFs.createReadStream(pathToFooTxt)
               .on('data', function (chunk) {
                   chunks.push(chunk);
               })
               .on('end', function () {
                   expect(chunks, 'to have length', 1);
                   expect(chunks[0].toString('utf-8'), 'to equal', 'the contents of ' + pathToFooTxt);
                   done();
               });
        });
    });

    describe('applied to the built-in fs module', function () {
        describe('with the default options', function () {
            var cachedFs;
            beforeEach(function () {
                cachedFs = new CachedFs(require('fs'));
            });

            it('should be able to readFile foo.txt', function (done) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (contents) {
                    expect(contents, 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
                    done();
                }));
            });

            it('should compute the size of the cache correctly after a file has been read', function () {
                expect(cachedFs.cache.length, 'to equal', 0);
                cachedFs.readFileSync(pathToFooTxt);
                expect(cachedFs.cache.length, 'to equal', new Buffer('bla☺bla\n', 'utf-8').length);
            });

            it('should compute the size of the cache correctly after a file has been statted', function () {
                expect(cachedFs.cache.length, 'to equal', 0);
                cachedFs.statSync(pathToFooTxt);
                expect(cachedFs.cache.length, 'to equal', 1024);
            });

            it('should compute the size of the cache correctly after a directory has been readdired', function () {
                expect(cachedFs.cache.length, 'to equal', 0);
                var entries = cachedFs.readdirSync(pathToTestFiles);
                expect(cachedFs.cache.length, 'to equal', 512 + entries.length * 10);
            });

            it('should compute the size of the cache correctly after an error has been cached', function () {
                expect(cachedFs.cache.length, 'to equal', 0);
                expect(function () {
                    cachedFs.readFileSync(pathToNonExistentFile);
                }, 'to throw exception', "ENOENT, no such file or directory '" + pathToNonExistentFile + "'");
                expect(cachedFs.cache.length, 'to equal', 1024);
            });

            it('should be able to readFileSync foo.txt', function () {
                expect(cachedFs.readFileSync(pathToFooTxt), 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
            });

            it('should use the same cache key for readFile and readFileSync', function (done) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (asyncReadContents) {
                    var syncReadContents = cachedFs.readFileSync(pathToFooTxt);
                    expect(asyncReadContents, 'to be', syncReadContents);
                    expect(cachedFs.cache.keys(), 'to have length', 1);
                    done();
                }));
            });

            it('should be able to readFile foo.txt as utf-8', function (done) {
                cachedFs.readFile(pathToFooTxt, 'utf-8', passError(done, function (contents) {
                    expect(contents, 'to equal', 'bla☺bla\n');
                    done();
                }));
            });

            it('should be able to readFile foo.txt as utf-8 then as a Buffer', function (done) {
                cachedFs.readFile(pathToFooTxt, 'utf-8', passError(done, function (contents) {
                    expect(contents, 'to equal', 'bla☺bla\n');
                    cachedFs.readFile(pathToFooTxt, passError(done, function (contentsAsBuffer) {
                        expect(contentsAsBuffer, 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
                        done();
                    }));
                }));
            });

            // This is debatable, maybe they should get different Buffer instances?
            it('should return the same Buffer instance when the readFile function is called repeatedly', function (done) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                    expect(firstContents, 'to be', firstContents);
                    cachedFs.readFile(pathToFooTxt, passError(done, function (secondContents) {
                        expect(secondContents, 'to be', firstContents);
                        done();
                    }));
                }));
            });

            it('should return the same buffer instance when the readFile function is called more than once with different representations of the path to foo.txt', function (done) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                    cachedFs.readFile(alternativePathToFooTxt, passError(done, function (secondContents) {
                        expect(secondContents, 'to be', firstContents);
                        done();
                    }));
                }));
            });

            // This is debatable, maybe they should get different array instances?
            it('should return the same array when readdir is called with and without a trailing slash', function (done) {
                cachedFs.readdir(pathToTestFiles, passError(done, function (firstEntries) {
                    cachedFs.readdir(pathToTestFiles + Path.sep, passError(done, function (secondEntries) {
                        expect(secondEntries, 'to be', firstEntries);
                        done();
                    }));
                }));
            });

            it('should return the same chunks when createReadStream is called twice with the same arguments', function (done) {
                var readStreams = [
                    cachedFs.createReadStream(pathToFooTxt),
                    cachedFs.createReadStream(pathToFooTxt)
                ];
                readStreams.forEach(function (readStream) {
                    readStream.on('data', function (chunk) {
                        (readStream.chunks = readStream.chunks || []).push(chunk);
                    }).on('end', function () {
                        readStream.hasEnded = true;
                        if (readStreams.every(function (readStream) {return readStream.hasEnded;})) {
                            expect(readStreams[0].chunks, 'to have length', 1);
                            expect(readStreams[1].chunks, 'to have length', 1);
                            expect(readStreams[0].chunks[0], 'to be', readStreams[1].chunks[0]);
                            done();
                        }
                    });
                });
            });
        });
        describe('with a custom cache and cacheKeyPrefix', function () {
            var cachedFs,
                cacheKeyPrefix,
                cache;

            beforeEach(function () {
                cacheKeyPrefix = 999;
                cache = new LRUCache({
                    max: 2
                });
                cachedFs = new CachedFs({fs: require('fs'), cache: cache, cacheKeyPrefix: cacheKeyPrefix});
            });

            it('should stringify cacheKeyPrefix', function () {
                expect(cachedFs.cacheKeyPrefix, 'to equal', '999');
            });

            it('should populate the passed cache after reading a file', function (done) {
                cachedFs.readFile(pathToFooTxt, passError(done, function (contents) {
                    expect(contents, 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
                    expect(cache.keys(), 'to have length', 1);
                    expect(cache.get(cachedFs.getCacheKey('readFile', pathToFooTxt)), 'to equal', [null, new Buffer('bla☺bla\n', 'utf-8')]);
                    done();
                }));
            });

            it('should evict items after exceeding the max of 2 items', function () {
                cachedFs.readFileSync(pathToFooTxt);
                expect(cache.keys(), 'to have length', 1);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToFooTxt)), 'to equal', [null, new Buffer('bla☺bla\n', 'utf-8')]);

                cachedFs.readFileSync(pathToBarTxt);
                expect(cache.keys(), 'to have length', 2);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToFooTxt)), 'to equal', [null, new Buffer('bla☺bla\n', 'utf-8')]);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToBarTxt)), 'to equal', [null, new Buffer('bar\n', 'utf-8')]);

                cachedFs.readFileSync(pathToQuuxTxt);
                expect(cache.keys(), 'to have length', 2);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToFooTxt)), 'to equal', undefined);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToBarTxt)), 'to equal', [null, new Buffer('bar\n', 'utf-8')]);
                expect(cache.get(cachedFs.getCacheKey('readFile', pathToQuuxTxt)), 'to equal', [null, new Buffer('quux\n', 'utf-8')]);
            });
        });
    });

    describe('patching the built-in fs module "in-place"', function () {
        var originalReadFile = require('fs').readFile;
        require('fs').unpatch = 123;

        function getKeysForMethod(methodName) {
            return require('fs').cache.keys().filter(function (key) {
                return key.indexOf(require('fs').getCacheKey(methodName)) === 0;
            });
        }

        before(function () {
            CachedFs.patchInPlace();
            expect(require('fs').unpatch, 'to be a', Function);
        });

        it('should replace the original readFile', function () {
            var readFile = require('fs').readFile;
            expect(readFile, 'to be a', Function);
            expect(readFile, 'not to be', originalReadFile);
        });

        it('should cache consecutive readFileSync calls', function () {
            expect(getKeysForMethod('readFile'), 'to have length', 0);
            expect(getKeysForMethod('stat'), 'to have length', 0);

            var fooTxt1Buffer = require('fs').readFileSync(pathToFooTxt);
            expect(getKeysForMethod('readFile'), 'to have length', 1);

            var fooTxt2Buffer = require('fs').readFileSync(pathToFooTxt);
            expect(getKeysForMethod('readFile'), 'to have length', 1);
            expect(fooTxt1Buffer, 'to be', fooTxt2Buffer);
        });

        after(function () {
            require('fs').unpatch();
            expect(require('fs').readFile, 'to be', originalReadFile);
            expect(require('fs').unpatch, 'to equal', 123);
        });
    });
});
