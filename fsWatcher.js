const fs = require('fs');
const {runAfterAllCycles} = require('./cycles');

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

function fsStat(changePath, root, path, subTree, name, cb) {
    const subPath = path + "/" + name;
    fs.stat(root + subPath, (err, stats) => {
        if (err) {
            removeTree(changePath, subPath, subTree, name);
            cb && cb();
        } else if (stats.isDirectory()) {
            changePath(subPath, "cd");
            const newTree = {};
            subTree[name] = newTree;
            watchDir(changePath, root, subPath, newTree, cb);
        } else if (stats.isFile()) {
            changePath(subPath, "cf");
            subTree[name] = name;
            cb && cb();
        } else {
            removeTree(changePath, subPath, subTree, name);
            cb && cb();
        }
    })
}

function watchDir(changePath, root, path, subTree, cb) {
    const {nextCycle,checkFinish} = runAfterAllCycles(() => {
        const watcher = fs.watch(root + path, (eventType, name) => fsStat(changePath, root, path, subTree, name));
        subTree['.'] = () => watcher.close();
        cb && cb();
    });
    fs.readdir(root + path, (err, files) => {
        files.map(name => nextCycle(endCycle => fsStat(changePath, root, path, subTree, name, endCycle)));
        checkFinish();
    });
}

const type = {
    'cf': 0,
    'rf': 1,
    'cd': 2,
    'rd': 3
};

function forChangeListener(listener) {
    let changes = null;
    let changing = null;

    function done() {
        const arrays = [[],[],[],[]];
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
    
}

module.exports.watchDir = watchDir;
module.exports.forChangeListener = forChangeListener;