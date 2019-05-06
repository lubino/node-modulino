const {Validator} = require('jsonschema');

const string = {"type": "string"};
const boolean = {"type": "boolean"};

const integer = {"type": "number", "multipleOf": 1};
const timestamp = {...integer, "minimum": 1};

const SshKey = {
    "id": "/SshKey",
    "type": "object",
    "properties": {
        name: string,
        publicKey: string
    }
};
const UserLog = {
    "id": "/UserLog",
    "type": "object",
    "properties": {
        at: timestamp,
        type: string
    }
};
const User = {
    "id": "/User",
    "type": "object",
    "properties": {
        username: string,
        name: string,
        emails: {"type": "array", "items": string},
        sshKeys: {"type": "array", "items": SshKey},
        systemUser: boolean,
        logs: {"type": "array", "items": UserLog},
    },
    "required": []
};

let _userValidator;
const validateUser = (json) => {
    if (!_userValidator) {
        const v = new Validator();
        // v.addSchema(sshKey, sshKey.id);
        _userValidator = json => v.validate(json, User).errors;
    }
    return _userValidator(json);
};

module.exports = {validateUser};
