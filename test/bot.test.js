const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");
const dbApi = require("../src/db");
const { createBot } = require("../src/bot");
const { tempDb } = require("./helpers");

function leadMessage(text) {
  return {
    text,
    from: { id: "lead" },
    chat: { id: "chat" }
  };
}

test("project setup asks project length before review cadence", async () => {
  const db = tempDb();
  const sent = [];
  const originalLeadUserId = config.techLeadUserId;
  config.techLeadUserId = "lead";
  const bot = createBot({
    db,
    telegramBot: {
      on: () => {},
      sendMessage: async (chatId, text) => sent.push({ chatId, text })
    }
  });

  try {
    await bot.handleText(leadMessage("create project"));
    await bot.handleText(leadMessage("Alpha"));
    await bot.handleText(leadMessage("Launch review"));
    await bot.handleText(leadMessage("Improve collaboration"));
    await bot.handleText(leadMessage("Priya | Engineer | 101\nSam | Designer | 102"));

    assert.match(sent.at(-1).text, /How long is the project\?/);

    await bot.handleText(leadMessage("8 weeks"));
    assert.match(sent.at(-1).text, /Review cadence\?/);
    assert.doesNotMatch(sent.at(-1).text, /\|\s*end:/);

    await bot.handleText(leadMessage("weekly"));
    assert.match(sent.at(-1).text, /Send exactly 15 review questions/);

    await bot.handleText(leadMessage("default"));
    await bot.handleText(leadMessage("none"));
    assert.match(sent.at(-1).text, /Project preview/);
    assert.match(sent.at(-1).text, /Project length:/);
    assert.match(sent.at(-1).text, /Cadence: weekly/);

    await bot.handleText(leadMessage("yes"));
    const projects = dbApi.listProjects(db);
    assert.equal(projects.length, 1);
    assert.equal(dbApi.getProject(db, projects[0].id).reviewCadence.cadence, "weekly");
  } finally {
    config.techLeadUserId = originalLeadUserId;
  }
});
