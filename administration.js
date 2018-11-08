const crypto = require("crypto");
const {getContexts, contextFor, registerContext} = require("./context");
const {user, getUsers, addUser, publicKeysByEmail, logUser} = require("./users");
const {rootLogger} = require('./logger');
const {asyncRequire} = require('./installer');

let pty;

const methods = {
    users: (session) => ({usernames: getUsers()}),
    user: (session, data) => ({user: user(data)}),
    addUser: (session, data) => ({newUser: addUser(data)}),
    registerContext: async (session, options) => ({newContext: await registerContext(options)}),
    unregisterContext: (session, id) => {
        const context = contextFor(id);
        if (context && context.unregister()) {
            return {contextRemoved: id};
        }
    },
    session: (session, id) => ({session: sessions[id]}),
    sessions: (session) => ({sessions: Object.keys(sessions)}),
    closeSession: (session, id) => {
        if (id) {
            session = sessions[id];
        }
        if (session && destroySession(session)) {
            return {sessionRemoved: id};
        };
    },
    pty: async (session, {start, cols, rows, resize, msg}) => {
        if (start) {
            if (session.term) {
                session.term.kill();
                delete session.term;
            }
            if (!pty) {
                pty = await asyncRequire(rootLogger, 'node-pty');
            }
            const term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
                name: 'xterm-color',
                cols: cols || 80,
                rows: rows || 24,
                cwd: process.env.PWD,
                env: process.env
            });
            term.on('data', (data) => {
                try {
                    session.send("term", data);
                } catch (ex) {
                    // The WebSocket is not open, ignore
                }
            });
            const pid = term.pid;

            session.term = term;

            return {newTerm: {pid}}
        }
        if (session.term) {
            if (resize) {
                session.term.resize(cols, rows);
            }
            if (msg) {
                session.term.write(msg);
            }
        }
    },
    exit: (session, code) => {
        process.exit(code || 0);
    },
    AUTH: (session, {username, email, signature, token}) => {
        if (!token === session.authenticated) return;
        const publicKeys = publicKeysByEmail(username, email);
        if (publicKeys) {
            if (token) {
                session = sessions[token];
                if (!session || session.at + session.timeout < Date.now()) throw new Error('401');
            }
            const publicKey = publicKeys.find(publicKey => {
                try {
                    const decrypted = crypto.publicDecrypt(publicKey, Buffer.from(signature, 'base64')).toString();
                    return decrypted === session.id;
                } catch (e) {
                    return false;
                }
            });
            if (publicKey != null) {
                const usr = logUser(username, email, true);
                if (!usr) throw new Error('401');
                const user = {...usr, sshKeys: undefined};
                session.authenticated = true;
                if (token) {
                    session.send("USR", user);
                }
                return {USR: user};
            } else {
                logUser(username, email, false);
            }
        }
        throw new Error('401');
    },
    contexts: (session) => {
        return {contexts: getContexts()}
    },
    filesInContext: (session, ids) => {
        const filesInContext = [];
        ids.map(id => {
            const context = contextFor(id);
            if (context) {
                const {files} = context;
                filesInContext.push({id, files});
            }
        });
        return {filesInContext}
    },
    getFileContent: async (session, {contextId, filePath}) => {
        const context = contextFor(contextId);
        if (!context) return {fileContent: {}};
        try {
            const data = await context.contentOf(filePath);
            const base64 = data.toString('base64');
            return {fileContent: {contextId, filePath, base64}};
        } catch (e) {
            return {fileContent: {contextId, filePath, err: e.message}}
        }
    },
    setFileContext: async (session, {contextId, filePath, base64}) => {
        const context = contextFor(contextId);
        if (!context) return {fileNotStored: {contextId, filePath, message: "context not found"}};
        try {
            const data = base64 != null ? Buffer.from(base64, 'base64') : null;
            await context.storeContent(filePath, data);
        } catch (e) {
            return {fileNotStored: {contextId, filePath, message: e.message}}
        }

    }
};

const processMessage = async (session, method, obj) => {
    if (!session.authenticated && method !== methods.AUTH) {
        throw new Error('401');
    }
    const response = await method(session, obj);
    if (response) {
        typeof response === 'object' && Object.entries(response).map(([name, data]) =>
            session.send(name, data)
        );
    }
};

const onMessage = (session, methodName, obj) => {
    const method = methods[methodName];
    if (method) {
        processMessage(session, method, obj).catch(e => {
            rootLogger.log(`administration api error, message '${methodName}'`, e);
            session.send("ERR", e.message)
        });
    } else {
        rootLogger.log(`received unsupported message '${methodName}'`, obj);
    }
};

let count = 1;
const sessions = {};
const createSession = (atts) => {
    const id = (Math.random() * 1000000000000000000).toString(16) + (count++).toString(16);
    const at = Date.now();
    const session = {
        ...atts,
        at,
        id,
        authenticated: false
    };
    sessions[session.id] = session;
    return session;
};

const sessionStarted = session => {
    const {id: token} = session;
    session.send("AUTH", {token});
};

const destroySession = session => {
    if (session.opened) {
        session.ws.close();
    }
    if (session.term) {
        session.term.kill();
        delete session.term;
    }
    if (sessions[session.id]) {
        delete sessions[session.id];
        return true;
    }
    return false;
};

module.exports = {createSession, destroySession, sessionStarted, onMessage};