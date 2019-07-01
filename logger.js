let listener;
const setListener = item => listener = item;

function createLogger(relPath, filePath) {
    const logs = [];
    const stacks = [];
    let lastTime = "";
    let lastTimestamp = 0;
    let lastIndex = 0;
    const log = (type, ...p) => {
        if (logs.length > 2000) {
            logs.splice(0, 500);
            stacks.splice(0, 500);
        }
        const msg = p.map(o => typeof o === 'object' && o.message && o.stack && o.stack.length ? (o.logger ? o.stack : modifyStack(o.stack, relPath, filePath, true, true)) : o)
            .join(', ');
        const a = relPath !== './' ? `${relPath} ${msg}` :  msg;

        const t = new Date();
        const _ = i => i < 10 ? "0" + i : i;
        const __ = i => i < 100 ? (i < 10 ? "00" : "0") + i : i;
        const n = t.getTime();
        const i = n - lastTimestamp;
        lastTimestamp = n;
        const s = _(t.getSeconds());
        const ms = __(t.getMilliseconds());
        let f;
        if (i < 1000) {
            f = `${__(i)}`;
        } else if (i < 10000) {
            f = `${Math.floor(i / 1000)}k${Math.floor(i / 100) % 10}`;
        } else if (i < 100000) {
            f = `${Math.floor(i / 1000)}k`;
        } else {
            f = `Δms`;
        }
        const {stack} = new Error('ignore logger');
        const stackStr = modifyStack(stack, relPath, filePath, false, true);
        if (lastTime != null) {
            const time = `On ${t.getFullYear()}-${_(1 + t.getMonth())}-${_(t.getDate())} at ${_(t.getHours())}:${_(t.getMinutes())}`;
            if (time !== lastTime) {
                logs.push(time);
                stacks.push(stackStr);
                if (listener) listener({message: time, stack: stackStr});
                lastTime = time;
            }
        }
        const message = `${s}:${ms}(${f}) ${a}`;
        logs.push(message);
        stacks.push(stackStr);
        if (useConcole) {
            console.log(message + "\n" + localStack(stackStr, stack));
        }
        if (listener) listener({message, stack: localStack(stackStr, stack)})
    };

    const join = errs => errs && Array.isArray(errs) && errs.map(e => e && e.stack && modifyStack(e.stack, relPath, filePath, true, false)).join('\n');

    const logger = {
        log: log.bind(this, "log"),
        debug: log.bind(this, "debug"),
        error: log.bind(this, "error"),
        info: log.bind(this, "info"),
        join,
        clean: () => lastIndex = logs.length,
        toString: () => logs.slice(lastIndex).join("\n"),
        stacks: () => logs.slice(lastIndex).map((log, i)=> log+'\n'+stacks[lastIndex+i]).join("\n"),
        all: () => logs.join("\n"),
        allStacks: () => logs.map((log, i)=> log+'\n'+stacks[i]).join("\n"),
    };
    const transformException = e => createErr(e, relPath, filePath, logger);
    logger.transformException = transformException;
    return logger;
}

function createErr(e, relPath, filePath, logger) {
    const {message} = e;
    const stack = modifyStack("" + e.stack, relPath, filePath, true, false);
    return {message, stack, toString: () => message, logger};
}

function modifyStack(stack, relPath, filePath, includeFirstLine, includeReference) {
    const stackArr = [];
    const arr = stack.split('\n');
    let modulinoIncluded = false;
    arr.forEach((line, index) => {
        if (index === 0) {
            if (includeFirstLine) {
                stackArr.push(line);
            }
            return;
        }
        let where;
        let lineStart;
        let endStr;
        const start = line.indexOf('(');
        if (start > 0) {
            lineStart = line.substr(0, start + 1);
            const end = line.indexOf(')', start);
            if (end > start) {
                where = line.substring(start + 1, end);
                endStr = line.substr(end);
            }
        } else {
            const lastSpace = line.lastIndexOf(' ');
            if (lastSpace > 2 && line.substr(lastSpace - 3, 4) === ' at ') {
                lineStart = line.substr(0, lastSpace + 1)+'(';
                where = line.substring(lastSpace + 1);
                endStr = ')';
            }
        }
        if (where) {
            const modulino = where.indexOf('/node_modules/modulino/');
            if (modulino >= 0) {
                if (!modulinoIncluded) {
                    if (!stack.startsWith('Error: ignore logger\n') || !where.includes('/logger.js:')) {
                        modulinoIncluded = true;
                        stackArr.push(lineStart + where.substr(modulino) + endStr);
                    }
                }
            } else if (where.includes(relPath)) {
                stackArr.push(lineStart + where + endStr);
            }
        }
    });
    if (includeReference && filePath) {
        stackArr.push('    at global code (' + relPath + filePath + ':1:1)');
    }
    return stackArr.join('\n');
}

const dir = process.cwd();
const localStack = (str, stack) => str || (""+stack.split('\n')[2]).replace(dir, '.');

const rootLogger = createLogger('./', '');

let useConcole = false;
const logToConsole = bool => useConcole = bool;

module.exports = {createLogger, setListener, rootLogger, logToConsole};
