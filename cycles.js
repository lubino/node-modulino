function runAfterAllCycles(cb) {
    let i = 0;
    const nextCycle = (func) => {
        i++;
        func(endCycle);
    };
    const endCycle = () => {
        if (i-- === 1) {
            i = -1000000;
            cb && cb();
        }
    };
    const checkFinish = () => {
        i === 0 && cb && cb()
    };
    return {nextCycle, checkFinish}
}

module.exports.runAfterAllCycles = runAfterAllCycles;