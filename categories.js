// Names of the match categories and stages (one list, used by the server and sent to the pages).
// The keys are what is stored in the database (see migrations/005_category_and_rounds.sql).

const CATEGORIES = {
  boys: "Boys",
  girls: "Girls",
  male_faculty: "Male Faculty",
  female_faculty: "Female Faculty",
  mix: "Mix",
};

const STAGES = {
  group: "Group",
  quarter_final: "Quarter Final",
  semi_final: "Semi Final",
  final: "Final",
  knockout: "Knockout",          // old matches only; the admin form no longer offers it
};

const categoryLabel = (c) => (Object.hasOwn(CATEGORIES, c) ? CATEGORIES[c] : "");

// "" for a group match (nothing to show), otherwise the round's name.
const stageLabel = (s) => (s && s !== "group" && Object.hasOwn(STAGES, s) ? STAGES[s] : "");

module.exports = { CATEGORIES, STAGES, categoryLabel, stageLabel };
