let WebSocket;

module.exports.createWebSocket = (url, protocols, options) => {
    if (!WebSocket) {
        WebSocket = require("ws");
    }
    return new WebSocket(url, protocols, options);
};
