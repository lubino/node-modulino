const EventEmitter = require('events');
const {featuresForContext} = require('./features');
const {modulesForContext} = require('./module');
const {watchDirAt, filePathReader, filePathWriter} = require('./fsWatcher');
const {createLogger, rootLogger} = require("./logger");
const {createModule} = require("./moduleFactory");

const contexts = {};
const contextsOptions = [];

const pathToId = path => {
    let result = "";
    for (const c of path) {
        if (c === '/') {
            if (result) result += '_';
        } else if (c !== '.' || result) {
            result += c;
        }
    }
    return result || '_';
};

let saveAllOptions;
const saver = save => {
    saveAllOptions = save;
    saveOptions();
};
const saveOptions = (options) => saveAllOptions && saveAllOptions([...contextsOptions], options).catch(e => rootLogger.error(`can not save context: ${e}`, e));


const newContext = (options) => {
    const emitter = new EventEmitter();
    const {path, session = {}, email = {}} = options;
    const id = pathToId(path);
    const context = {id, path, session, email};
    context.register = () => {
        const old = contexts[context.path];
        if (old) {
            old.unregister();
        }
        rootLogger.info(`creating context '${id}' at '${path}'`);
        contextsOptions.push(options);
        saveOptions(options);
        emitter.emit('register', options);
        contexts[context.path] = context;
    };
    context.unregister = () => {
        if (contexts[context.path] === context) {
            rootLogger.info(`removing context '${id}' at '${path}'`);
            emitter.emit('unregister');
            const i = contextsOptions.indexOf(options);
            if (i >= 0) {
                contextsOptions.splice(i, 1);
                saveOptions(options);
            }
            delete contexts[context.path];
            return true;
        }
        return false
    };
    context.getOptions = () => options;
    context.on = (name, listener) => emitter.on(name, listener);
    context.emit = (name, data) => emitter.emit(name, data);
    return context;
};

const contextParams = "session,email".split(',');
const optionsParams = [...contextParams, ..."headers,url".split(',')];
const modifyContext = (contextId, options = {}) => {
    const context = Object.values(contexts).find(({id})=> id === contextId);
    if (!context) {
        return {contextId};
    }
    const actualOptions = context.getOptions();
    const oldValues = {};
    const changedFields = optionsParams.filter(field => {
        const opt = options[field];
        if (opt !== undefined) {
            const value = actualOptions[field];
            if (opt !== value) {
                oldValues[field] = value;
                if (opt == null) {
                    delete actualOptions[field];
                } else {
                    actualOptions[field] = opt;
                }
                if (contextParams.includes(field)) {
                    context[field] = opt == null ? {} : opt;
                }
                return true;
            }
        }
        return false;
    });
    if (changedFields.includes('headers') || changedFields.includes('url')) {
        unregisterPath(actualOptions.path);
        registerPath(actualOptions);
    }
    if (changedFields.length) {
        saveOptions(actualOptions);
        context.emit('modify', changedFields);
    }
    return {contextId, options: actualOptions};
};

const contextFor = contextId => Object.values(contexts).find(({id})=> id === contextId);

const contextForPath = (path) => contexts[path];

const getContexts = () => Object.values(contexts).map(({id})=> ({id}));

const toRemove = ["index.html", "index.htm"];
const pageTypes = Object.entries({
    ".ejs": "ejs",
    ".pug": "pug",
});

function getFileType(file) {
    let isJsModule = false;
    let pageType = null;
    let path = file;
    const paths = [];
    if (path.endsWith('mod.js')) {
        const lastModuleCharIndex = path.length - 7;
        const lastChar = path.charAt(lastModuleCharIndex);
        const rootModule = lastChar === '/';
        if (rootModule || lastChar === '.') {
            isJsModule = true;
            path = path.substr(0, rootModule ? lastModuleCharIndex + 1 : lastModuleCharIndex)
        }
    } else {
        const [ext, name] = pageTypes.find(([ext]) => path.endsWith(ext)) || [];
        if (name) {
            const withoutExtension = path.substr(0, path.length - ext.length);
            paths.push(withoutExtension);
            pageType = name;
            path = `${withoutExtension}.html`
        } else if (path.endsWith('.html')) {
            pageType = 'html';
            const withoutExtension = path.substr(0, path.length - 5);
            paths.push(withoutExtension);
        }
    }
    paths.push(path);

    toRemove.map(end => path.endsWith(end) && paths.push(path.substr(0, path.length - end.length)));
    return {paths, isJsModule, pageType};
}

let defaultPath;
let resolvers;
const addPathResolver = (path, resolve) => {
    if (!resolvers) resolvers = [];
    resolve.path = path;
    resolvers.push(resolve);
};

