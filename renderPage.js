const {runJS} = require('./runModule');
const {asyncRequire} = require('./installer');

const options = {
    ejs: {compileDebug: false, rmWhitespace: true}
};

const compilePage = async (type, filePath, file, api, logger) => {
    switch (type) {
        case 'html':
            return () => file;
        case 'pug':
            const pug = await asyncRequire(logger, 'pug');
            const js = pug.compileClient(file, {filename: filePath})+"; window.template = template;";
            runJS(filePath, api, js);
            return api.window.template;
    }
};

const renderPage = async (type, filePath, compiledPage, file, features, req, res, logger) => {
    if (compiledPage) {
        return compiledPage({...features, req, res, console: logger});
    }

    const item = await asyncRequire(logger, type);
    switch (type) {
        case 'ejs':
            return item.render(file, {...features, req, res, console: logger}, options.ejs);
        case 'pug':
            return item.render(file, {...features, req, res, console: logger});
        default:
            logger.error(`unknown page type '${type}'`);
            return `no page renderer for ${type} files`;
    }
};

module.exports = {compilePage, renderPage};
