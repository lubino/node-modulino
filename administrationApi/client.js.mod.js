const {onRequest, contentOf} = require('modulino/api');
const {readFile, getParameters} = require('modulino/administration');

let js;
const maxAge = 30*86400; // 30 days
onRequest(async (req, res) => {
    if (!js) {
        const feClientSrc = await contentOf('/feClient.js');
        const clientJs = await readFile('client.js');
        const {wsUrl, webUrl} = getParameters();
        js = feClientSrc.toString()
            .replace('ws.url()', wsUrl)
            .replace('web.url()', webUrl)
            .replace('client.js();', clientJs.toString());
    }
    res.type("js");
    res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
    res.send(js);
});
