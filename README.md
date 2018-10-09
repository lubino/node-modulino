# modulino
Simple NodeJS Application Server. It loads and reloads services from filesystem automatically without any server or NodeJS restarts.

### Installation
``` sh
npm i --save modulino
```

### Example
Create file **example.js**
``` javascript
const {forExpress} = require("modulino");
const express = require('express');
const bodyParser = require('body-parser');

const app = express();

// support json encoded bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

forExpress(express, app, {path: 'web'}).then(() => {
    const port = 8000;
    const server = app.listen(port, () => {
        console.log(`server started on port ${port}`);
    });
});
```
Create file **web/test.mod.js**
``` javascript
const {onRequest} = require('api');

onRequest((req, res) => {
    const {body} = req;
    res.type('js');
    res.send({message:"Hello world!", requstData: body});
});
```
Run this commands
``` sh
npm i --save modulino body-parser express

node example.js
```

Open the [test](http://localhost:8000/test) service.

You can edit file **web/test.mod.js** without any server restarts and check that your service is changing results.

**Notice:** This module has 'nodemailer' NPM dependency.

### License
MIT License