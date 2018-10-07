const contexts = {};

const pathToId = path => {
    let result = "";
    for (const c of path) {
        if (c === '/') {
            if (result) result += '_';
        } else if (c !== '.' || result) {
            result += c;
        }
    }
    return result;
};

const contextForPath = (path) => contexts[path] || (contexts[path] = {id:pathToId(path)});

const unregisterContext = (path) => {
    const context = contexts[path];
    if (context) {
        delete contexts[path];
        return context;
    }
};

module.exports = {contextForPath, unregisterContext};