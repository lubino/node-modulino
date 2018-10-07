const {modulesForContext} = require('./module');
const fs = require('fs');

const transporters = {};
let nodemailer;

const mailer = (service, auth) => {
    const key = JSON.stringify({service, auth});
    let transporter = transporters[key];
    if (!transporter) {
        if (!nodemailer) nodemailer = require('nodemailer');
        transporters[key] = transporter = nodemailer.createTransport({service, auth});
    }
    return transporter;
};

const data = {};

const sharedStorage = (name, value = {}) => {
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
        return (path) => module(path)
    })();

    if (!context.storage) {
        context.storage = {};
    }

    const storage = (name, value = {}) => {
        let d = context.storage[name];
        if (!d) {
            context.storage[name] = d = value;
        }
        return d;
    };

    storage.save = () => new Promise((resolve, reject) => {
        fs.writeFile(context.id+".storage.json", JSON.stringify(context.storage),
            err => err ? reject(err) : resolve());
    });

    return {storage, mailer, module, sharedStorage}
}

module.exports = {apiForContext};
