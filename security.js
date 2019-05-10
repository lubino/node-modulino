const {getFile} = require('./fsWatcher');

let crypto;
let os;

const getCrypto = () => {
    if (!crypto) {
        crypto = require("crypto");
    }
    return crypto;
};

const getOS = () => os ? os : os = require('os');

const userInfo = () => getOS().userInfo();
const homedir = () => getOS().homedir();

const getSshKeyPath = (sshKeyName) => {
    const homeDir = homedir();
    const key = sshKeyName || 'id_rsa';
    return `${homeDir}/.ssh/${key}`;
};

const getAuthorizedKeys = () => `${homedir()}/.ssh/authorized_keys`;

const getPrivateKey = async (sshKeyPath) => {
    const file = await getFile(sshKeyPath);
    return file.toString();
};

const getPublicKey = async (sshKeyPath) => {
    const file = await getFile(`${sshKeyPath}.pub`);
    return file.toString();
};

const publicDecrypt = (publicKey, signature) => getCrypto().publicDecrypt(publicKey, Buffer.from(signature, 'base64')).toString();
const privateEncrypt = (privateKey, data) => getCrypto().privateEncrypt(privateKey, Buffer.from(data)).toString("base64");

module.exports = {
    publicDecrypt, getCrypto, userInfo, homedir, getSshKeyPath, getAuthorizedKeys, privateEncrypt,
    getPrivateKey, getPublicKey
};
