const eval = require('eval');
const {validate} = require('./eslint');
const runJS = (filename, require, window, console, Error, validate, js) => eval(js, filename, {require, window, console, Error, validate, setTimeout, setInterval, setImmediate, clearTimeout, clearInterval});


module.exports.runJS = (context, filePath, api, js) => {
    const {require, window, console, Error} = api;
    try {
        const errors = validate(context, console, js, filePath);
        runJS(context.id+filePath, require, window, console, Error, undefined, js);
        return errors;
    } catch (e) {
        throw console.transformException(e);
    }
};
