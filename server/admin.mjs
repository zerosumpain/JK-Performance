/**
 * Operator commands, run inside the container:
 *   node server/admin.mjs users
 *   node server/admin.mjs make-coach <email>     (a signed-in account becomes a coach)
 *   node server/admin.mjs assign <client-email> <coach-email>
 *   node server/admin.mjs test-clients add <coach-email> | remove   (made-up clients to rehearse with)
 *   node server/admin.mjs test-clients more <coach-email>   (programs, forms, autoflows for clients added before them)
 */
import { join } from 'node:path';
import { openStore } from './store.mjs';
import { addTestClients, addTestExtras, removeTestClients } from './testclients.mjs';

const db = openStore(join(process.env.DATA_DIR ?? './data', 'jk.sqlite'));
const [cmd, a, b] = process.argv.slice(2);
const byEmail = email => {
  const u = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND is_demo=0').get(email ?? '');
  if (!u) { console.error(`No account with email ${email}`); process.exit(1); }
  return u;
};

if (cmd === 'users') {
  for (const u of db.prepare('SELECT id, name, email, role, plan, is_demo, created_at FROM users ORDER BY created_at').all()) {
    console.log([u.id, u.role.padEnd(6), u.plan.padEnd(11), u.is_demo ? 'demo' : '    ', u.name, u.email ?? ''].join('  '));
  }
} else if (cmd === 'make-coach') {
  const u = byEmail(a);
  db.prepare("UPDATE users SET role='coach', coach_id=NULL WHERE id=?").run(u.id);
  // Real clients with no coach yet now belong to this one.
  const n = db.prepare("UPDATE users SET coach_id=? WHERE role='client' AND coach_id IS NULL AND is_demo=0").run(u.id).changes;
  console.log(`${u.name} is now a coach; ${n} unassigned client(s) moved to them.`);
} else if (cmd === 'assign') {
  const client = byEmail(a), coach = byEmail(b);
  if (coach.role !== 'coach') { console.error(`${b} is not a coach`); process.exit(1); }
  db.prepare('UPDATE users SET coach_id=? WHERE id=?').run(coach.id, client.id);
  console.log(`${client.name} now belongs to ${coach.name}.`);
} else if (cmd === 'test-clients' && a === 'add') {
  const coach = byEmail(b);
  if (coach.role !== 'coach') { console.error(`${b} is not a coach`); process.exit(1); }
  for (const c of addTestClients(db, coach.id)) console.log(`${c.id}  ${c.name}`);
  console.log(`Added made-up clients for ${coach.name}. Remove with: test-clients remove`);
} else if (cmd === 'test-clients' && a === 'more') {
  const coach = byEmail(b);
  const r = addTestExtras(db, coach.id);
  console.log(`Added ${r.programs} programs, ${r.forms} forms and ${r.autoflows} autoflows for ${coach.name}'s made-up clients.`);
} else if (cmd === 'test-clients' && a === 'remove') {
  const r = removeTestClients(db);
  console.log(`Removed ${r.users} made-up clients, ${r.classes} of their bookings and classes, and ${r.library} programs, forms, autoflows and challenges made for them.`);
} else {
  console.error('Usage: admin.mjs users | make-coach <email> | assign <client-email> <coach-email> | test-clients add|more <coach-email> | test-clients remove');
  process.exit(2);
}
