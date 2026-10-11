// One entry per sport. To add a sport later, add a file here and one line below.
const engines = {
  table_tennis: require("./tableTennis"),
  simple: require("./simple"),
  cricket: require("./cricket"),
};

function getEngine(sport) {
  return Object.hasOwn(engines, sport) ? engines[sport] : null;
}

module.exports = { getEngine };
