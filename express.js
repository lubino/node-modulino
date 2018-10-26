const {featuresForContext} = require('./features');
const {modulesForContext} = require('./module');
const {contextForPath} = require('./context');
const {watchDirAt, filePathReader, filePathWriter} = require('./fsWatcher');
const {createLogger} = require("./logger");
const {createModule} = require("./moduleFactory");
const {createSession, sessionStarted, onMessage} = require("./administration");
const {setListener, rootLogger, logToConsole} = require("./logger");

let serveStatic;
const getServerStatis = () => {
    if (!serveStatic) serveStatic = require('serve-static');
    return serveStatic;
};

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
        //paths.push(path);
        const lastModuleCharIndex = path.length - 7;
        const lastChar = path.charAt(lastModuleCharIndex);
        if (lastChar === '.' || lastChar === '/') {
            isJsModule = true;
            path = path.substr(0, lastModuleCharIndex)
        }
    } else {
        const [ext, name] = pageTypes.find(([ext]) => path.endsWith(ext)) || [];
        if (name) {
            pageType = name;
            path = path.substr(0, path.length - ext.length) + ".html"
        }
    }
    paths.push(path);

    toRemove.map(end => path.endsWith(end) && paths.push(path.substr(0, path.length - end.length)));
    return {paths, isJsModule, pageType};
}

const pathOf = req => req._parsedUrl.pathname;
const parsePath = req => {
    const {url} = req;
    const qIndex = url.indexOf('?');
    const endIndex = qIndex === -1 ? url.length - 1 : qIndex - 1;
    const endCharacter = url.charAt(endIndex);
    const newLength = endIndex > 0 && endCharacter === '/' ? endIndex : endIndex + 1;
    return url.length === newLength ? url : url.substr(0, newLength);
};

function remove(module) {
    const onUnLoad = module && module.onUnLoad;
    try {
        onUnLoad && onUnLoad();
    } catch (e) {
    }
}

const registerContext = async options => {
    if (!options) return;
    const {path: dirPath = './web'} = options;
    const context = contextForPath(dirPath, true);
    const {id} = context;
    context.createLogger = filePath => createLogger(id, filePath);
    context.on('unregister', () => {
        if (!context.unregistered) {
            unregisterPath(dirPath);
            context.files['/']();
            context.unregistered = true;
        }
    });
    context.on('register', () => {
        if (!context.registered) {
            registerPath(dirPath, options);
            context.registered = true;
        }
    });
    context.contentOf = filePathReader(dirPath);
    context.storeContent = filePathWriter(dirPath);
    const {featuresFor} = featuresForContext(context);
    const {module, removeModule} = modulesForContext(context);


    let staticRequest;
    const getStaticRequest = () => staticRequest || (staticRequest = getServerStatis()(dirPath));

    context.files = await watchDirAt(dirPath, data => {
        const {newFiles, removedFiles} = data;
        removedFiles.map(filePath => {
            const {paths} = getFileType(filePath);
            paths.map(path => remove(removeModule(path)))
        });
        newFiles.map(filePath => {
            const fileType = getFileType(filePath);
            const {paths} = fileType;
            const registerModule = result => paths.map(path => module(path, result));
            createModule(context, getStaticRequest, filePath, featuresFor, fileType, registerModule);
        });
        if (fileListeners.length) fileListeners.map(listener => listener({id, newFiles, removedFiles}));
    });
    context.moduleAt = path => module(path);
    context.register();
    return context;
};

