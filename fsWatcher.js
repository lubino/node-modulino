const fs = require('fs');

function removeTree(changePath, path, subTree, name) {
    const item = subTree[name];
    if (name !== '.' && item) {
        const type = typeof item;
        const nextPath = path + "/" + name;
        if (type === 'object') {
            item['.']();
            for (const itemName in item) {
                removeTree(changePath, nextPath, item, itemName);
            }
            delete subTree[name];
            changePath(path, "rd");
        } else if (type === 'string') {
            delete subTree[name];
            changePath(path, "rf");
        }
    }
}

const fsStat = async (changePath, dirPath, path, files, name, watchers) => {
    const subPath = path + "/" + name;
    try {
        const stats = await new Promise((resolve, reject) => {
            fs.stat(dirPath + subPath, (err, stats) => err ? reject(err) : resolve(stats))
        });
        if (stats.isDirectory()) {
            changePath(subPath, "cd");
            const newTree = {};
            files[name] = newTree;
            await watchDir(changePath, dirPath, subPath, newTree, watchers);
        } else if (stats.isFile()) {
            changePath(subPath, "cf");
            files[name] = stats.ctime.toISOString() + "|" + stats.size;
        } else {
            throw new Error('Is not a file nor directory');
        }
    } catch (e) {
        removeTree(changePath, subPath, files, name);
    }
};

const watchDir = async (changePath, dirPath, path = '', files, watchers) => {
    const items = await new Promise((resolve, reject) => {
        fs.readdir(dirPath + path, (err, items) => err ? reject(err) : resolve(items));
    });
    await Promise.all(items.map(name => fsStat(changePath, dirPath, path, files, name, watchers)));
    const watcher = fs.watch(dirPath + path, (eventType, name) =>
        fsStat(changePath, dirPath, path, files, name, watchers)
    );
    watchers.push(watcher);
    files['.'] = () => {
        const i = watchers.indexOf(watcher);
        if (i >= 0) {
            watchers.splice(i, 1);
            watcher.close();
        }
    };
    files['/'] = () => {
        [...watchers].map(watcher => {
            const i = watchers.indexOf(watcher);
            if (i >= 0) {
                watchers.splice(i, 1);
                watcher.close();
            }
        });
    }
};

const type = {
    'cf': 0,
    'rf': 1,
    'cd': 2,
    'rd': 3
};

const forChangeListener = listener => {
    let changes = null;
    let changing = null;

    function done() {
        const arrays = [[], [], [], []];
        for (const name in changes) {
            arrays[type[changes[name]]].push(name);
        }
        const [newFiles, removedFiles, newDirectories, removedDirectories] = arrays;
        listener({newFiles, removedFiles, newDirectories, removedDirectories});

        changing = null;
        changes = null;
    }

    return (path, type) => {
        if (!changes) {
            changes = {};
        }
        if (changing !== null) {
            clearTimeout(changing);
            changing = null;
        }
        changing = setTimeout(done, 200);
        changes[path] = type;
    }

};

const watchDirAt = async (dirPath, changeListener) => {
    const files = {};
    const watchers = [];
    await watchDir(forChangeListener(changeListener), dirPath, '', files, watchers);
    return files;
};

const fixPath = filePath => {
    if (filePath.startsWith("../") || filePath.includes('/../') || filePath.includes('//')) {
        throw new Error(`File path '${filePath}' should not include '..' nor '//'`);
    }
    return !filePath.startsWith('/') ? '/' + filePath : filePath;
};

const filePathReader = dirPath => async filePath => {
    fixPath(filePath);
    if (!filePath.startsWith('/')) filePath = '/' + filePath;
    return await new Promise((resolve, reject) =>
        fs.readFile(dirPath + filePath, (e, data) => e ? reject(e) : resolve(data))
    )
};

const mkdir = async (dirPath, parent) => {
    const index = parent.lastIndexOf('/');
    if (index > 0) {
        await mkdir(dirPath, parent.substr(0, index));
    }
    const stat = await new Promise(resolve =>
        fs.stat(dirPath + parent, (err, stat) => err ? resolve(null) : resolve(stat))
    );
    if (!stat || !stat.isDirectory()) {
        await new Promise((resolve, reject) =>
            fs.mkdir(dirPath + parent, {recursive: true}, e => e ? reject(e) : resolve())
        );
    }
};

const filePathWriter = dirPath => async (filePath, data, options) => {
    filePath = fixPath(filePath);
    if (!data) {
        await new Promise((resolve, reject) =>
            fs.unlink(dirPath + filePath, e => e ? reject(e) : resolve())
        );
        return
    }
    await mkdir(dirPath, filePath.substr(0, filePath.lastIndexOf('/')));
    await new Promise((resolve, reject) =>
        fs.writeFile(dirPath + filePath, data, options, e => e ? reject(e) : resolve())
    );
};

const readFile = async name => await new Promise(resolve => fs.readFile(name.replace('~/', __dirname+"/"), (err, data) => resolve(data)));

module.exports = {watchDirAt, filePathReader, filePathWriter, readFile};