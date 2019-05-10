const WebSocket = require("ws");

module.exports.createWebSocket = (url, protocols, options) => new WebSocket(url, protocols, options);