let defaultPath;
let resolvers;
const addPathResolver = (path, resolve) => {
    if (!resolvers) resolvers = [];
    resolve.path = path;
    resolvers.push(resolve);
};
const unregisterPath = (path) => {
    if (resolvers) {
        let {length} = resolvers;
        while (length-- > 0) if (resolvers[length].path === path) resolvers.splice(length, 1);
        if (resolvers.length === 0) resolvers = null;
    }

};
const registerPath = (path, options) => {
    const {headers} = options;
    let headerResolver;
    if (headers) {
        const entries = Object.entries(headers);
        const {length, 0: first} = entries;
        if (length === 1) {
            const [name, value] = first;
            if (Array.isArray(value)) {
                headerResolver = ({headers}) => value.includes(headers[name]);
            } else {
                headerResolver = ({headers}) => value === headers[name];
            }
        } else {
            const ignore = entries.map(([name, value]) => {
                if (Array.isArray(value)) {
                    return headers => !value.includes(headers[name]);
                }
                return headers => headers[name] !== value;
            });
            headerResolver = ({headers}) => !ignore.find(i => i(headers));
        }
    } else {
        defaultPath = path;
    }
    if (headerResolver) {
        addPathResolver(path, headerResolver);
    }
};

const resolveBy = req => {
    const item = resolvers.find(resolve => resolve(req));
    return item ? item.path : defaultPath;
};

const keyOf = {
    POST: "onPost",
    GET: "onGet",
    PUT: "onPut",
    DELETE: "onDelete"
};

const extendExpressApp = async (app, options) => {

    app.use((req, res, next) => {
        const context = contextForPath(resolvers ? resolveBy(req) : defaultPath);
        if (context) {
            const {moduleAt} = context;
            if (moduleAt) {
                let pathname;
                try {
                    pathname = pathOf(req);
                } catch (e) {
                    pathname = parsePath(req);
                }
                const module = moduleAt(pathname);
                if (module) {
                    const method = module[keyOf[req.method]] || module.onRequest;
                    if (method) {
                        method(req, res, next);
                        return;
                    }
                }
            }
        }
        next();
    });


    const extendedExpress = {};
    let usingAdmin = false;
    extendedExpress.useAdministrationApi = (path) => {
        if (!usingAdmin) {
            administrationExpressApp(app, path);
            usingAdmin = true;
        }
        return extendedExpress;
    };
    extendedExpress.logToConsole = logToConsole;

    if (options) {
        const {administrationApi, contexts, consoleLogger} = options;
        extendedExpress.useAdministrationApi(administrationApi);
        if (contexts && Array.isArray(contexts)) {
            await Promise.all(contexts.map(async options => await registerContext(options)));
        }
        if (consoleLogger != null) {
            logToConsole(consoleLogger);
        }
    }
    return extendedExpress;
};

const fileListeners = [];
const administrationExpressApp = (app, path = '/administrationApi') => {
    const listeners = [];
    app.ws && app.ws(path, (ws, req) => {
        const session = createSession();
        const {id} = session;
        session.send = (name, data) => ws.send(name + "\n" + JSON.stringify(data));
        const listener = data => session.authenticated && session.send("log", data);
        const fileListener = data => session.authenticated && session.send("change", data);
        listeners.push(listener);
        fileListeners.push(fileListener);
        if (listeners.length === 1) {
            setListener(item => setImmediate(() => listeners.map(listener => listener(item))));
        }
        ws.on('message', data => {
            if (data === 'ping') return;
            const newLine = data.indexOf("\n");
            const methodName = newLine !== -1 ? newLine > 0 ? data.substr(0, newLine) : null : newLine;
            let obj = data.substr(newLine + 1);
            try {
                obj = methodName ? JSON.parse(obj) : null;
            } catch (e) {
                //safe to ignore
            }
            onMessage(session, methodName, obj);
        });
        ws.on('close', ()=>{
            listeners.splice(listeners.indexOf(listener), 1);
            if (listeners.length === 0) {
                setListener(null)
            }
            fileListeners.splice(listeners.indexOf(fileListener), 1);
            rootLogger.log(`administration socked '${id}' closed`);
        });
        rootLogger.log(`new administration socked '${id}'`);
        sessionStarted(session);
    });

};

module.exports = {extendExpressApp, administrationExpressApp, registerContext};
