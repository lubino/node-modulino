function modulesForContext(context) {

    let {modules} = context;
    if (!modules) {
        context.modules = modules = {};
    }

    function module(path, module) {
        const old = modules[path];
        if (module) {
            modules[path] = module;
        }
        return old;
    }

    function removeModule(path) {
        const old = modules[path];
        if (old) {
            delete modules[path];
        }
        return old;
    }

    return {module, removeModule};
}

module.exports = {modulesForContext};
