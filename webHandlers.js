const loggerHTML = logger => `<pre>${logger}</pre>`;

const errHandler = logger => (req, res) => {
    res.status(500);
    res.type(`html`);
    res.send(`<h1>ERROR</h1>${loggerHTML(logger)}`)
};

const infoHandler = (file, data) => (req, res) => {
    res.type(`html`);
    res.send(`<h1>${file}</h1>${data(file)}`)
};


module.exports = {infoHandler, errHandler, loggerHTML};