const {onRequest} = require('modulino/api');
const {
    createSession, destroySession, sessionStarted, onMessage, setListener, getParameters,
    addFileListener, removeFileListener
} = require('modulino/administration');

let administrationEmitter;
const logListeners = [];

onRequest(async (req) => {
    const {ws, query} = req;
    if (!ws) {
        throw new Error('WebSockets are not available.');
    }
    const {timeout = 60000} = getParameters();
    const session = createSession({timeout, ws, opened: true});
    let autoClose = !timeout ? null : setTimeout(() => {
        autoClose = null;
        if (!session.authenticated) {
            destroySession(session);
        }
    }, timeout);
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
    session.administrationEmitter = administrationEmitter;
    session.send = (name, data) => {
        try {
            if (session.opened) {
                ws.send(`${name}\n${JSON.stringify(data)}`);
            }
        } catch (e) {
            console.error(e);
        }
    };
    const administrationListener = (name, data) => session.authenticated && session.send("administration", {
        name,
        data
    });
    administrationEmitter.add(administrationListener);
    const logListener = data => session.authenticated && session.send("log", data);
    const fileListener = data => session.authenticated && session.send("change", data);
    logListeners.push(logListener);
    addFileListener(fileListener);
    if (logListeners.length === 1) {
        setListener(item => setImmediate(() => logListeners.map(listener => listener(item))));
    }
    ws.on('message', data => {
        if (data === 'ping') {
            return;
        }
        const newLine = data.indexOf("\n");
        const methodName = newLine !== -1 ? newLine > 0 ? data.substr(0, newLine) : null : data;
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
