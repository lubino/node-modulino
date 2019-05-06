const {contextForPath, registerContext, resolveBy, addFileListener, removeFileListener, saver: contextSaver} = require('./context');
const {createSession, destroySession, sessionStarted, onMessage} = require("./administration");
const {setListener, rootLogger, logToConsole} = require("./logger");
const {readFile, saveFile} = require('./fsWatcher');
const {addUser, saver: usersSaver} = require('./users');

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

const administrationExpressApp = (app, path = '/administrationApi', options) => {
    const listeners = [];
    const {timeout = 600000} = options;
    if (app.ws) {
        app.ws(path, (ws, req) => {
            const {query} = req;
            const session = createSession({timeout, ws, opened: true});
            const {id} = session;
            session.send = (name, data) => session.opened && ws.send(name + "\n" + JSON.stringify(data));
            const listener = data => session.authenticated && session.send("log", data);
            const fileListener = data => session.authenticated && session.send("change", data);
            listeners.push(listener);
            addFileListener(fileListener);
            if (listeners.length === 1) {
                setListener(item => setImmediate(() => listeners.map(listener => listener(item))));
            }
            ws.on('message', data => {
                if (data === 'ping') return;
                const newLine = data.indexOf("\n");
                const methodName = newLine !== -1 ? newLine > 0 ? data.substr(0, newLine) : null : newLine;
                let obj = newLine !== -1 ? data.substr(newLine + 1) : undefined;
                try {
                    obj = obj ? JSON.parse(obj) : undefined;
                } catch (e) {
                    //safe to ignore
                }
                onMessage(session, methodName, obj);
            });
            ws.on('close', () => {
                session.opened = false;
                destroySession(session);
                listeners.splice(listeners.indexOf(listener), 1);
                if (listeners.length === 0) {
                    setListener(null)
                }
                removeFileListener(fileListener);
                rootLogger.log(`administration socked '${id}' closed`);
            });
            rootLogger.log(`new administration socked ${JSON.stringify({id, query})}`);
            sessionStarted(session);
        });
    }

};

const extendExpressApp = async (app, options) => {
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
    extendedExpress.useAdministrationApi = path => {
        if (!usingAdmin) {
            administrationExpressApp(app, path, options);
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
                let onFinish;
                waiter = new Promise(resolve => onFinish = resolve);
                if (options) {
                    await saveFile(contextsJson, JSON.stringify(allOptions, null, 2))
                }
                onFinish();
                waiter = null;
            });
        }
    }
    return extendedExpress;
};

module.exports = {extendExpressApp};
