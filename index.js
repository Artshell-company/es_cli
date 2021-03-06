require('dotenv').config();
const Promise = require('bluebird');
const client = require('./client');
const fs = require('fs');

const mappings = JSON.parse(fs.readFileSync(process.env.MAPPING_PATH).toString());
const settings = JSON.parse(fs.readFileSync(process.env.SETTINGS_PATH).toString());

const logError = ({ message }) => console.log(message);

const createIndex = async (name = 'artshell', maxRetries = 5, retryInterval = 5000) =>
  client.indices.create({
    index: name,
    body: {
      settings,
      mappings,
    },
  })
    .then(console.log)
    .catch(async (err) => {
      console.log(err.message);
      if (maxRetries > 0) {
        console.log('retrying in ', retryInterval);
        await Promise.delay(retryInterval);
        return createIndex(maxRetries - 1);
      }
      console.log('giving up');
      throw err;
    });

const deleteIndex = name =>
  client.indices.delete({ index: name }).then(console.log).catch(logError);

const updateMapping = name =>
  client.indices.putMapping({
    index: name,
    type: 'doc',
    body: mappings.doc,
  }).then(console.log).catch(logError);

const program = require('commander');

const awaitTaskCompletion = async (taskId) => {
  const task = await client.tasks.get({ taskId });
  console.log(task);
  if (task.completed) {
    return task;
  }
  await Promise.delay(1000);
  return awaitTaskCompletion(taskId);
};

const reindex = async (oldName, newName, alias = 'artshell_main') =>  {
  console.log('creating index', newName);
  await createIndex(newName);
  console.log('done');
  console.log(`Reindexing ${oldName} to ${newName}`);
  const task = await client.reindex({
    waitForCompletion: false,
    body: {
      source: {
        index: oldName,
      },
      dest: {
        index: newName,
      },
    },
  });
  console.log('Awaiting task completion..');
  await awaitTaskCompletion(task.task);
  console.log('done');
  console.log('Setting up alias to point to ', newName);
  await client.indices.updateAliases({
    body: {
      actions: [
        { remove: { index: oldName, alias } },
        { add: { index: newName, alias } },
      ],
    },
  });
  console.log('all done');
};

program
  .version('0.1.0')
  .option('-c, --create [name]', 'Create index')
  .option('-d, --delete [name]', 'Remove index')
  .option('-r, --reindex [old_name] [new_name] [alias]', 'Reindexes')
  .option('-u, --update [name]', 'Updates index')
  .parse(process.argv);

if (program.create) {
  createIndex(program.create);
} else if (program.delete) {
  deleteIndex(program.delete);
} else if (program.update) {
  updateMapping(program.update);
} else if (program.reindex) {
  reindex(program.reindex, program.args[0]);
}
