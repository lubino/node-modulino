let crypto;
let os = require ? undefined : {
    userInfo: () => ({}),
    homedir: () => ""
};

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

const getAuthorizedKeys = () => `${homedir()}/.ssh/authorized_keys`;

const checkSignature = (publicKey, signature, correctValue) => {
    try {
        const decrypted = getCrypto().publicDecrypt(publicKey, Buffer.from(signature, 'base64')).toString();
        return decrypted === correctValue;
    } catch (e) {
        return false;
    }
};


module.exports = {checkSignature, getCrypto, userInfo, homedir, getSshKeyPath, getAuthorizedKeys, getPubEmail};
