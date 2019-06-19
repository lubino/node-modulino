
const oneOf = (...items) => items.find(item => item != null);

const getCookies = req => {
    if (!req.cookies && req.headers.cookie) {
        const c = {};
        req.cookies = c;
        const {cookie} =  req.headers;
        if (cookie) {
            for (const item of cookie.split('; ')) {
                const e = item.indexOf('=');
                if (e > 0) {
                    c[item.substr(0, e).trim()] = item.substr(e + 1).trim();
                }
            }
        }
        return c;
    }
    return req.cookies || {};
};

const getSession = (req, res, context, options) => {
    const createSession = options === true || (options && options.new);
    let alreadyCreated = req._givenSession;
    if (alreadyCreated) {
        if (alreadyCreated.data || !createSession) {
            return alreadyCreated.data;
        }
    } else {
        alreadyCreated = {};
        req._givenSession = alreadyCreated;
    }

    const cookies = getCookies(req);
    const params = options || {};
    const tokenName = params.token || context.token || 'token';
    const csrfTokenName = params.csrfToken || context.csrfToken || 'csrf-token';

    let existingToken = cookies[tokenName];
    let existingCsrfToken = cookies[csrfTokenName];
    if (existingToken || createSession) {
        if (!context.sessions) {
            const sessions = {};
            context.sessionsInterval = setInterval(() => {
                const now = Date.now();
                for (const [token, item] of Object.entries(sessions)) {
                    if (item.expires < now) {
                        delete sessions[token];
                    }
                }
            }, 60000);
            context.on('unregister', () => {
                clearInterval(context.sessionsInterval);
            });
            context.sessions = sessions;
        }
        let item = existingToken ? context.sessions[existingToken] : null;
        if (item) {
            delete context.sessions[existingToken];
        }
        const now = Date.now();
        if (item && (item.expires < now || item.csrfToken !== existingCsrfToken)) {
            item = null;
        }

        const token = alreadyCreated.token || (item || createSession ? Math.round(Math.random()*10000000000).toString(16) : null);
        const csrfToken = alreadyCreated.csrfToken || (token ? Math.round(Math.random()*10000000000).toString(16) : null);

        if (token && !alreadyCreated.token) {
            const secure = Boolean(oneOf(params.secure, context.secure, true));
            res.cookie(tokenName, token, {secure});
            res.cookie(csrfTokenName, csrfToken, {secure, httpOnly: true});
            alreadyCreated.token = token;
            alreadyCreated.csrfToken = csrfToken;
        }
        if (!item && createSession) {
            item = {data: {}};
        }
        if (item) {
            const sessionTimeout = params.timeout || context.timeout || 4*3600*1000;
            context.sessions[token] = item;
            item.expires = now + sessionTimeout;
            item.csrfToken = csrfToken;
            alreadyCreated.data = item.data;
            alreadyCreated.created = true;
            return item.data;
        }
    }
    return null;
};

module.exports = {getCookies, getSession};
