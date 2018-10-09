function log(...a) {
    console.log(...a);
}

function req(api, path) {
    if (path === 'api') return api;
    log('require ' + path);
    return require(path)
}

function runModule(dirPath, filePath, api, file) {
    const _logs = [];
    const console = {
        log: (...a) => _logs.push(a)
    };
    const window = {};
    const require = path => req(api, path);
    try {
        eval(file);
    } catch (e) {
        const {message} = e;
        const stackArr = [];
        ("" + e.stack).split('\n').map((line, index) => {
            if (index === 0) {
                stackArr.push(line);
                return;
            }
            const start = line.indexOf('(eval at runModule');
            if (start > 0) {
                const startStr = line.substr(0, start) + "(";
                const endConst = "), <anonymous>";
                const end = line.indexOf(endConst);
                if (end > 0) {
                    const endStr = line.substr(end + endConst.length);
                    stackArr.push(startStr + dirPath + filePath + endStr);
                }
            }
        });
        const stack = stackArr.join('\n');
        throw {message, stack, toString: () => message, logs: _logs};
    }
    return _logs;
}

module.exports = {runModule};