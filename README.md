# modulino
Simple NodeJS Application Server. It loads and reloads services from filesystem automatically without any server or NodeJS restarts.
Supports EJS and Pug templating engines out of the box.

### Installation
``` sh
npm i modulino
```

### Example
Create file **example.js**
``` javascript
#!/usr/bin/env node

const {forExpress, addUser} = require("modulino");
const express = require('express');
const bodyParser = require('body-parser');
const expressWs = require('express-ws');

const app = express();
expressWs(app);

// support json encoded bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const port = 8000;

addUser({
  "username":"test",
  "name":"User",
  "emails":["test@test.com"],
  "sshKeys":[{
    "name":"test",
    "publicKey":
      "-----BEGIN RSA PUBLIC KEY-----\n"+
      "MIIBCgKCAQEAq1cg8Py7KNJiTSrQ3busKqjTLJruNDrKiBTXQuYe7DUsNNZHd6F2\n"+
      "8Hzi1Eb5QGiN/KwMNfdoNfB53xBIUztxv5zwYmpnwv8JwBMPMdnOoAPrjHCEiq9l\n"+
      "d6dNtkuJfVp3roqmIyc5KntKEda/EIn4GCLsB/wGBcvaxGDroyJIyGYmJ7rJwC/e\n"+
      "pf/wJjXBro1sShAPh4//gURH42rcR+rUTwnzdApJJBeCbccoDLejKa/OB8QRlLeD\n"+
      "+3BTysLDeQhapVlUXi+r4YJHoMPGsnGvimVQAtgMkHvp+mzE7G7NzvNjlqkdqej+\n"+
      "bli1xCcpo0UCaBCnmxv17kRPUakfb7jJTwIDAQAB\n"+
      "-----END RSA PUBLIC KEY-----\n"
    }]
  }
);

forExpress(app, {
    consoleLogger: true,
    contexts: [
        {path: 'web', headers: {host: `localhost:${port}`}}
    ],
}).then(() => app.listen(port, () =>
    console.log(`server started on port http://localhost:${port}`)
));
```

Run this commands
``` sh
npm install --save modulino body-parser express express-ws

node example.js
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

