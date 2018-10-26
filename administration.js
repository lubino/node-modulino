const crypto = require("crypto");
const {getContexts, contextFor} = require("./context");
const {publicKeysByEmail, logUser} = require("./users");
const {rootLogger} = require('./logger');

const methods = {
    AUTH: (session, {username, email, signature, token}) => {
        if (!token === session.authenticated) return;
        const publicKeys = publicKeysByEmail(username, email);
        if (publicKeys) {
            const publicKey = publicKeys.find(publicKey => {
                try {
                    const decrypted = crypto.publicDecrypt(publicKey, Buffer.from(signature, 'base64')).toString();
                    return decrypted === session.id;
                } catch (e) {
                    return false;
                }
            });
            if (publicKey != null) {
                const user = logUser(username, email, true);
                if (!user) throw new Error('401');
                session.authenticated = true;
                return {USR: {user}};
            } else {
                logUser(username, email, false);
            }
        }
        throw new Error('401');
    },
    getContexts: (session) => {
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
        rootLogger.log(`Unknown message '${methodName}'`);
    }
};

let count = 1;
const createSession = () => {
    const id = (Math.random() * 1000000000000000000).toString(16) + (count++).toString(16);
    return {
        id,
        authenticated: false
    }
};

const sessionStarted = session => {
    session.send("AUTH", {token: session.id});
};

module.exports = {createSession, sessionStarted, onMessage};