let exec;
let cwd;

const execute = command => {
    if (!exec) {
        exec = require('child_process').exec;
        cwd = process.cwd();
    }
    return new Promise(resolve => {
        exec(command, {cwd}, (error, stdout, stderr) => resolve({stdout, stderr}));
    });
};

const installNpm = async (logger, name) => {
    logger.debug(`installing ${name}`);
    const {stdout, stderr} = await execute(`npm i ${name}`);
    logger.debug(`${name} installation finished: ${JSON.stringify({stdout, stderr})}`);
    if (!stdout.includes(`+ ${name}@`)) {
        throw new Error(`${name} module not available, run 'npm i ${name}' to install it`)
    }
};

let cache = {};
const asyncRequire = async (logger, name, noInstallation) => {
    let item = cache[name];
    if (!item) {
        try {
            cache[name] = item = require(name);
        } catch (e) {
            if (noInstallation) throw e;
            await installNpm(logger, name);
            return await asyncRequire(logger, name, true);
        }
    }
    return item;
};

module.exports = {asyncRequire};