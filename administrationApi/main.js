const hashParams = (() => {
    const {hash} = location;
    const obj = {};
    if (hash) {
        const params = hash.substr(1).split('&');
        for (const param of params) {
            const [key, ...value] = param.split('=');
            obj[key] = value.join('=');
        }
    }
    return obj;
})();

const session = client.connect({
    logTargets: false,
    syncContexts: false,
    url: client.url,
    options: {}
});

session.on('close', () => {
    document.body.innerHTML = '';
    el({className: "center", innerHTML: 'Session is closed.'});
    done();
});
session.on('error', event => {
    console.log('ws error', event);
});

session.on('message', (name, data) => {
    if (name === 'term') {
        session.term.write(data);
    } else if (name === 'newTerm') {
        console.log(`terminal ${JSON.stringify(data)}`);
        const resize = true;
        const name = 'pty';

        const term = new Terminal({});
        term.on('data', (msg) => session.send(name, {msg}));
        term.on('resize', ({cols, rows}) => session.send(name, {resize, cols, rows}));
        window.addEventListener('resize', () => term.fit());

        document.body.innerHTML = '';
        term.open(document.body);
        term.fit();
        term.focus();
        session.term = term;
    } else if (name === 'USR') {
        session.user = data;
        session.authenricated = true;
        const {t} = hashParams;
        if (t) {
            if (confirm(`Do you want to allow '${t}' to log in?`)) {
                session.authorize(t, done);
            } else {
                done();
            }
        } else {
            session.send('pty', {start: true});
            session.send('help');
        }
    } else {
        console.log(`=> '${name}'`, data);
    }
});

session.on('authenticationFailed', (id) => {
    const url = `${client.webUrl}#t=${id}`;
    console.log(`please authenticate, visit ${url} or run: session.authorize('${id}')`);
    const parent = el({className: "qr"});
    el({
        parent,
        tag: "span",
        className: "token",
        innerHTML: id
    });
    window.qrCode = new QRCode(parent, url);
    el({
        tag: "button",
        innerHTML: "Add OpenSSL keys",
        parent: el({className: "center"}),
        onclick: ({target}) => {
            const parent = rem(target);
            const privateKey = el({
                parent,
                tag: "textarea",
                className: "privateKey",
                value: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'
            });
            const publicKey = el({
                parent,
                tag: "textarea",
                className: "publicKey",
                value: 'ssh-rsa .... ...@...'
            });
            el({parent, tag: "br"});
            el({
                parent,
                tag: "button",
                innerHTML: "Save OpenSSL keys",
                onclick: () => {
                    localStorage.setItem('privateKey', privateKey.value);
                    localStorage.setItem('publicKey', publicKey.value);
                    location.reload();
                }
            });
        }
    });
});

function blink(option = true) {
    session.term.setOption('cursorBlink', option);
}

function cursor(type = 'underline') {
    session.term.setOption('cursorStyle', type);
}

function done() {
    el({className: "center", innerHTML: 'You can close this window now.'});
    session.close();
    window.close();
}

const el = ({tag = "div", parent = document.body, ...params} = {}) => {
    const element = document.createElement(tag);
    Object.entries(params).forEach(([name, value]) => element[name] = value);
    if (parent) {
        parent.appendChild(element);
    }
    return element;
};

const rem = (target) => {
    const {parentNode} = target;
    parentNode.removeChild(target);
    return parentNode;
};
