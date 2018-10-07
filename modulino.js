const fs = require('fs');
const {apiForContext} = require('./api');
const {modulesForContext} = require('./module');
const {contextForPath, unregisterContext} = require('./context');
const {watchDir, forChangeListener} = require('./fsWatcher');
const {runModule} = require("./runModule");

const errHandler = (file, err) => (req, res) => {
    res.status(500);
    res.type(`html`);
    res.send(`<h1>${file}</h1><pre>${err}</pre>`)
};

const infoHandler = (file, data) => (req, res) => {
    res.type(`html`);
    res.send(`<h1>${file}</h1>${data()}`)
};

const fileHandler = (file, data) => (req, res) => {
    res.type(`html`);
    res.send(`<h1>${file}</h1><pre>${data}</pre>`)
};

const toRemove = ["index.html", "index.htm"];

function fileToPath(file) {
    const lastModuleCharIndex = file.length - 7;
    const lastChar = file.charAt(lastModuleCharIndex);
    const isJsModule = file.endsWith('mod.js') && (lastChar === '.' || lastChar === '/');
    const path = isJsModule ? file.substr(0, lastModuleCharIndex) : file;
    const paths = [path];
    toRemove.map(end => path.endsWith(end) && paths.push(path.substr(0, path.length - end.length)));
    if (isJsModule) paths.push(file);
    return {paths, isJsModule};
}

function urlToPath(url) {
    const qIndex = url.indexOf('?');
    const endIndex = qIndex === -1 ? url.length - 1 : qIndex - 1;
    const endCharacter = url.charAt(endIndex);
    const newLength = endIndex > 0 && endCharacter === '/' ? endIndex : endIndex + 1;
    return url.length === newLength ? url : url.substr(0, newLength);
}

function remove(module) {
    const onUnLoad = module && module.onUnLoad;
    try {
        onUnLoad && onUnLoad();
    } catch (e) {
    }
}

function newListener() {
    let moduleObject;
    const listen = {
        onRequest: listener => {
            if (!moduleObject) moduleObject = {};
            moduleObject.onRequest = listener
        },
        onPOST: listener => {
            if (!moduleObject) moduleObject = {};
            moduleObject.onPOST = listener
        },
        onGET: listener => {
            if (!moduleObject) moduleObject = {};
            moduleObject.onGET = listener
        },
        onPUT: listener => {
            if (!moduleObject) moduleObject = {};
            moduleObject.onPUT = listener
        },
        onDELETE: listener => {
            if (!moduleObject) moduleObject = {};
            moduleObject.onDELETE = listener
        }
    };
    return {
        listen,
        moduleObject: () => moduleObject
    }

}

function createModule(dirPath, api, isJsModule, file, register) {
    const filePath = dirPath + file;
    fs.readFile(filePath, (err, data) => {
        if (err) {
            register({onRequest: errHandler(file, err)});
        } else if (isJsModule) {
            try {
                const listener = newListener();
                const logs = runModule(dirPath, file, {...api, ...listener.listen}, data.toString());
                const moduleObject = listener.moduleObject();
                if (moduleObject) register(moduleObject);
                else  register({onRequest: infoHandler(file, () => `Logs:<pre>${logs.join("\n")}</pre>`)});

            } catch (e) {
                register({onRequest: infoHandler(file, () => `Logs:<pre>${e.logs}</pre>Exception: <pre>${e.stack}</pre>`)});
            }
        } else {
            register({onRequest: 'staticFile'});
        }
    });
}

const forExpress = (express, app, options) => new Promise((resolve) => {
    const {path: dirPath = './web'} = options || {};
    const context = contextForPath(dirPath);
    const api = apiForContext(context);
    const {module, removeModule} = modulesForContext(context);

    const files = {};
    context.files = files;

    const changeListener = ({newFiles, removedFiles}) => {
        removedFiles.map(file => {
            fileToPath(file).paths.map(path => remove(removeModule(path)))
        });
        newFiles.map(file => {
            const {paths, isJsModule} = fileToPath(file);
            createModule(dirPath, api, isJsModule, file, result => {
                paths.map(path => module(path, result));
            });
        })
    };

    context.loaded = false;

    watchDir(forChangeListener(changeListener), dirPath, '', files, () => {
        context.loaded = true;
        resolve();
    });

    const staticFile = express.static(dirPath);

    app.use((req, res, next) => {
        if (context.loaded) {
            const {originalUrl} = req;
            const path = urlToPath(originalUrl);
            const moduleObject = module(path);
            const method = moduleObject && (moduleObject["on" + req.method] || moduleObject["onRequest"]);
            if (method === 'staticFile') {
                staticFile(req, res, next);
                return
            }
            if (method) {
                method(req, res, next);
                return
            }
        }
        next();
    });
});

module.exports = {forExpress};
