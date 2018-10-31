let crypto;
let WebSocket;
let fs;
let os;
const {watchDirAt} = require('./fsWatcher');

const createMethods = session => ({
    ERR: err => {
        console.log("error received", err);
        err === 401 && session.close();
    },
    log: item => {
        console.log(item.message);
        if (item.stack) console.log(item.stack);
    },
    change: async data => {
        const {id, newFiles, removedFiles} = data;
        await Promise.all(newFiles.map(async filePath => {
            const path = id + filePath;
            session.ignoredFilesByWatcher[path] = true;
            await session.downloadFile(id, filePath);
        }));
        await Promise.all(removedFiles.map(async filePath => {
            const path = id + filePath;
            session.ignoredFilesByWatcher[path] = true;
            await rmFile(path);
        }));
    },
    USR: ({user}) => {
        console.log(`user '${user.name}' authenticated`);
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

function startWS(url, session, protocols, options, onMessage) {
    let ws;
    try {
        let isError = false;
        console.log(`opening ws '${url}'`);
        ws = new WebSocket(url, protocols, options);
        ws.on('error', e => {
            isError = true;
            console.log(`ws error: ${e.message}`);
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
        if (session.connected) ws.close();
        Object.values(promises).map(items => items.map(({reject}) => reject("Closing ws")));
        session.contexts && session.contexts.map(context => {
            context.files['/']();
        });
    };
    session.send = (name, data) => new Promise((resolve, reject) => {
        try {
            !session.closed && ws.send(name + (data ? "\n" + JSON.stringify(data) : ""));
            resetPing();
        } catch (e) {
            console.log(`can not send message ${name}=${data}: `, e);
        }
        resolve()
    });

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
        resetPing();
        onConnected();
    });

    ws.on('close', code => {
        console.log(`closing websocket (closing code ${code})`);
        closePing();
        session.connected = false;
        session.closed = true;
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
        onMessage && onMessage(methodName, obj);
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
            if (response) sendAll(response);
        } else {
            console.log(`unknown message '${methodName}':`, obj);
        }
        //ws.send("ok");
    });

    comm(session, message).catch(e => console.error(e));
}

const comm = async (session, message) => {

    const {token} = await message('AUTH');
    session.id = token;

    await authorize(session);
    session.user = await message('USR');
    session.authorize = token => authorize(session, token);

    await syncDirs(session, message);

};

const authorize = async (session, token) => {
    const {id, auth: {privateKey, username, email}} = session;
    const enc = token || id;
    const signature = crypto.privateEncrypt(privateKey, Buffer.from(enc)).toString("base64");
    console.log(`authenticating session '${enc}'`);
    session.send('AUTH', {email, username, signature, token});
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
        const base64 = data.toString('base64');
        session.send("setFileContext", {contextId: id, filePath, base64});
        await message("change", {id, newFiles: [filePath], removedFiles: []});
        console.log(`file '${id}${filePath}' uploaded`);
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
    const ignoredFilesByWatcher = {};
    session.ignoredFilesByWatcher = ignoredFilesByWatcher;

    await Promise.all(session.contexts.map(async context => {
        const {id, existing} = context;
        const contextFiles = await message('filesInContext');
        const downloadFiles = [];
        await Promise.all(contextFiles.map(async ({id, files}) => {
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

        }));

        await Promise.all(downloadFiles.map(async ({id, filePath}) => await session.downloadFile(id, filePath)));
        const filesToRemove = [];
        await Promise.all(Object.entries(existing).map(async ([key, {isDir}]) => {
            if (!isDir) {
                filesToRemove.push(key);
            }
        }));
        await Promise.all(filesToRemove.map(async key => {
            delete existing[key];
            await rmFile(key);
        }));
        await Promise.all(Object.keys(existing).map(async key => {
            const items = await listDir(key);
            if (!items.length) {
                delete existing[key];
                rmDir(key);
            }
        }));

        //watching dir
        context.files = await watchDirAt(id, async ({newFiles, removedFiles}) => {
            await Promise.all(removedFiles.map(async filePath => {
                const key = id + filePath;
                if (ignoredFilesByWatcher[key]) {
                    delete ignoredFilesByWatcher[key];
                } else {
                    await session.unloadFile(id, filePath);
                }
            }));
            await Promise.all(newFiles.map(async filePath => {
                const key = id + filePath;
                if (ignoredFilesByWatcher[key]) {
                    delete ignoredFilesByWatcher[key];
                } else {
                    await session.uploadFile(id, filePath);
                }
            }));
        });
    }));
};

const rmFile = path => new Promise(resolve => {
    console.log("removing file " + path);
    fs.unlink(path, resolve)
});
const rmDir = path => new Promise(resolve => {
    console.log("removing directory " + path);
    fs.rmdir(path, resolve)
});
const listDir = path => new Promise(resolve => fs.readdir(path, (err, files) => resolve(files || [])));
const deleteFolderRecursive = async (path, collect) => {
    const exists = await new Promise(resolve => fs.exists(path, resolve));
    if (exists) {
        const files = await listDir(path);
        await Promise.all(files.map(async file => {
            const curPath = path + "/" + file;
            const stats = await new Promise(resolve => fs.lstat(curPath, (err, stats) => resolve(stats)));
            if (stats && stats.isDirectory()) { // recurse
                await deleteFolderRecursive(curPath, collect);
            } else if (!collect) { // delete file
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
        await new Promise(resolve => fs.mkdir(path, {recursive: true}, () => resolve()));
    }
};
const readFile = (path) => new Promise((resolve, reject) => {
    console.log("reading file " + path);
    fs.readFile(path, (err, data) => err ? reject(err) : resolve(data));
});
const writeFile = async (path, content) => {
    await mkdir(path.substr(0, path.lastIndexOf('/')));
    await new Promise((resolve, reject) =>
        fs.writeFile(path, content, (err) => err ? reject(err) : resolve())
    );
    console.log("created file " + path);
};
const fileStat = (path) => new Promise(resolve =>
    fs.stat(path, (err, stat) => err ? resolve(null) : resolve(stat))
);

module.exports.connect = ({url, username, sshKeyName, sshKeyPath, privateKey, email, token, protocols, options, onMessage}) => {
    if (!crypto) {
        crypto = require("crypto");
        WebSocket = require('ws');
        fs = require("fs");
        os = require('os');
    }
    if (!username) {
        username = os.userInfo().username;
    }
    if (!sshKeyPath) {
        const homeDir = os.homedir();
        const key = sshKeyName || 'id_rsa';
        sshKeyPath = `${homeDir}/.ssh/${key}`;

    }
    if (!privateKey) {
        privateKey = fs.readFileSync(sshKeyPath, "utf8");
    }

    if (!email) {
        try {
            const publicKeyEmail = fs.readFileSync(`${sshKeyPath}.pub`, "utf8").split(' ')[2];
            if (publicKeyEmail && publicKeyEmail.length > 1) {
                email = publicKeyEmail.trim();
            }
        } catch (e) {
            //safe to ignore
        }
    }

    const session = {
        auth: {privateKey, email, token, username}
    };
    startWS(url, session, protocols, options, onMessage);
    return session;
};