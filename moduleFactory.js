const {runJS} = require("./runModule");
const {renderPage, compilePage} = require("./renderPage");
const {loggerHTML, infoHandler, errHandler} = require("./webHandlers");
const {getSession} = require("./sessions");

const wrap = (listener, logger, context) => async (req, res, next) => {
    try {
        logger.clean();
        logger.debug(`received request for '${req.method}'`);
        req.getSession = (options) => getSession(req, res, context, options);
        const promise = listener(req, res, next);
        if (promise != null) {
            const result = await promise;
            if (result !== undefined) {
                logger.debug(`sending '${typeof result}' response`);
                if (typeof result === 'string') res.type('html');
                else if (typeof result === 'object') res.type('json');
                res.send(result);
            }
        }
    } catch (e) {
        logger.error(e);
        errHandler(logger)(req, res);
    }
};

const exp = (moduleObject, data) => {
    for (const [field, value] of Object.entries(data)) {
        moduleObject[field] = value;
    }
};

function newListener(filePath, logger, api, context) {
    let moduleObject;
    api.onRequest = listener => {
        logger.debug(`listen to requests`);
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onRequest = wrap(listener, logger, context);
    };
    api.onPost = listener => {
        logger.debug(`listen to 'post' requests`);
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onPost = wrap(listener, logger, context);
    };
    api.onGet = listener => {
        logger.debug(`listen to 'get' requests`);
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onGet = wrap(listener, logger, context);
    };
    api.onPut = listener => {
        logger.debug(`listen to 'put' requests`);
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onPut = wrap(listener, logger, context);
    };
    api.onDelete = listener => {
        logger.debug(`listen to 'delete' requests`);
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onDelete = wrap(listener, logger, context);
    };
    api.exports = data => exp(moduleObject, data);

    return () => moduleObject;

}

const createModule = async (context, getStaticRequest, filePath, featuresFor, fileType, register) => {
    const logger = context.createLogger(filePath);
    const isPrivate = filePath.startsWith('/.private/') || filePath.startsWith('/private/');
    const {isJsModule, pageType} = fileType;
    if (!pageType && !isJsModule) {
        register({onRequest: getStaticRequest(), isPrivate});
        return
    }
    try {
        const data = await context.contentOf(filePath);
        const file = data.toString();
        logger.debug(`processing file '${filePath}'`);
        const api = featuresFor(logger, filePath);
        if (pageType) {
            const compiledPage = await compilePage(pageType, filePath, file, api, logger);
            register({
                onRequest: async (req, res) => {
                    try {
                        logger.clean();
                        logger.debug(`rendering '${filePath}' for '${req.remoteAddress}': ${req.headers['user-agent']}`);
                        const html = await renderPage(pageType, filePath, compiledPage, file, api, req, res, logger);
                        res.type(`html`);
                        res.send(html);
                    } catch (e) {
                        logger.error(e);
                        errHandler(logger)(req, res);
                    }
                }, isPrivate
            });
        } else if (isJsModule) {
            try {
                const getModuleObject = newListener(filePath, logger, api, context);
                const errors = runJS(filePath, api, file);
                errors.length && logger.error(`module '${filePath}' contains ${errors.length} error(s):\n${logger.join(errors)}`);
                const moduleObject = getModuleObject();
                if (moduleObject) {
                    moduleObject.isPrivate = isPrivate;
                    register(moduleObject);
                } else {
                    register({onRequest: infoHandler(filePath, () => loggerHTML(logger)), isPrivate});
                }

            } catch (e) {
                logger.error(e);
                register({onRequest: errHandler(logger), isPrivate});
            }
        } else {
            logger.error(`unsupported module '${filePath}'`);
            register({onRequest: errHandler(logger), isPrivate});
        }
    } catch (e) {
        logger.error(e);
        register({onRequest: errHandler(logger), isPrivate});
    }
};


module.exports = {createModule};
