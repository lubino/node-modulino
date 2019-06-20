const {getContexts, modifyContext, contextFor, registerContext, addFileListener, removeFileListener} = require("./context");
const {user, getUsers, addUser, publicKeysByEmail, logUser, sshUser} = require("./users");
const {rootLogger, setListener} = require('./logger');
const {asyncRequire} = require('./installer');
const {publicDecrypt} = require('./security');

let pty;

const methods = {
    users: (session) => {
        /** Returns array of user's username. */
        return {usernames: getUsers()};
    },
    user: (session, {username, email}) => {
        /** Returns and array of user's username. */
        return {user: user(username, email)}
    },
    addUser: (session, user) => {
        /** Creates new User. */
        return {newUser: addUser(user)};
    },
    registerContext: async (session, options) => {
        /** Creates new context. */
        return {newContext: await registerContext(options)};
    },
    unregisterContext: (session, id) => {
        /** Removes existing context. */
        const context = contextFor(id);
        if (context && context.unregister()) {
            return {contextRemoved: id};
        }
    },
    session: (session, id) => {
        /** Returns information about active session. */
        return {session: sessions[id]};
    },
    sessions: (session) => {
        /** Returns ids of active sessions and id of actual session. */
        const ids = Object.keys(sessions);
        const myId = session.id;
        return {sessions: {ids, myId}};
    },
    closeSession: (session, id) => {
        /** Close active session specified by session's id. */
        if (id) {
            session = sessions[id];
        }
        if (session && destroySession(session)) {
            return {sessionRemoved: id};
        }
    },
    pty: async (session, {start, cols, rows, resize, msg}) => {
        /** Sends message to terminal. */
        if (start) {
            if (session.term) {
                session.administrationEmitter('terminalClosed', {pid: session.term.pid});
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
            const {pid} = term;

            session.term = term;
            session.administrationEmitter('terminalStarted', {pid});

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
    exit: (session, {code} = {}) => {
        /** Kills the server. */
        process.exit(code || 0);
    },
    AUTH: async (session, {username, email, signature, token}) => {
        /** Authenticates user's session. */
        const notMe = token && session.id !== token;
        if (notMe && !session.authenticated) {
            throw new Error('401');
        }
        const publicKeys = await publicKeysByEmail(username, email);
        if (publicKeys) {
            let sessionToAuth = notMe ? sessions[token] : session;
            if (!sessionToAuth || sessionToAuth.at + sessionToAuth.timeout < Date.now()) throw new Error('401');
            const publicKey = publicKeys.find(publicKey => checkSignature(publicKey, signature, sessionToAuth.id));
            if (publicKey != null) {
                const usr = logUser(username, email, true) || sshUser(username, email);
                if (!usr) throw new Error('401');
                const user = {...usr, sshKeys: undefined};
                sessionToAuth.authenticated = true;
                if (notMe) {
                    sessionToAuth.send("USR", user);
                }
                session.administrationEmitter('userAuthenticated', {sessionId: session.id, name: user.name});
                if (notMe) {
                    return {AUTH_USR: {user, token}};
                }
                return {USR: user};
            } else {
                logUser(username, email, false);
            }
        }
        session.administrationEmitter('userNotAuthenticated', {sessionId: session.id, username, email});
        throw new Error('401');
    },
    context: (session, {id, options} = {}) => {
        /** Optionally modifies context's options and returns options for context specified by context's id. */
        const context = modifyContext(id, options);
        return {context};
    },
    contexts: () => {
        /** Returns ids of all available contexts. */
        const contexts = getContexts();
        return {contexts}
    },
    filesInContext: (session, ids) => {
        /** Returns content of file using base64 format. */
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
        /** Returns content of file using base64 format. */
        const context = contextFor(contextId);
        if (!context) {
            const fileContent = {contextId, filePath, err: `context '${contextId}' not found`};
            return {fileContent};
        }
        try {
            const data = await context.contentOf(filePath);
            const base64 = data.toString('base64');
            const fileContent = {contextId, filePath, base64};
            return {fileContent};
        } catch (e) {
            const fileContent = {contextId, filePath, err: e.message};
            return {fileContent}
        }
    },
    setFileContext: async (session, {contextId, filePath, base64}) => {
        /** Updates content of file using base64 format. */
        const context = contextFor(contextId);
        if (!context) {
            const fileNotStored = {contextId, filePath, message: "context not found"};
            return {fileNotStored};
        }
        try {
            const data = base64 != null ? Buffer.from(base64, 'base64') : null;
            await context.storeContent(filePath, data);
        } catch (e) {
            const fileNotStored = {contextId, filePath, message: e.message};
            return {fileNotStored}
        }

    },
    help: () => {
        /** Prints this information. */
        const message = 'Available methods:\n'+Object.entries(methods).map(([name, f]) => {
            const s = f.toString();
            const a = s.indexOf('=>');
            const b = s.indexOf('session')+8;
            const e = s.lastIndexOf(')', a);
            const cs = s.indexOf('/*')+2;
            const ce = s.indexOf('*/', cs);
            const c = cs < ce ? s.substring(cs, ce).split('\n') : [];
            let result = '';
            const rs = s.lastIndexOf('return {')+8;
            if (rs > a) {
                const e1 = s.indexOf(':', rs);
                const e2 = s.indexOf('}', rs);
                const e = e1 >0 && e1 < e2 ? e1 : e2;
                if (e > rs) {
                    const key = s.substring(rs, e);
                    if (!key.includes('\n')) {
                        result = ` => ${key}`;
                    }
                }
            }
            const info = c.length ? '\n   '+c.map(i => {
                const s = i.trim();
                return s.startsWith('*') ? s.substr(1).trim() : s;
            }).filter(i => i).join('\n   ')+'\n' : '';

            const data = (b < a) && (b < e) ? s.substring(b, e).trim() : '';
            return ` - ('${name}'${data ? ', ' : ''}${data})${result}${info}`;
        }).join('\n');
        const log = {message};
        return {log};
    }
};

const checkSignature = (publicKey, signature, correctValue) => {
    try {
        const decrypted = publicDecrypt(publicKey, signature);
        return decrypted === correctValue;
    } catch (e) {
        return false;
    }
};

const processMessage = async (session, method, obj) => {
    if (!session.authenticated && method !== methods.AUTH) {
        throw new Error('401');
    }
    const response = await method(session, obj);
    if (response && typeof response === 'object') {
         Object.entries(response).map(([name, data]) =>
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

const sessionStarted = (session, query) => {
    const {id: token} = session;
    session.send("AUTH", {token});
    session.administrationEmitter('sessionStarted', {id: session.id, query});
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
        session.administrationEmitter('sessionClosed', {id: session.id});
        return true;
    }
    return false;
};

const rootDir = `${__dirname}`;
const readFile = (file) => new Promise((resolve, reject) => {
    const fs = require('fs');
    fs.readFile(`${rootDir}/${file}`, (err, data) => err ? reject(err) : resolve(data));
});

let _parameters;
const setParameters = parameters => _parameters = parameters;
const getParameters = () => _parameters;

module.exports = {
    createSession, destroySession, sessionStarted, onMessage, readFile, setParameters, getParameters, setListener,
    addFileListener, removeFileListener,
};
