var expect = require('unexpected-sinon'),
    sinon = require('sinon'),
    Path = require('path'),
    passError = require('passerror'),
    CachedFs = require('../lib/CachedFs'),
    pathToTestFiles = Path.resolve(__dirname, 'root'),
    pathToFooTxt = Path.resolve(pathToTestFiles, 'foo.txt'),
    alternativePathToFooTxt = pathToTestFiles + Path.sep + '.' + Path.sep + 'foo.txt';

describe('CachedFs', function () {
    describe('applied to a stubbed out fs module with only a readFile function', function () {
        var stubbedFs = {
                readFile: function (fileName, encoding, cb) {
                    if (typeof encoding === 'function') {
                        cb = encoding;
                        encoding = null;
                    }
                    process.nextTick(function () {
                        cb(null, 'the contents of ' + fileName + ' in encoding ' + encoding);
                    });
                }
            },
            memoizedFs;

        sinon.spy(stubbedFs, 'readFile');

        beforeEach(function () {
            memoizedFs = new CachedFs(stubbedFs);
        });

        it('should produce an object with a readFile and readFileSync property', function () {
            expect(memoizedFs, 'to have keys', ['readFile', 'readFileSync']);
        });

        it('should only call the stubbed-out readFile once', function (done) {
            memoizedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                memoizedFs.readFile(pathToFooTxt, passError(done, function (secondContents) {
                    expect(stubbedFs.readFile, 'was called once');
                    done();
                }));
            }));
        });

        it('should make readFileSync work if readFile has previously been called with the same arguments', function (done) {
            memoizedFs.readFile(pathToFooTxt, passError(done, function (contents) {
                var syncReadContents = memoizedFs.readFileSync(pathToFooTxt);
                expect(syncReadContents, 'to be', contents);
                done();
            }));
        });

        it('should make createReadStream work', function (done) {
            var chunks = [];
            memoizedFs.createReadStream(pathToFooTxt)
               .on('data', function (chunk) {
                   chunks.push(chunk);
               })
               .on('end', function () {
                   expect(chunks, 'to have length', 1);
                   expect(chunks[0].toString('utf-8'), 'to equal', 'the contents of ' + pathToFooTxt + ' in encoding null');
                   done();
               });
        });
    });

    describe('applied to the built-in fs module', function () {
        var memoizedFs;
        beforeEach(function () {
            memoizedFs = new CachedFs(require('fs'));
        });

        it('should be able to readFile foo.txt', function (done) {
            memoizedFs.readFile(pathToFooTxt, passError(done, function (contents) {
                expect(contents, 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
                done();
            }));
        });

        it('should be able to readFileSync foo.txt', function () {
            expect(memoizedFs.readFileSync(pathToFooTxt), 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
        });

        it('should be able to readFile foo.txt as utf-8', function (done) {
            memoizedFs.readFile(pathToFooTxt, 'utf-8', passError(done, function (contents) {
                expect(contents, 'to equal', 'bla☺bla\n');
                done();
            }));
        });

        it('should be able to readFile foo.txt as utf-8 then as a Buffer', function (done) {
            memoizedFs.readFile(pathToFooTxt, 'utf-8', passError(done, function (contents) {
                expect(contents, 'to equal', 'bla☺bla\n');
                memoizedFs.readFile(pathToFooTxt, passError(done, function (contentsAsBuffer) {
                    expect(contentsAsBuffer, 'to equal', new Buffer('bla☺bla\n', 'utf-8'));
                    done();
                }));
            }));
        });

        // This is debatable, maybe they should get different Buffer instances?
        it('should return the same Buffer instance when the readFile function is called repeatedly', function (done) {
            memoizedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                expect(firstContents, 'to be', firstContents);
                memoizedFs.readFile(pathToFooTxt, passError(done, function (secondContents) {
                    expect(secondContents, 'to be', firstContents);
                    done();
                }));
            }));
        });

        it('should return the same buffer instance when the readFile function is called more than once with different representations of the path to foo.txt', function (done) {
            memoizedFs.readFile(pathToFooTxt, passError(done, function (firstContents) {
                memoizedFs.readFile(alternativePathToFooTxt, passError(done, function (secondContents) {
                    expect(secondContents, 'to be', firstContents);
                    done();
                }));
            }));
        });

        // This is debatable, maybe they should get different array instances?
        it('should return the same array when readdir is called with and without a trailing slash', function (done) {
            memoizedFs.readdir(pathToTestFiles, passError(done, function (firstEntries) {
                memoizedFs.readdir(pathToTestFiles + Path.sep, passError(done, function (secondEntries) {
                    expect(secondEntries, 'to be', firstEntries);
                    done();
                }));
            }));
        });

        it('should return the same chunks when createReadStream is called twice with the same arguments', function (done) {
            var readStreams = [
                memoizedFs.createReadStream(pathToFooTxt),
                memoizedFs.createReadStream(pathToFooTxt)
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
});
