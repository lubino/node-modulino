const {getContexts, contextFor, registerContext} = require("./context");
const {user, getUsers, addUser, publicKeysByEmail, logUser, sshUser} = require("./users");
const {rootLogger} = require('./logger');
const {asyncRequire} = require('./installer');
const {publicDecrypt} = require('./security');

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
    sessions: (session) => ({sessions: {ids: Object.keys(sessions), myId: session.id}}),
    closeSession: (session, id) => {
        if (id) {
            session = sessions[id];
        }
        if (session && destroySession(session)) {
            return {sessionRemoved: id};
        }
    },
    pty: async (session, {start, cols, rows, resize, msg}) => {
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
        process.exit(code || 0);
    },
    AUTH: async (session, {username, email, signature, token}) => {
        const notMe = token && session.id !== token;
        if (notMe && !session.authenticated) {
            return;
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
                return notMe ? {AUTH_USR: {user, token}} : {USR: user};
            } else {
                logUser(username, email, false);
            }
        }
        session.administrationEmitter('userNotAuthenticated', {sessionId: session.id, username, email});
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

module.exports = {createSession, destroySession, sessionStarted, onMessage};
