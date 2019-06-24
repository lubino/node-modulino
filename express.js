const {contextForPath, registerContext, resolveBy, saver: contextSaver} = require('./context');
const {setParameters} = require("./administration");
const {logToConsole, rootLogger} = require("./logger");
const {readFile, saveFile} = require('./fsWatcher');
const {addUser, saver: usersSaver} = require('./users');
const {} = require('./api');

const pathOf = req => req._parsedUrl.pathname;
const parsePath = req => {
    const {url} = req;
    const qIndex = url.indexOf('?');
    const endIndex = qIndex === -1 ? url.length - 1 : qIndex - 1;
    const endCharacter = url.charAt(endIndex);
    const newLength = endIndex > 0 && endCharacter === '/' ? endIndex : endIndex + 1;
    return url.length === newLength ? url : url.substr(0, newLength);
};

const keyOf = {
    POST: "onPost",
    GET: "onGet",
    PUT: "onPut",
    DELETE: "onDelete"
};

const parseUrl = url => {
    const protocolIndex = url.indexOf('://');
    const protocol = protocolIndex > 0 ? url.substr(0, protocolIndex + 1).toLowerCase() : undefined;
    const rest = protocolIndex >= 0 ? url.substr(protocolIndex+3) : url;
    const contextIndex = rest.indexOf('/');
    const host = contextIndex >= 0 ? contextIndex > 0 ? rest.substr(0, contextIndex).toLowerCase() : undefined : rest;
    const context = contextIndex >= 0 ? rest.substr(contextIndex) : '/';
    let wsUrl;
    let webUrl;
    if (host) {
        const urlWithoutProtocol = `//${host}${context}`;
        if (protocol) {
            wsUrl = `"${protocol === 'https:' ? 'wss:' : 'ws:'}${urlWithoutProtocol}"`;
            webUrl = `"${protocol}${urlWithoutProtocol}"`;
        } else {
            wsUrl = `(location.protocol === "https:" ? "wss:" : "ws:") +"${urlWithoutProtocol}"`;
            webUrl = `location.protocol + "${urlWithoutProtocol}"`;
        }
    } else {
        wsUrl = `(location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "${context}"`;
        webUrl = `location.protocol + "//" + location.host + "${context}"`;
    }
    return {wsUrl, webUrl, host, context};
};

const administrationExpressApp = (app, url = '/administrationApi', {timeout} = {}) => {
    const {wsUrl, webUrl, host, context} = parseUrl(url);
    const rootDir = `${__dirname}`;
    const options = {path: `${rootDir}/administrationApi`};
    if (host) {
        options.headers = {host};
    }
    if (context.length > 1) {
        options.url = context;
    }

    setParameters({wsUrl, webUrl, host, url: context, timeout});

    registerContext(options, {allowAdministration: true}).catch(e => rootLogger.error(`can not add administration context: ${e}`));
};

const extendExpressApp = async (app, options) => {
    const extendedExpress = {};
    let usingAdmin = false;
    extendedExpress.useAdministrationApi = url => {
        if (!usingAdmin) {
            administrationExpressApp(app, url, options);
            usingAdmin = true;
        }
        return extendedExpress;
    };
    extendedExpress.logToConsole = logToConsole;

    if (options) {
        const {administrationApi, contexts, consoleLogger, usersJson, contextsJson} = options;
        if (administrationApi != null) {
            extendedExpress.useAdministrationApi(administrationApi);
        }
        if (contexts && Array.isArray(contexts)) {
            await Promise.all(contexts.map(async options => await registerContext(options)));
        }
        if (consoleLogger != null) {
            logToConsole(consoleLogger);
        }
        if (usersJson && typeof usersJson === 'string') {
            const data = await readFile(usersJson);
            if (!data) {
                throw new Error(`Can not start app because file '${usersJson}' from property 'usersJson' can not be read`);
            }
            try {
                const users = JSON.parse(data);
                for (const user of users) {
                    addUser(user);
                }
                usersSaver(async (users, user) => {
                    if (user) {
                        await saveFile(usersJson, JSON.stringify(users, null, 2))
                    }
                });
            } catch (e) {
                throw new Error(`Can not start app because: ${e}`);
            }
        }
        if (contextsJson && typeof contextsJson === 'string') {
            const data = await readFile(contextsJson);
            if (!data) {
                throw new Error(`Can not start app because file '${contextsJson}' from property 'contextsJson' can not be read`);
            }
            const contexts = JSON.parse(data);
            await Promise.all(contexts.map(async options => await registerContext(options)));
            let waiter = null;
            contextSaver(async (allOptions, options) => {
                if (waiter) {
                    await waiter;
                }
                let onFinish = null;
                waiter = new Promise(resolve => onFinish = resolve);
                if (options) {
                    await saveFile(contextsJson, JSON.stringify(allOptions, null, 2))
                }
                if (onFinish) {
                    onFinish();
                }
                waiter = null;
            });
        }
    }

    app.use((req, res, next) => {
        const context = contextForPath(resolveBy(req));
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
                if (module && !module.isPrivate) {
                    const method = module[keyOf[req.method]] || module.onRequest;
                    if (method) {
                        req.remoteAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                        method(req, res, next);
                        return;
                    }
                } else {
                    context.logger.debug(`unknown module for ${req.method} request '${req.url}' ${JSON.stringify(req.headers)}`);
                }
            }
        } else {
            rootLogger.debug(`unknown context for ${req.method} request '${req.url}' ${JSON.stringify(req.headers)}`);
        }
        next();
    });

    return extendedExpress;
};

module.exports = {extendExpressApp};
