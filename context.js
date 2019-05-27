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
    return result;
};

let saveAllOptions;
const saver = save => {
    saveAllOptions = save;
    saveOptions();
};
const saveOptions = (options) => saveAllOptions && saveAllOptions([...contextsOptions], options).catch(e => rootLogger.error(`can not save context: ${e}`, e));


const newContext = (id, path, options) => {
    const emitter = new EventEmitter();
    const context = {id, path};
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
    context.on = (name, listener) => emitter.on(name, listener);
    return context;
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
const registerPath = (path, headers, url) => {
    let pathResolver;
    if (headers) {
        const entries = Object.entries(headers);
        const {length, 0: first} = entries;
        if (length === 1) {
            const [name, value] = first;
            if (url) {
                if (Array.isArray(value)) {
                    pathResolver = ({headers, originalUrl}) => originalUrl.startsWith(url) && value.includes(headers[name]);
                } else {
                    pathResolver = ({headers, originalUrl}) => originalUrl.startsWith(url) && value === headers[name];
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
                pathResolver = ({headers, originalUrl}) => originalUrl.startsWith(url) && !ignore.find(i => i(headers));
            } else {
                pathResolver = ({headers}) => !ignore.find(i => i(headers));
            }
        }
    } else if (url) {
        pathResolver = ({originalUrl}) => originalUrl.startsWith(url);
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
    const {path, headers, url = ""} = options;
    if (!path) return;
    const context = newContext(pathToId(path), path, options);
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
            registerPath(path, headers, url);
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
            if (url) {
                const {length} = url;
                staticRequest = (req, res, next) => {
                    const url = req.url.substr(length);
                    serverStatic({...req, url}, res, next);
                };
            } else {
                staticRequest = serverStatic;

            }
        }
        return staticRequest;
    };

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
    if (url) {
        const {length} = url;
        context.moduleAt = urlPath => module(urlPath.substr(length));
    } else {
        context.moduleAt = urlPath => module(urlPath);
    }
    context.register();
    return context;
};


module.exports = {contextFor, contextForPath, getContexts, registerContext, resolveBy, addFileListener, removeFileListener, saver};
