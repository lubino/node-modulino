const {modulesForContext} = require('./module');
const fs = require('fs');

const transporters = {};
let nodemailer;

const mailer = (logger, service, auth) => {
    const key = JSON.stringify({service, auth});
    let transporter = transporters[key];
    if (!transporter) {
        if (!nodemailer) nodemailer = require('nodemailer');
        transporters[key] = transporter = nodemailer.createTransport({service, auth});
    }
    return transporter;
};

const data = {};

const sharedStorage = (logger, name, value = {}) => {
    let d = data[name];
    if (!d) {
        data[name] = d = value;
    }
    return d;
};

function apiForContext(context) {
    const modules = modulesForContext(context);
    const module = (() => {
        const {module} = modules;
        return (logger, path) => {
            logger.debug(`loading module '${path}'`);
            return module(path)
        }
    })();

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

    storage.save = logger => new Promise((resolve, reject) => {
        logger.debug(`saving storage`);
        fs.writeFile(context.id + ".storage.json", JSON.stringify(context.storage),
            err => {
                logger.debug(`storage ${err ? 'not ' : ''}saved`);
                if (err) reject(err);
                else resolve();
            });
    });

    const featuresFor = logger => ({
        storage: (name, value) => storage(logger, name, value),
        save: async () => await storage.save(logger),
        sharedStorage: (name, value) => sharedStorage(logger, name, value),
        mailer: (service, auth) => mailer(logger, service, auth),
        module: path => module(logger, path),
    });

    return {storage, mailer, module, sharedStorage, featuresFor}
}

module.exports = {apiForContext};
