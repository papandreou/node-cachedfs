// Log the arguments whenever a method is called. If it takes a callback, log when that is called too.

function squeal(obj, methodName) {
    var orig = obj[methodName];
    obj[methodName] = function () { // ...
        var args = Array.prototype.slice.call(arguments);
        console.log(methodName, 'called with args', args);
        var lastArg = args[args.length - 1];
        if (typeof lastArg === 'function') {
            args[args.length - 1] = function () {
                console.log('cb for', methodName, 'called with args', arguments);
                return lastArg.apply(this, arguments);
            };
        }
        var returnValue = orig.apply(this, args);
        if (typeof returnValue !== 'undefined') {
            console.log('  =>', returnValue);
        }
        return returnValue;
    };
}

module.exports = squeal;
