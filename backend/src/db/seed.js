// Fills the database with demo data (WARNING: wipes existing rows first)
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

const PASSWORD = 'Password@123';

(async () => {
  const q = (t, p) => pool.query(t, p);
  await q('TRUNCATE activity_logs, tasks, columns, boards, memberships, users, tenants, organizations CASCADE');
  const hash = await bcrypt.hash(PASSWORD, 10);

  const org = async (name) => (await q('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
  const tenant = async (o, name) => (await q('INSERT INTO tenants (organization_id,name) VALUES ($1,$2) RETURNING id', [o, name])).rows[0].id;
  const user = async (name, email) => (await q('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', [name, email, hash])).rows[0].id;
  const member = (u, o, t, role) => q('INSERT INTO memberships (user_id,organization_id,tenant_id,role) VALUES ($1,$2,$3,$4)', [u, o, t, role]);

  const abc = await org('ABC Technologies');
  const hyd = await tenant(abc, 'Hyderabad');
  const blr = await tenant(abc, 'Bangalore');
  await tenant(abc, 'Chennai');
  const xyz = await org('XYZ Solutions');
  const mum = await tenant(xyz, 'Mumbai');
  await tenant(xyz, 'Pune');

  const rahul = await user('Rahul', 'rahul@abc.com');
  const priya = await user('Priya', 'priya@abc.com');
  const arjun = await user('Arjun', 'arjun@abc.com');
  const sneha = await user('Sneha', 'sneha@abc.com');
  const kiran = await user('Kiran', 'kiran@xyz.com');

  await member(rahul, abc, null, 'org_admin');       // org-wide: sees Hyderabad, Bangalore, Chennai
  await member(priya, abc, hyd, 'tenant_admin');
  await member(arjun, abc, hyd, 'member');
  await member(sneha, abc, blr, 'tenant_admin');
  await member(kiran, xyz, mum, 'member');

  const board = async (o, t, name, desc, by) =>
    (await q('INSERT INTO boards (organization_id,tenant_id,name,description,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [o, t, name, desc, by])).rows[0].id;
  const cols = async (b, t) => {
    const ids = [];
    for (const [i, n] of ['To Do', 'In Progress', 'Testing', 'Done'].entries())
      ids.push((await q('INSERT INTO columns (board_id,tenant_id,name,position) VALUES ($1,$2,$3,$4) RETURNING id', [b, t, n, i])).rows[0].id);
    return ids;
  };
  // tasks: [title, columnIndex, assignee, priority, labels]
  const tasks = async (b, t, c, createdBy, list) => {
    const pos = [0, 0, 0, 0];
    for (const [title, ci, assignee, priority, labels] of list) {
      await q(
        `INSERT INTO tasks (board_id,column_id,tenant_id,title,description,assigned_to,created_by,priority,labels,position,due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CURRENT_DATE + ($10 + 3))`,
        [b, c[ci], t, title, `Details for: ${title}`, assignee, createdBy, priority, labels, pos[ci]++]);
    }
  };

  const web = await board(abc, hyd, 'Website Development', 'Company website revamp', priya);
  const webC = await cols(web, hyd);
  await tasks(web, hyd, webC, priya, [
    ['Create Login Page', 0, rahul, 'high', ['frontend']],
    ['Design Dashboard', 0, priya, 'medium', ['design']],
    ['Fix API Validation', 0, arjun, 'medium', ['backend']],
    ['Develop Registration API', 1, arjun, 'high', ['backend', 'api']],
    ['Set up CI pipeline', 1, priya, 'low', ['devops']],
    ['Test Authentication', 2, priya, 'high', ['qa']],
    ['Deploy Dashboard', 3, rahul, 'medium', ['devops']],
    ['Project kickoff', 3, priya, 'low', []],
  ]);
  const mob = await board(abc, hyd, 'Mobile Application Development', 'Android + iOS app', priya);
  const mobC = await cols(mob, hyd);
  await tasks(mob, hyd, mobC, priya, [
    ['Wireframes', 3, priya, 'medium', ['design']],
    ['Push notifications', 1, arjun, 'high', ['mobile']],
    ['Offline mode', 0, arjun, 'medium', ['mobile']],
    ['App store listing', 0, rahul, 'low', []],
  ]);
  const crm = await board(abc, blr, 'CRM Development', 'Customer relationship manager', sneha);
  const crmC = await cols(crm, blr);
  await tasks(crm, blr, crmC, sneha, [
    ['Import contacts', 0, sneha, 'high', ['data']],
    ['Lead scoring', 1, sneha, 'medium', ['ml']],
    ['Email templates', 2, sneha, 'low', []],
    ['Sales report', 3, sneha, 'medium', ['reports']],
  ]);
  const sup = await board(xyz, mum, 'Customer Support Platform', 'Ticketing system', kiran);
  const supC = await cols(sup, mum);
  await tasks(sup, mum, supC, kiran, [
    ['Ticket routing', 0, kiran, 'high', []],
    ['SLA timers', 1, kiran, 'medium', []],
    ['Knowledge base', 3, kiran, 'low', []],
  ]);

  console.log('✅ Seed complete. All demo users use password:', PASSWORD);
  console.log('   rahul@abc.com (Org Admin) | priya@abc.com (Tenant Admin, Hyderabad) | arjun@abc.com (Member, Hyderabad)');
  console.log('   sneha@abc.com (Tenant Admin, Bangalore) | kiran@xyz.com (Member, Mumbai)');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
