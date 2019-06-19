const {featuresForContext} = require('../features');
const {createLogger} = require("../logger");
const {apiContext} = require('./apiContext');

const logger = createLogger(apiContext.id, apiContext.path);

module.exports = featuresForContext(apiContext).featuresFor(logger);
