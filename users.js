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

const userShhKeys = (username, email) => {
    const user = getUser(username, email);
    return user ? user.sshKeys : [];
};

const user = ({username, email}) => cloneUser(getUser(username, email));

const publicKeysByEmail = (username, email) => userShhKeys(username, email).map(({publicKey})=> publicKey);

const logUser = (username, email, authenticated) => {
    const user = getUser(username, email);
    if (!user) return null;
    user.logs.push({at: Date.now(), type:  authenticated ? "authenticated" : "rejected"});
    return authenticated ? cloneUser(user) : null;
};

const publicKeyByEmailAndName = (username, email, name) => {
    const sshKeys = userShhKeys(username, email);
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

const addUser = (user) => {
    let {name, username, email, emails, sshKeys} = user;

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
    const result = {name, username, emails, sshKeys,logs};
    users[username] = result;
    emails.map(email => usernameByEmail[email] = username);
    return cloneUser(result);
};

module.exports = {getUsers, user, addUser, publicKeysByEmail, logUser};