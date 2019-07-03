const fs = require('fs');
const {modulesForContext} = require('./module');
const {asyncRequire} = require("./installer");

const mailers = {};
let nodemailer;
let imap;

const plainJSON = (o, l = 20, all = []) => {
    const type = typeof o;
    if (type === 'object') {
        if (o === null) return null;
        const isArray = Array.isArray(o);
        if (all.includes(o)) return isArray ? "(Array)" : "(Object)";
        all.push(o);
        if (l < 0) return isArray ? "[...]" : "{...}";
        if (isArray) return o.map(value => plainJSON(value, l - 1, all));
        const result = {};
        Object.entries(o).map(([name, value]) => {
            const type = typeof value;
            try {
                result[name] = plainJSON(value, l - 1, all);
            } catch (e) {
                result[name] = `(${type}) ${e}`;
            }
        });
        return result;
    }
    if (type === 'function') {
        let args = '';
        for (let i = 1; i <= o.length; i++) {
            args += (i === 1 ? 'p' : ", p") + i;
        }
        return `${type} ${o.name}(${args})`;
    }
    return o;
};

const mailerConfiguration = (context, authentication, serviceKey) => {
    let service;
    let auth;
    if (!authentication) {
        const config = (serviceKey ? context.email[serviceKey] : context.email) || {};
        service = config.service || serviceKey;
        auth = config.auth;
    } else {
        service = serviceKey;
        auth = authentication;
    }

    if (!service && !authentication) {
        throw new Error('Mailer transporter is not configured.');
    }

    let cfg;

    if (typeof service === 'string') {
        const configuration = require('nodemailer/lib/well-known')(service);
        if (configuration) {
            const {host, port, secure} = configuration;
            const isSmtp = host.includes('smtp');
            cfg = {};
            cfg.user = auth.user;
            cfg.password = auth.pass;
            cfg.host = isSmtp ? host.replace('smtp', 'imap') : host;
            cfg.port = port === 465 || port === 25 ? (secure ? 993 : 143) : port;
            cfg.tls = secure;
        }
    }

    return {service, auth, cfg};

};

const createMailer = (context, authentication, serviceKey) => {
    const {service, auth, cfg} = mailerConfiguration(context, authentication, serviceKey);
    const transport = nodemailer.createTransport({service, auth});
    return {
        sendMail: (o, cb) => transport.sendMail(o, cb),
        withImap: (cb) => cb(new imap(cfg), imap),
        createImap: async () => {
            return {imap: new imap(cfg), Imap: imap};
        }
    };
};

const mailer = (logger, context, serviceKey, authentication) => {
    let key;
    if (!authentication || !serviceKey) {
        key = serviceKey || "default";
    } else {
        key = JSON.stringify({s: serviceKey, a: authentication});
    }
    let mailer = mailers[key];
    if (!mailer) {
        if (!nodemailer || !imap) {
            try {
                nodemailer = require('nodemailer');
                imap = require('imap');
            } catch (e) {
                let mailsToSend = [];
                let imapsToProcess = [];
                let imapResolvers = [];
                asyncRequire(logger, 'nodemailer').then(result => {
                    nodemailer = result;
                    asyncRequire(logger, 'imap').then(result => {
                        imap = result;
                        mailer = createMailer(context, authentication, serviceKey);
                        mailers[key] = mailer;
                        mailsToSend.splice(0, mailsToSend.length).forEach(({o, cb}) => mailer.sendMail(o, cb));
                        imapsToProcess.splice(0, imapsToProcess.length).forEach((cb) => mailer.withImap(cb));
                        imapResolvers.splice(0, imapResolvers.length).forEach((resolve) => mailer.createImap().then(resolve));
                    });
                });

                return {
                    sendMail: (o, cb) => {
                        if (mailer) {
                            return mailer.sendMail(o, cb);
                        }
                        mailsToSend.push({o, cb});
                    },
                    withImap: (cb) => {
                        if (mailer) {
                            return mailer.withImap(cb);
                        }
                        imapsToProcess.push(cb);
                    },
                    createImap: () => new Promise(resolve => imapResolvers.push(resolve))
                };
            }
        }

        mailer = createMailer(context, authentication, serviceKey);
        mailers[key] = mailer;
    }
    return mailer;
};

const data = {};

const sharedStorage = (logger, name, value = {}) => {
    let d = data[name];
    if (!d) {
        data[name] = d = value;
    }
    return d;
};

function featuresForContext(context) {
    const {module} = modulesForContext(context);
    const moduleFor = (logger, path) => {
        const actual = module(path);
        if (!actual) {
            logger.debug(`loading empty module '${path}'`);
            const newOne = {};
            module(path, newOne);
            return newOne;
        }
        return actual
    };

    if (!context.storage) {
        context.storage = {};
    }

    const storage = (logger, name, value = {}) => {
        let d = context.storage[name];
        if (!d) {
            context.storage[name] = d = value;
        }
        return d;
    };

    const {storeContent} = context;
    const {contentOf} = context;

    storage.save = logger => new Promise((resolve, reject) => {
        logger.debug(`saving storage`);
        fs.writeFile(context.id + ".storage.json", JSON.stringify(context.storage),
            err => {
                logger.debug(`storage ${err ? 'not ' : ''}saved`);
                if (err) reject(err);
                else resolve();
            });
    });

    const featuresFor = (logger, filePath) => {
        const api = {
            storage: (name, value) => storage(logger, name, value),
            save: async () => await storage.save(logger),
            sharedStorage: (name, value) => sharedStorage(logger, name, value),
            mailer: (service, auth) => mailer(logger, context, service, auth),
            module: path => moduleFor(logger, path),
            storeContent,
            contentOf,
            plainJSON: plainJSON,
            console: logger,
            Error: function (message) {
                return logger.transformException(new Error(message));
            },
            require: path => {
                logger.debug(`requiring file '${path}'`);
                if (path === 'api' || path === 'modulino/api') return api;
                if (path === 'modulino/administration' && context.allowAdministration) return require('./administration');
                if (path === 'fs' && !context.allowAdministration) throw new api.Error(`'${path}' is forbidden (security concerns)`);
                if (path.startsWith('../')) path = joinPath(filePath, path);
                if (path.includes('/../')) throw new api.Error(`path contains '/../' use only absolute paths`);
                if (path.startsWith('./')) path = absolute(context.path) + filePath.substr(0, filePath.lastIndexOf('/')) + path.substr(1);
                else if (path.startsWith('/')) path = absolute(context.path) + path;
                else if (path.includes('/')) new api.Error(`path contains forbidden symbol '/' (security concerns)`);
                try {
                    return require(path)
                } catch (e) {
                    throw logger.transformException(e);
                }
            },
            window: {}
        };
        return api;
    };

    return {storage, mailer, module: moduleFor, sharedStorage, storeContent, contentOf, plainJSON, featuresFor}
}

const absolute = path => path.startsWith('/') ? path : process.cwd() + '/' + path;
const joinPath = (filePath, path) => {
    let i = 0;
    while (path.startsWith('../', i*3)) {
        i++;
    }
    const end = path.substr(i*3);
    let p = filePath;
    while (i-->=0) {
        p = p.substr(0, p.lastIndexOf('/'));
    }
    return p + "/" + end;
};

module.exports = {featuresForContext};
