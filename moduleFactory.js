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
    let types = [];
    api.onRequest = listener => {
        types = null;
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onRequest = wrap(listener, logger, context);
    };
    api.onPost = listener => {
        if (types) {
            types.push('post');
        }
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onPost = wrap(listener, logger, context);
    };
    api.onGet = listener => {
        if (types) {
            types.push('get');
        }
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onGet = wrap(listener, logger, context);
    };
    api.onPut = listener => {
        if (types) {
            types.push('put');
        }
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onPut = wrap(listener, logger, context);
    };
    api.onDelete = listener => {
        if (types) {
            types.push('delete');
        }
        if (!moduleObject) moduleObject = {logger};
        moduleObject.onDelete = wrap(listener, logger, context);
    };
    api.exports = data => {
        if (!moduleObject) moduleObject = {logger};
        exp(moduleObject, data);
    };

    return () => {
        let info;
        if (types === null) {
            info = `listens to all requests`;
        } else if (types.length) {
            types.sort();
            info = `listens to ${types.join(', ')} request(s)`;
        } else {
            info = `doesn't listen to any requests`;
        }
        return {moduleObject, info};
    }

}

const createModule = async (context, getStaticRequest, filePath, featuresFor, fileType, register) => {
    const logger = context.createLogger(filePath);
    const isPrivate = filePath.startsWith('/.private/') || filePath.startsWith('/private/');
    const {isJsModule, pageType} = fileType;
    if (!pageType && !isJsModule) {
        register(logger, {onRequest: getStaticRequest(), isPrivate}, 'responds with static context');
        return
    }
    try {
        const data = await context.contentOf(filePath);
        const file = data.toString();
        logger.debug(`processing file '${filePath}'`);
        const api = featuresFor(logger, filePath);
        if (pageType) {
            const compiledPage = await compilePage(context, pageType, filePath, file, api, logger);
            register(logger, {
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
            }, `renders '${pageType}' page`);
        } else if (isJsModule) {
            try {
                const getModuleObject = newListener(filePath, logger, api, context);
                const errors = runJS(context, filePath, api, file);
                if (errors.length) {
                    logger.error(`module '${filePath}' contains ${errors.length} error(s):\n${logger.join(errors)}`);
                }
                const {moduleObject, info} = getModuleObject();
                if (moduleObject) {
                    moduleObject.isPrivate = isPrivate;
                    register(logger, moduleObject, info);
                } else {
                    register(logger, {onRequest: infoHandler(filePath, () => loggerHTML(logger)), isPrivate}, 'responds with logs message');
                }

            } catch (e) {
                logger.error(e);
                register(logger, {onRequest: errHandler(logger), isPrivate}, 'responds with module error');
            }
        } else {
            logger.error(`unsupported module '${filePath}'`);
            register(logger, {onRequest: errHandler(logger), isPrivate}, 'responds with unsupported module error');
        }
    } catch (e) {
        logger.error(e);
        register(logger, {onRequest: errHandler(logger), isPrivate}, 'responds with error');
    }
};


module.exports = {createModule};