const resolveBy = req => {
    if (!resolvers) return defaultPath;
    const item = resolvers.find(resolve => resolve(req));
    return item ? item.path : defaultPath;
};

function remove(module) {
    const onUnLoad = module && module.onUnLoad;
    try {
        onUnLoad && onUnLoad();
    } catch (e) {
    }
}

const unregisterPath = (path) => {
    if (resolvers) {
        let {length} = resolvers;
        while (length-- > 0) if (resolvers[length].path === path) resolvers.splice(length, 1);
        if (resolvers.length === 0) resolvers = null;
    }

};
const urlStartsWith = (fullUrl, url) => fullUrl.startsWith(url+'/');
const registerPath = ({path, headers, url = ""}) => {
    let pathResolver;
    if (headers) {
        const entries = Object.entries(headers);
        const {length, 0: first} = entries;
        if (length === 1) {
            const [name, value] = first;
            if (url) {
                if (Array.isArray(value)) {
                    pathResolver = ({headers, originalUrl}) => urlStartsWith(originalUrl, url) && value.includes(headers[name]);
                } else {
                    pathResolver = ({headers, originalUrl}) => urlStartsWith(originalUrl, url) && value === headers[name];
                }
            } else {
                if (Array.isArray(value)) {
                    pathResolver = ({headers}) => value.includes(headers[name]);
                } else {
                    pathResolver = ({headers}) => value === headers[name];
                }
            }
        } else {
            const ignore = entries.map(([name, value]) => {
                if (Array.isArray(value)) {
                    return headers => !value.includes(headers[name]);
                }
                return headers => headers[name] !== value;
            });
            if (url) {
                pathResolver = ({headers, originalUrl}) => urlStartsWith(originalUrl, url) && !ignore.find(i => i(headers));
            } else {
                pathResolver = ({headers}) => !ignore.find(i => i(headers));
            }
        }
    } else if (url) {
        pathResolver = ({originalUrl}) => urlStartsWith(originalUrl, url);
    } else {
        defaultPath = path;
    }
    if (pathResolver) {
        addPathResolver(path, pathResolver);
    }
};

const fileListeners = [];
const addFileListener = listener => fileListeners.push(listener);
const removeFileListener = listener => fileListeners.splice(fileListeners.indexOf(listener), 1);

let serveStatic;
const getServerStatic = () => {
    if (!serveStatic) serveStatic = require('serve-static');
    return serveStatic;
};

const registerContext = async options => {
    if (!options) return;
    const {path} = options;
    if (!path) return;
    const context = newContext(options);
    const {id} = context;
    context.createLogger = filePath => createLogger(id, filePath);
    context.logger = createLogger(id, '');
    context.on('unregister', () => {
        if (!context.unregistered) {
            unregisterPath(path);
            context.files['/']();
            context.unregistered = true;
        }
    });
    context.on('register', () => {
        if (!context.registered) {
            registerPath(options);
            context.registered = true;
        }
    });
    context.contentOf = filePathReader(path);
    context.storeContent = filePathWriter(path);
    const {featuresFor} = featuresForContext(context);
    const {module, removeModule} = modulesForContext(context);


    let staticRequest;
    const getStaticRequest = () => {
        if (!staticRequest) {
            const serverStatic = getServerStatic()(path);
            staticRequest = (req, res, next) => {
                const length = options.url ? options.url.length : 0;
                if (length) {
                    const url = req.url.substr(length);
                    serverStatic({...req, url}, res, next);
                } else {
                    serverStatic(req, res, next);
                }
            };
        }
        return staticRequest;
    };

    context.on('modify', (changedFields) => {
        if (changedFields.includes('url')) {
            createContextModuleFinder(context, module, options);
        }
    });


    context.files = await watchDirAt(path, data => {
        const {newFiles, removedFiles} = data;
        removedFiles.map(filePath => {
            const {paths} = getFileType(filePath);
            paths.map(urlPath => remove(removeModule(urlPath)))
        });
        newFiles.map(filePath => {
            const fileType = getFileType(filePath);
            const {paths} = fileType;
            const registerModule = result => paths.map(urlPath => module(urlPath, result));
            createModule(context, getStaticRequest, filePath, featuresFor, fileType, registerModule);
        });
        if (fileListeners.length) fileListeners.map(listener => listener({id, newFiles, removedFiles}));
    });
    createContextModuleFinder(context, module, options);
    context.register();
    return context;
};

const createContextModuleFinder = (context, module, options) => {
    const {url} = options;
    if (url) {
        const {length} = url;
        context.moduleAt = urlPath => module(urlPath.substr(length));
    } else {
        context.moduleAt = urlPath => module(urlPath);
    }
};

module.exports = {newContext, modifyContext, contextFor, contextForPath, getContexts, registerContext, resolveBy, addFileListener, removeFileListener, saver};
