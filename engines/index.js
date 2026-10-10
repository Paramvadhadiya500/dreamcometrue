// One entry per sport. To add a sport later (cricket, football...), add a file here and one line below.
const engines = {
    table_tennis: require("./tableTennis"),
    simple: require("./simple"),
};

function getEngine(sport) {
    return Object.hasOwn(engines, sport) ? engines[sport] : null;
}

module.exports = { getEngine };