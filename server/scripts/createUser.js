const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { ScanRepository } = require('../src/repositories/scanRepository');
const { provisionUser } = require('../src/auth');

async function readHidden(prompt) {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (character) => {
      if (character === '\u0003') { cleanup(); reject(new Error('Cancelled.')); }
      else if (character === '\r' || character === '\n') { cleanup(); stdout.write('\n'); resolve(value); }
      else if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
      else if (character >= ' ') value += character;
    };
    function cleanup() { stdin.off('data', onData); stdin.setRawMode(false); }
    stdin.on('data', onData);
  });
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run this command in an interactive terminal so the password can be entered without echo.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const email = await rl.question('Account email: ');
  rl.close();
  const password = await readHidden('Password (12–256 characters, hidden): ');
  const repository = new ScanRepository();
  try {
    await repository.init();
    const user = await provisionUser(repository, email, password);
    console.log(`Provisioned ${user.email} (${user.id}).`);
  } catch (error) {
    if (/UNIQUE|duplicate/i.test(error.message)) throw new Error('Account could not be created; that email may already be provisioned.');
    throw error;
  } finally { await repository.close(); }
}

main().catch((error) => {
  const safeErrors = new Set(['Run this command in an interactive terminal so the password can be entered without echo.', 'Cancelled.', 'Provide a valid email address.', 'Password must contain 12 to 256 characters.', 'Account could not be created; that email may already be provisioned.']);
  const message = safeErrors.has(error.message) ? error.message : 'Could not provision the account; database and environment details were withheld.';
  console.error(`Account provisioning failed: ${message}`);
  process.exitCode = 1;
});
