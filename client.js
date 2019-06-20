const {getSshKeyPath, userInfo, privateEncrypt, getPrivateKey, getPublicKey} = require("./security");
const {getFS, watchDirAt, readFile} = require('./fsWatcher');
const {EventEmitter} = require('./EventEmitter');
const {createWebSocket} = require('./ws');

const createMethods = session => ({
    ERR: err => {
        console.log("error received", err);
        if (err === "401") {
            session.close();
        }
    },
    administration: item => {
        session.emit(item.name, item.data);
    },
    log: item => {
        console.log(item.message);
        if (session.logTargets && item.stack) {
            console.log(item.stack);
        }
    },
    change: async data => {
        const {id, newFiles, removedFiles} = data;
        const {ignoredFilesByWatcher} = session;
        for (const filePath of newFiles) {
            const path = id + filePath;
            if (ignoredFilesByWatcher) {
                ignoredFilesByWatcher[path] = true;
            }
            await session.downloadFile(id, filePath);
        }
        for (const filePath of removedFiles) {
            const path = id + filePath;
            if (ignoredFilesByWatcher) {
                ignoredFilesByWatcher[path] = true;
            }
            await rmFile(path);
        }
    },
    USR: (user) => {
        console.log(`user '${user.name}' authenticated`);
    },
    newContext: ({id, files}) => {
        console.log(`context '${id}' created, contains: ${Object.keys(files).join(', ')}`);
    },
    context: ({contextId, options}) => {
        if (options) {
            console.log(`context '${contextId}' has options: ${JSON.stringify(options)}`);
        } else {
            console.log(`context '${contextId}' not found`);
        }
    },
    fileNotStored: async ({contextId, filePath, message}) => {
        console.log(`error storing file on server '${contextId}${filePath}': ${message}`)
    },
});

