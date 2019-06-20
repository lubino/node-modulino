const client = ((target) => {
    const {crypto, Buffer} = window.node;
    const module = {
        "./ws": {
            createWebSocket: (url, protocols) => {
                const ws = new WebSocket(url, protocols);
                ws.on = (name, listener) => ws.addEventListener(name, (event) => listener(event.data));
                return ws;
            }
        },
        "./fsWatcher": {
            getFile: () => ""
        },
        "./security": {
            publicDecrypt: (publicKey, signature) => crypto.publicDecrypt(publicKey, Buffer.from(signature, 'base64')).toString(),
            privateEncrypt: (privateKey, data) => crypto.privateEncrypt(privateKey, Buffer.from(data)).toString("base64"),
            getPrivateKey: () => new Promise(resolve => resolve(localStorage.getItem('privateKey'))),
            getPublicKey: () => new Promise(resolve => resolve(localStorage.getItem('publicKey'))),
            getSshKeyPath: i => i,
            userInfo: () => ({}),
            homedir: () => ""

        },
        "./EventEmitter": {
            EventEmitter: function () {
                const map = {};
                this.emit = (name, ...params) => {
                    const listeners = map[name];
                    if (listeners) {
                        for (const listener of listeners) {
                            listener(...params);
                        }
                    }
                };
                this.on = (name, listener) => (map[name] || (map[name] = [])).push(listener);
            }
        },
        exports: {}
    };
    const require = (name) => module[name];
    client.js();
    Object.entries(module.exports).forEach(([key, value]) => target[key] = value);
    return target;
})({});

client.url = ws.url();
client.webUrl = web.url();
