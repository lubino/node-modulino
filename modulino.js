const {extendExpressApp, registerContext} = require('./express');
const {addUser} = require('./users');
const {logToConsole} = require('./logger');
const {connect} = require('./client');

module.exports = {
    forExpress: extendExpressApp,
    registerContext,
    addUser,
    logToConsole,
    connect
};