function same(a, b) {
    const ta = typeof a;
    const tb = typeof b;
    if (ta !== tb) return false;
    if (ta === 'object') {
        if (!a) return !b;
        if (!b) return !a;
        if (Array.isArray(a)) {
            if (!Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            if (!a.length) return true;
            return !a.find((ia, i) => !same(ia, b[i]));
        }
        const keysA = Object.keys(a);
        if (keysA.length !== Object.keys(b).length) return false;
        return !keysA.find(key => !same(a[key], b[key]));
    }
    return a === b;
}

function startWS(url, session, protocols, options, syncContexts) {
    let ws;
    try {
        let isError = false;
        console.log(`opening ws '${url}'`);
        session.emit('open', url, protocols, options);
        ws = createWebSocket(url, protocols, options);
        ws.on('error', e => {
            isError = true;
            session.emit('error', e);
            console.log(`ws error: ${e ? e.message : e}`);
        });
    } catch (e) {
        console.error(e);
    }
    const promises = {};

    let onConnected;
    const connection = new Promise(resolve => onConnected = resolve);

    const message = (name, data) => new Promise((resolve, reject) => {
        let items = promises[name] || (promises[name] = []);
        items.push({data, resolve, reject});
    });

    session.close = () => {
        if (!session.closed) {
            session.closed = true;
            console.log(`closing session '${session.id}'`);
            if (session.connected) {
                ws.close();
            }
            Object.values(promises).map(items => items.map(({reject}) => reject("closing session")));
            session.contexts && session.contexts.map(context => {
                context.files && context.files['/']();
            });
            session.emit('close');
        }
    };
    session.send = (name, data) => {
        try {
            session.emit('send', name, data);
            if (!session.closed) {
                ws.send(name + (data !== undefined ? "\n" + JSON.stringify(data) : ""));
                resetPing();
            }
        } catch (e) {
            console.log(`can not send message ${name}=${data}: `, e);
        }
    };

    const sendAll = obj => {
        if (typeof obj === 'object') {
            const messages = Array.isArray(obj) ? obj : Object.entries(obj);
            messages.map(([name, data]) => session.send(name, data));
        }
    };

    let pingTimeout = null;
    const closePing = () => pingTimeout != null && clearTimeout(pingTimeout);

    function resetPing() {
        closePing();
        pingTimeout = setTimeout(() => {
            pingTimeout = null;
            session.send('ping');
            resetPing();
        }, 40000);
    }

    const methods = createMethods(session);

    ws.on('open', () => {
        session.connected = true;
        session.emit('open');
        resetPing();
        onConnected();
    });

    ws.on('close', code => {
        console.log(`closing websocket (closing code ${code})`);
        closePing();
        session.connected = false;
        session.close();
    });

    ws.on('message', async (data) => {
        const newLine = data.indexOf("\n");
        const methodName = newLine !== -1 ? newLine > 0 ? data.substr(0, newLine) : null : newLine;
        let obj = data.substr(newLine + 1);
        try {
            obj = methodName ? JSON.parse(obj) : null;
        } catch (e) {
            // save to ignore
        }
        session.emit('message', methodName, obj);
        const items = promises[methodName];
        if (items) {
            const item = items.find(({data}) => !data || !Object.keys(data).find(key => !same(data[key], obj[key])));
            if (item) {
                items.splice(items.indexOf(item), 1);
                try {
                    item.resolve(obj);
                } catch (e) {
                    console.log(`can not process message ${methodName}: ${JSON.stringify(obj)}`, e);
                }
                return
            }
        }
        const method = methods[methodName];
        if (method) {
            const response = await method(obj);
            if (response) {
                sendAll(response);
            }
        }
    });

    comm(session, message, syncContexts).catch(e => console.error(e));
}

const comm = async (session, message, syncContexts) => {

    const {token} = await message('AUTH');
    session.id = token;

    await authorizeUsingSession(session, session.id);
    session.user = await message('USR');
    session.emit('authorized', session.user);

    if (syncContexts) {
        session.emit('sync');
        await syncDirs(session, message);
        session.emit('synced');
    }
    session.emit('ready');
};

const authorizeUsingSession = async (session, token) => {
    const {auth: {privateKey, username, email}} = session;
    try {
        const signature = privateEncrypt(privateKey, token);
        console.log(`authenticating session '${token}'`);
        session.send('AUTH', {email, username, signature, token});
    } catch (e) {
        console.error(`authentication error`, e);
        session.emit('authenticationFailed', token);
    }
};

const syncDirs = async (session, message) => {
    session.unloadFile = async (id, filePath) => {
        console.log(`clearing file '${id}${filePath}'`);
        session.send("setFileContext", {contextId: id, filePath});
        await message("change", {id, newFiles: [], removedFiles: [filePath]});
        console.log(`clearing file '${id}${filePath}' finished`);
    };
    session.uploadFile = async (id, filePath) => {
        const data = await readFile(id + filePath);
        if (data) {
            const base64 = data.toString('base64');
            session.send("setFileContext", {contextId: id, filePath, base64});
            await message("change", {id, newFiles: [filePath], removedFiles: []});
            console.log(`file '${id}${filePath}' uploaded`);
        }
    };

    session.downloadFile = async (contextId, filePath) => {
        console.log(`downloading file '${contextId}${filePath}'`);
        session.send("getFileContent", {contextId, filePath});
        const {base64} = await message("fileContent", {contextId, filePath});
        if (base64 != null) {
            const file = contextId + filePath;
            await writeFile(file, Buffer.from(base64, 'base64'));
        }
    };

    session.send('contexts', {});
    const contexts = await message('contexts');

    const ids = [];

    session.contexts = await Promise.all(contexts.map(async context => {
        const {id} = context;
        const existing = {};
        await deleteFolderRecursive(id, (isDir, path) => existing[path] = {isDir});
        ids.push(id);
        return {id, existing};
    }));

    session.send('filesInContext', ids);
    const contextsFiles = await message('filesInContext');
    const ignoredFilesByWatcher = {};
    const canProcessFile = (id, filePath) => {
        const key = id + filePath;
        if (ignoredFilesByWatcher[key]) {
            delete ignoredFilesByWatcher[key];
            return false;
        }
        return true;
    };
    session.ignoredFilesByWatcher = ignoredFilesByWatcher;

    await Promise.all(session.contexts.map(async context => {
        const {id, existing} = context;
        const {files} = contextsFiles.find(item => id === item.id);
        const downloadFiles = [];
        const allFiles = [];
        const addTree = async (prefix, o) => {
            const full = id + prefix;
            const inDir = full.substr(0, full.length - 1);
            if (!existing[inDir]) {
                await mkdir(inDir)
            } else {
                delete existing[inDir];
            }
            await Promise.all(Object.entries(o).map(async ([name, value]) => {
                const filePath = prefix + name;
                allFiles.push(filePath);
                if (typeof value === 'object') await addTree(filePath + '/', value);
                else {
                    const key = id + prefix + name;
                    ignoredFilesByWatcher[key] = true;
                    const [modified, size] = value.split("|");
                    if (existing[key]) {
                        const stat = await fileStat(key);
                        delete existing[key];
                        if (!stat || stat.ctime.getTime() < new Date(modified).getTime()) {
                            downloadFiles.push({id, filePath});
                        }
                    } else {
                        downloadFiles.push({id, filePath});
                    }
                }
            }));
        };

        await addTree('/', files);
        console.log(`received context '${id}': ${(allFiles.length > 10 ? [...allFiles.slice(0, 10), '...'] : allFiles).join(', ')}`);

        await Promise.all(downloadFiles.map(async ({id, filePath}) => await session.downloadFile(id, filePath)));
        const filesToRemove = [];
        Object.entries(existing).forEach(([key, {isDir}]) => {
            if (!isDir) {
                filesToRemove.push(key);
            }
        });
        for (const key of filesToRemove) {
            delete existing[key];
            await rmFile(key);
        }
        for (const key of Object.keys(existing)) {
            const items = await listDir(key);
            if (!items.length) {
                delete existing[key];
                await rmDir(key);
            }
        }

        //watching dir
        context.files = await watchDirAt(id, async ({newFiles, removedFiles}) => {
            for (const filePath of removedFiles) {
                if (canProcessFile(id, filePath)) {
                    await session.unloadFile(id, filePath);
                }
            }
            for (const filePath of newFiles) {
                if (canProcessFile(id, filePath)) {
                    await session.uploadFile(id, filePath);
                }
            }
        });
    }));
};

const rmFile = path => new Promise(resolve => {
    console.log("removing file " + path);
    getFS().unlink(path, resolve)
});
const rmDir = path => new Promise(resolve => {
    console.log("removing directory " + path);
    getFS().rmdir(path, resolve)
});
const listDir = path => new Promise(resolve => getFS().readdir(path, (err, files) => resolve(files || [])));
const deleteFolderRecursive = async (path, collect) => {
    const exists = await new Promise(resolve => getFS().exists(path, resolve));
    if (exists) {
        const files = await listDir(path);
        await Promise.all(files.map(async file => {
            const curPath = path + "/" + file;
            const stats = await new Promise(resolve => getFS().lstat(curPath, (err, stats) => resolve(stats)));
            if (stats && stats.isDirectory()) {
                // recurse
                await deleteFolderRecursive(curPath, collect);
            } else if (!collect) {
                // delete file
                await rmFile(curPath);
            } else {
                collect(false, curPath);
            }
        }));
        if (!collect) {
            await rmDir(path)
        } else {
            collect(true, path);
        }
    }
};

const mkdir = async (path) => {
    const index = path.lastIndexOf('/');
    if (index > 0) {
        await mkdir(path.substr(0, index));
    }
    const stat = await fileStat(path);
    if (!stat || !stat.isDirectory()) {
        console.log("creating directory " + path);
        await new Promise(resolve => getFS().mkdir(path, {recursive: true}, () => resolve()));
    }
};
const writeFile = async (path, content) => {
    await mkdir(path.substr(0, path.lastIndexOf('/')));
    await new Promise((resolve, reject) =>
        getFS().writeFile(path, content, (err) => err ? reject(err) : resolve())
    );
    console.log("created file " + path);
};
const fileStat = (path) => new Promise(resolve =>
    getFS().stat(path, (err, stat) => err ? resolve(null) : resolve(stat))
);

const getPubEmail = (pub) => {
    if (!pub || pub.startsWith('#')) {
        return null;
    }
    const publicKeyEmail = pub.split(' ')[2];
    if (publicKeyEmail && publicKeyEmail.length > 1) {
        return publicKeyEmail.trim().toLowerCase();
    }
    return null;
};

const doConnect = async ({session, url, sshKeyPath, sshKeyName, protocols, options, syncContexts}) => {
    if (!session.auth.username) {
        session.auth.username = userInfo().username;
    }
    const loadEmail = !session.auth.email || !session.auth.username;
    if (!sshKeyPath && !session.auth.privateKey && loadEmail) {
        sshKeyPath = getSshKeyPath(sshKeyName);
    }
    if (!session.auth.privateKey) {
        session.auth.privateKey = await getPrivateKey(sshKeyPath);
    }

    if (loadEmail) {
        try {
            const pub = await getPublicKey(sshKeyPath);
            const publicKeyEmail = getPubEmail(pub);
            if (publicKeyEmail) {
                session.auth.email = publicKeyEmail;
            }
        } catch (e) {
            //safe to ignore
        }
    }

    startWS(url, session, protocols, options, syncContexts);
};

module.exports.getPubEmail = getPubEmail;

module.exports.connect = ({url, username, sshKeyName, sshKeyPath, privateKey, email, token, protocols, options, emitter, syncContexts = false, logTargets = false}) => {
    if (!emitter) {
        emitter = new EventEmitter();
    }
    const auth = {privateKey, email, token, username};
    const authorize = (token, cb = null) => {
        if (!auth.privateKey) {
            if (cb) {
                cb();
            }
            throw new Error('Can not authorize session without private key');
        }
        authorizeUsingSession(session, token).then(() => cb && cb()).catch(err => {
            console.log("auth. error", err);
            if (cb) {
                cb();
            }
        });
    };
    const session = {
        url,
        logTargets,
        authorize,
        auth,
        on: (type, listener) => emitter.on(type, listener),
        removeListener: (type, listener) => emitter.removeListener(type, listener),
        emit: (type, ...args) => emitter.emit(type, ...args),
    };
    doConnect({session, url, sshKeyPath, sshKeyName, protocols, options, syncContexts}).catch(e => console.error(`can not connect: '${e}'`));
    return session;
};
