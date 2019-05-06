const {registerContext} = require('./context');
const {extendExpressApp} = require('./express');
const {addUser} = require('./users');
const {rootLogger, logToConsole} = require('./logger');
const {connect} = require('./client');

module.exports = {
    forExpress: extendExpressApp,
    registerContext,
    addUser,
    rootLogger,
    logToConsole,
    connect
};
