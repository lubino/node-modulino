const {validate} = require('./eslint');
const runJS = (require, window, console, Error, validate, js) => eval(js);


module.exports.runJS = (filePath, api, js) => {
    const {require, window, console, Error} = api;
    try {
        const errors = validate(console, js, filePath);
        runJS(require, window, console, Error, undefined, js);
        return errors;
    } catch (e) {
        throw console.transformException(e);
    }
};