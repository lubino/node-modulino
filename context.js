const EventEmitter = require('events');

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

const newContext = (atts) => {
    const emitter = new EventEmitter();
    const {id} = atts;
    const context = {id, ...atts};
    context.register = () => {
        emitter.emit('register');
        const old = contexts[context.path];
        if (old) old.unregister();
        contexts[context.path] = context;
    };
    context.unregister = () => {
        emitter.emit('unregister');
        if (contexts[context.path] === context) delete contexts[context.path];
    };
    context.on = (name, listener) => emitter.on(name, listener);
    return context;
};

const contextFor = contextId => Object.values(contexts).find(({id})=> id === contextId);

const contextForPath = (path, createNew) => createNew ? newContext({id:pathToId(path), path}) : contexts[path];

const getContexts = () => Object.values(contexts).map(({id})=> ({id}));

module.exports = {contextFor, contextForPath, getContexts};