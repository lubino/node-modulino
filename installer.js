let exec;

const execute = command => {
    if (!exec) exec = require('child_process').exec;
    return new Promise(resolve => {
        exec(command, (error, stdout, stderr) => resolve({stdout, stderr}));
    });
};

const installNpm = async (logger, name) => {
    logger.debug(`installing ${name}`);
    const {stdout, stderr} = await execute(`npm i ${name}`);
    logger.debug(`${name} installation finished: ${JSON.stringify({stdout, stderr})}`);
    if (!stdout.startsWith(`+ ${name}@`)) {
        throw new Error(`${name} module not available, run 'npm i ${name}' to install it`)
    }
};

let cache = {};
const asyncRequire = async (logger, name) => {
    let item = cache[name];
    if (!item) {
        try {
            cache[name] = item = require(name);
        } catch (e) {
            await installNpm(logger, name);
            return asyncRequire(logger, name);
        }
    }
    return item;
};

module.exports = {asyncRequire};