const {getEjs} = require('./installer');


const ejsOptions = {compileDebug: false, rmWhitespace: true};

const renderEjs = async (file, features, req, res, logger) => {
    const ejs = await getEjs(logger);
    return ejs.render(file, {...features, req, res, console: logger}, ejsOptions);
};

module.exports = {renderEjs};