Open the [test](http://localhost:8000/test) service.

You can edit file **web/test.mod.js** without any server restarts and check that your service is changing results.

Create file **web/index.html**
``` html
<!DOCTYPE html>
<head>
    <title>Title</title>
</head>
<body>
 Hello
</body>
</html>
```
Open the [main](http://localhost:8000/) page.

**Notice:** This module has 'nodemailer' NPM dependency.

### Develop remotely
Create file **client.js** in any empty directory
``` javascript 1.7
#!/usr/bin/env node

const {connect} = require("modulino");

const url = "ws://localhost:8000/administrationApi";

const username = "test";
const email = "test@test.com";
const privateKey = "-----BEGIN RSA PRIVATE KEY-----\n"+
  "MIIEpAIBAAKCAQEAq1cg8Py7KNJiTSrQ3busKqjTLJruNDrKiBTXQuYe7DUsNNZH\n"+
  "d6F28Hzi1Eb5QGiN/KwMNfdoNfB53xBIUztxv5zwYmpnwv8JwBMPMdnOoAPrjHCE\n"+
  "iq9ld6dNtkuJfVp3roqmIyc5KntKEda/EIn4GCLsB/wGBcvaxGDroyJIyGYmJ7rJ\n"+
  "wC/epf/wJjXBro1sShAPh4//gURH42rcR+rUTwnzdApJJBeCbccoDLejKa/OB8QR\n"+
  "lLeD+3BTysLDeQhapVlUXi+r4YJHoMPGsnGvimVQAtgMkHvp+mzE7G7NzvNjlqkd\n"+
  "qej+bli1xCcpo0UCaBCnmxv17kRPUakfb7jJTwIDAQABAoIBAFBMgxmtuCEHiB5W\n"+
  "JJDmNWfAu0c6TMyZiPWBnuixZGia+t7AVboRJ+bJAJ0vrfyrg2+ZShe4nVQ6IUOT\n"+
  "I/It978vU9ErwPk4AV/NDt/0DcwcSjYFPXipfso21ErM1+Cxl0lrnTT4Wug345y8\n"+
  "ocqkfmsBYtDTIhdxVFOYgJZxqN6RjJXPvz37R1BUoadyFkUMXfMFXh26dlaxQiN4\n"+
  "/mowP2fnYzcYuzjFD37lnmlpjOAgrcZ7WvZXcR9vgoAHp1YpJCiKVeCO5MDVVAwK\n"+
  "NvTwxQioRqr6JXpEFjx30J8Br4KI5Zr5ekQgNfYPfhagSnCoWDFsU6m3gKS1he62\n"+
  "vq8K6xECgYEA1SOoKh9g5zo34Ln9vdOtkkKln76d+6e35708/rwaGnXOy+Vi2spH\n"+
  "bNI9aJY5Hj9cHxLQr3hhJ4YxtP8F4qSNYHmQLRmxqVDAGgR+NDpBL74iZxGAw5yj\n"+
  "/fsWI3iiJVOb35q8xDieYJRbyyFAgJln7bRf7bulla8nPqdbPvjO9XMCgYEAzcus\n"+
  "9in7HUPXPyXoQHlZnf0vpicxOhFDOJXXbsxKAMce9NOeMXn3fWlaMcKK75a/Y3uA\n"+
  "O2fZRkeY2ulTXOfhU/D0F3T+ynk0BsITtD/yiY34vAHBCQDVO9u/aKJn7yTODeD1\n"+
  "facl5FzvS8VfCqZSKc7XX+NnSWPrWZxhEaR+BbUCgYBeA7htvCGWXQvAyMmwLerm\n"+
  "FRfRetdc5gIs6kA5bOdmvIhXT/tm3sraqXIE7B6NxQzxd+8tN0BDmuHaIJOMAWGL\n"+
  "KJP8ENVZBhF2aHzytK+ES64JIKNXpYSAx3xgcRm0tUiQPUT+mKrjlw1WcHhvQTui\n"+
  "kmmuB5NmjzgUXuXUxRMlGQKBgQCLX0Tj8cp/J1K/EY0ZHRX0SWPbwu8zxD0iNViR\n"+
  "UQlNPY1ZgXfBSjiyVoce7AHsAMvdM+bEVLBxSEvc9effI6sWjjjBKhrkRPFXIlj1\n"+
  "2dkID35E1WtGDapbv5cB5fs9mk9yVsfrMSgYYFgvmJulOr6qUcrKxddNfL4HEkEr\n"+
  "EZvHgQKBgQCAMXLeJT7tlYHSsCPi0alFY2y/AGcLkQ0qjpLae24GJJYKPIL1wmgm\n"+
  "hrxTi0eW4ulAPFzDIZBqjqY/g9c+Fs7eXwBuRcH5e2xKKmFP7TrwytzPCQ/k0Drh\n"+
  "z/B+tiRFMsX/uX1ckQMx+FavslkVXeI1sR3fenptYoyfnoZL1mltsQ==\n"+
  "-----END RSA PRIVATE KEY-----\n";

connect({url, privateKey, username, email});
```

Run this commands to be able to remotely
``` sh
npm install modulino ws

node client.js
```

It will download all files from server and upload them after any change on filesystem.
It also shows logs from server.

Get public key in PEM format from your ssh RSA key pair:
``` bash
ssh-keygen -f ~/.ssh/id_rsa -e -m pem
``` 

Generating your own keys using NodeJS (newest version required):
``` javascript 1.7
const { generateKeyPair } = require('crypto');

generateKeyPair('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {type: 'pkcs1', format: 'pem'},
    privateKeyEncoding: {type: 'pkcs1', format: 'pem'}
}, (err, publicKey, privateKey) => {
    if (!err) {
        console.log(
            'RSA key generated, you can add user on server: \n\n'+
            'const {addUser} = require("modulino");\n\n'+
            'addUser('+JSON.stringify({
                username: "test",
                name: "User",
                emails: ["test@test.com"],
                sshKeys: [{name: "test", publicKey}]
            })+');\n\n\n' +
            'Also you can to connect to your server using WS client::\n\n'+
            'const {connect} = require("modulino");\n\n' +
            'const username = "test";\n' +
            'const email = "test@test.com";\n' +
            'const url = "ws://localhost:8000/administrationApi";\n' +
            'const privateKey = "'+privateKey.split('\n').join('\\n"+\n  "')+'";\n\n'+
            'connect({url, privateKey, username, email});'
        );
    } else {
        console.error('Can not generate RSA keys:', err);
    }
});
```

### License
MIT License