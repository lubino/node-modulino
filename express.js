const {contextForPath, registerContext, resolveBy, addFileListener, removeFileListener, saver: contextSaver} = require('./context');
const {createSession, destroySession, sessionStarted, onMessage} = require("./administration");
const {setListener, logToConsole, rootLogger} = require("./logger");
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

let administrationEmitter;
const administrationExpressApp = (app, path = '/administrationApi', options) => {
    const logListeners = [];
    const {timeout = 60000} = options;
    if (app.ws) {
        if (!administrationEmitter) {
            const listeners = [];
            administrationEmitter = (name, data) => {
                for (const listener of listeners) {
                    listener(name, data);
                }
            };
            administrationEmitter.add = listener => listeners.push(listener);
            administrationEmitter.remove = listener => listeners.splice(listeners.indexOf(listener), 1).length === 1;
        }
        let manageSrc;
        app.get(path, (req, res) => {
            if (!manageSrc) {
                const fs = require('fs');
                manageSrc = fs.readFileSync(`${__dirname}/static/administration.html`).toString();
                const xtermJS = fs.readFileSync(`${__dirname}/static/xterm.min.js`).toString();
                const fitJS = fs.readFileSync(`${__dirname}/static/fit.min.js`).toString();
                const xtermCSS = fs.readFileSync(`${__dirname}/static/xterm.min.css`).toString();
                const administrationJs = fs.readFileSync(`${__dirname}/static/main.js`).toString();
                const qrcodeJs = fs.readFileSync(`${__dirname}/static/qrcode.min.js`).toString();
                const cryptoJs = fs.readFileSync(`${__dirname}/static/crypto.min.js`).toString();
                const clientJs = fs.readFileSync(`${__dirname}/client.js`).toString();
                const js = xtermJS + fitJS + administrationJs.replace('client.js();', clientJs)
                    .replace('qrcode.js();', qrcodeJs)
                    .replace('crypto.js();', cryptoJs);

                const s = manageSrc.indexOf('</style>');
                const i = manageSrc.indexOf('</body');
                manageSrc = manageSrc.substr(0, s) + xtermCSS + manageSrc.substr(s, i) + `<script>${js}</script>` + manageSrc.substr(i);
            }
            res.type("html");
            res.send(manageSrc);
        });
        app.ws(path, (ws, req) => {
            const {query} = req;
            const session = createSession({timeout, ws, opened: true});
            let autoClose = !timeout ? null : setTimeout(() => {
                autoClose = null;
                if (!session.authenticated) {
                    destroySession(session);
                }
            }, timeout);
            session.administrationEmitter = administrationEmitter;
            session.send = (name, data) => {
                try {
                    session.opened && ws.send(name + "\n" + JSON.stringify(data));
                } catch (e) {
                    rootLogger.error(e);
                }
            };
            const administrationListener = (name, data) => session.authenticated && session.send("administration", {name, data});
            administrationEmitter.add(administrationListener);
            const logListener = data => session.authenticated && session.send("log", data);
            const fileListener = data => session.authenticated && session.send("change", data);
            logListeners.push(logListener);
            addFileListener(fileListener);
            if (logListeners.length === 1) {
                setListener(item => setImmediate(() => logListeners.map(listener => listener(item))));
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
                clearTimeout(autoClose);
                administrationEmitter.remove(administrationListener);
                session.opened = false;
                destroySession(session);
                logListeners.splice(logListeners.indexOf(logListener), 1);
                if (logListeners.length === 0) {
                    setListener(null)
                }
                removeFileListener(fileListener);
            });
            sessionStarted(session, query);
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
