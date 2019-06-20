const {asyncRequire} = require("./installer");
const {getAuthorizedKeys} = require("./security");
const {getPubEmail} = require("./client");
const {getFile} = require("./fsWatcher");
const {validateUser} = require("./jsonSchema");
const {rootLogger} = require('./logger');

let indexer = 1;

const users = {};
const usernameByEmail = {};

const str = s => s && typeof s === 'string';
const defaultPublicKeyName = "default";

const getUser = (username, email) => {
    let user;
    if (username) {
        user = users[username];
    }
    if (!user) {
        username = usernameByEmail[email];
        if (!username) return null;
        user = users[username];
    }
    if (!user) return null;
    return user;
};

const getUsers = () => Object.keys(users);
let saveUsers;
const saver = save => {
    saveUsers = save;
    saveUser();
};
const saveUser = (user) => saveUsers && saveUsers(Object.values(users), user).catch(e => rootLogger.error(`can not save users: ${e}`, e));

const userShhKeys = async (username, email) => {
    const user = getUser(username, email);
    const userShhKeys = user && user.sshKeys;
    const keys = userShhKeys ? [...userShhKeys] : [];

    if (email && (!user || user.systemUser)) {
        const emailLowerCase = email.toLowerCase();
        try {
            const sshKeyToPEM = await asyncRequire(rootLogger, 'ssh-key-to-pem');
            const file = await getFile(getAuthorizedKeys());
            file.toString().split('\n').forEach(pub => {
                if (getPubEmail(pub) === emailLowerCase) {
                    keys.push({
                        name: email,
                        publicKey: sshKeyToPEM(pub)
                    });
                }
            });
        } catch (e) {
            // safe to ignore
        }
    }
    return keys;
};

const user = (username, email) => cloneUser(getUser(username, email));

const publicKeysByEmail = async (username, email) => {
    const keys = await userShhKeys(username, email);
    return keys.map(({publicKey})=> publicKey);
};

const sshUser = (username, email) => {
    return {
        username: username,
        name: 'ssh user',
        emails: [email],
        sshKeys: [],
        logs: [],
    };
};

const logUser = (username, email, authenticated) => {
    const user = getUser(username, email);
    if (!user) return null;
    user.logs.push({at: Date.now(), type:  authenticated ? "authenticated" : "rejected"});
    saveUser(user);
    return authenticated ? cloneUser(user) : null;
};

const publicKeyByEmailAndName = async (username, email, name) => {
    const sshKeys = await userShhKeys(username, email);
    const {length} = sshKeys;
    let sshKey = length === 1 ? sshKeys[0] : null;
    if (!sshKey && name) {
        sshKey = sshKeys.find(sshKey => sshKey.name === name);
    }
    if (!sshKey && length) {
        sshKey = sshKeys.find(sshKey => sshKey.name === defaultPublicKeyName);
    }
    return sshKey ? sshKey.publicKey : null;
};

const cloneUser = user => {
    if (!user) return null;
    const sshKeys = user.sshKeys.map(({name, publicKey}) => ({name, publicKey}));
    const logs = user.logs.map(log => ({...log}));
    const emails = [...user.emails];
    return {...user, emails, sshKeys, logs};
};

const validationErrors = errors => errors.map(e => `property '${e.name}' (${e.property}) ${e.message} (${JSON.stringify(e.instance)})`);

const addUser = (user) => {
    const errors = validateUser(user);
    if (errors.length) {
        const message = `can not add user: ${validationErrors(errors)}`;
        rootLogger.error(message, user);
        const error = new Error(message);
        error.errors = errors;
        throw error;
    }
    let {name, username, email, emails, sshKeys, systemUser = false} = user;

    if (!str(username) || users[username]) do {
        username = `user_${Math.round(Math.random()*1000000).toString(16)}${indexer}`;
    } while (users[username]);

    //validate email
    if (emails && str(emails)) emails = emails.split(',').map(email => email.trim());
    if (!emails) emails = str(email) ? [email.trim()] : [];

    if (sshKeys && !Array.isArray(sshKeys)) sshKeys = [];
    sshKeys = sshKeys
        .map(({name = defaultPublicKeyName, publicKey}={})=> str(name) && str(publicKey) ? {name, publicKey} : null)
        .filter(i => i);

    indexer++;
    const logs = [];
    const result = {name, username, emails, sshKeys, systemUser, logs};
    users[username] = result;
    saveUser(result);
    emails.map(email => usernameByEmail[email] = username);
    return cloneUser(result);
};

module.exports = {getUsers, user, addUser, publicKeysByEmail, logUser, sshUser, saver};
